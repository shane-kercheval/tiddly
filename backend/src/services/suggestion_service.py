"""
Suggestion service layer for AI features.

Each function accepts all context as parameters (no DB queries), builds a
prompt, calls the LLM, and post-processes the response. The API router is
a thin wrapper that fetches DB context and delegates here.

NOTE: Eval configs pass these parameters directly — update eval YAML configs
if you change the parameter contract.
"""
import logging
from dataclasses import dataclass
from typing import Literal

from pydantic import ValidationError

from schemas.ai import (
    ArgumentInput,
    ArgumentSuggestion,
    RelationshipCandidate,
    RelationshipCandidateContext,
    SuggestRelationshipsResponse,
    SuggestTagsResponse,
    TagVocabularyEntry,
)
from schemas.validators import validate_argument_name
from services._suggestion_llm_schemas import (
    ArgumentDescriptionSuggestion,
    ArgumentNameSuggestion,
    DescriptionOnly,
    TitleAndDescription,
    TitleOnly,
    _BothArgumentFieldsSuggestion,
    _GenerateAllArgumentsResult,
)
from services.llm_prompts import (
    build_generate_all_arguments_messages,
    build_metadata_suggestion_messages,
    build_refine_both_fields_messages,
    build_refine_single_field_messages,
    build_relationship_suggestion_messages,
    build_tag_suggestion_messages,
    extract_template_placeholders,
)
from services.llm_service import LLMConfig, LLMService

logger = logging.getLogger(__name__)

# Response caps enforced after post-processing
_MAX_TAGS = 7
_MAX_RELATIONSHIPS = 5

# Default timeout (seconds) and retry count for suggestion LLM calls.
# Tuned for interactive UI latency — fail fast rather than keep the user
# waiting on a flaky upstream provider. The router endpoints rely on these
# defaults; evals override per-call to `timeout=60, num_retries=3` for
# resilience across batched runs where transient slowdowns are normal.
_SUGGESTION_TIMEOUT_DEFAULT = 15
_SUGGESTION_NUM_RETRIES_DEFAULT = 0


class LLMResponseParseError(Exception):
    """Raised when the LLM returns a response that cannot be parsed into the expected schema."""

    def __init__(self, message: str, cost: float | None = None) -> None:
        super().__init__(message)
        self.cost = cost


class LLMParseFailedError(Exception):
    """
    Raised by AI endpoint handlers when `LLMResponseParseError` is caught and
    converted into an HTTP response. Mapped to HTTP 502 with
    `error_code: llm_parse_failed` by the handler in `api/main.py`, mirroring
    the shape of the LiteLLM exception handlers.

    Lives alongside `LLMResponseParseError` (its parent-cause) rather than in
    the router layer so that `api/main.py` can import it without inverting
    the app-layer → router-layer dependency direction.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _parse_response(
    response: object,
    response_model: type,
    cost: float | None,
) -> object:
    """
    Parse LLM response content as a Pydantic model.

    Raises LLMResponseParseError if the response is empty or unparseable.
    """
    if not response.choices or not response.choices[0].message.content:
        logger.warning(
            "llm_empty_response",
            extra={"model": getattr(response, "model", "unknown")},
        )
        raise LLMResponseParseError("LLM returned an empty response.", cost=cost)

    try:
        return response_model.model_validate_json(
            response.choices[0].message.content,
        )
    except ValidationError as exc:
        logger.warning(
            "llm_invalid_response",
            extra={
                "model": getattr(response, "model", "unknown"),
                "content_preview": (response.choices[0].message.content or "")[:200],
                "validation_errors": str(exc),
            },
        )
        raise LLMResponseParseError(
            "LLM returned an invalid response.",
            cost=cost,
        ) from exc


async def suggest_tags(
    *,
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    content_type: str,
    current_tags: list[str],
    tag_vocabulary: list[TagVocabularyEntry],
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int = _SUGGESTION_TIMEOUT_DEFAULT,
    num_retries: int = _SUGGESTION_NUM_RETRIES_DEFAULT,
) -> tuple[list[str], float | None]:
    """
    Suggest tags for a content item based on its metadata and the user's tag vocabulary.

    Builds a prompt with the item context and user's tag vocabulary (up to 100
    entries with usage counts). Calls the LLM and post-processes the response.

    Args:
        title: Item title.
        url: Item URL (bookmarks only).
        description: Item description.
        content_snippet: Item content.
        content_type: The entity type ("bookmark", "note", "prompt"). Included in
            the system prompt so the LLM can tailor suggestions to the content type.
        current_tags: Tags already on this item. Used for case-insensitive dedup
            against the LLM response.
        tag_vocabulary: User's existing tags sorted by frequency, up to 100 entries.
            Each entry includes name and usage count. Rendered in the prompt as
            "python (47), flask (12), api (8)" format.
        llm_service: LLM service instance for making completion calls.
        config: Resolved LLM config (model, key, key source).
        timeout: Seconds to wait for the LLM response before raising. Defaults to
            the UI-tuned value; evals pass a longer value for resilience.
        num_retries: Retry count on transient LLM failures. Defaults to the
            UI-tuned value; evals pass a higher value for resilience.

    Returns:
        Tuple of (tags, cost). Tags are deduplicated against current_tags
        (case-insensitive) and capped at 7.

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    messages = build_tag_suggestion_messages(
        title=title,
        url=url,
        description=description,
        content_snippet=content_snippet,
        content_type=content_type,
        tag_vocabulary=tag_vocabulary,
    )

    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestTagsResponse,
        timeout=timeout,
        num_retries=num_retries,
    )

    parsed = _parse_response(response, SuggestTagsResponse, cost)

    # Case-insensitive dedup against current tags
    current_lower = {t.lower() for t in current_tags}
    filtered = [t for t in parsed.tags if t.lower() not in current_lower]

    return filtered[:_MAX_TAGS], cost


@dataclass
class MetadataSuggestion:
    """Result from suggest_metadata. Only requested fields are non-None."""

    title: str | None
    description: str | None


async def suggest_metadata(
    *,
    fields: list[str],
    url: str | None,
    title: str | None,
    description: str | None,
    content_snippet: str | None,
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int = _SUGGESTION_TIMEOUT_DEFAULT,
    num_retries: int = _SUGGESTION_NUM_RETRIES_DEFAULT,
) -> tuple[MetadataSuggestion, float | None]:
    """
    Suggest title and/or description for a content item.

    The fields parameter controls which fields are generated. Existing values
    for non-requested fields are sent as context but not regenerated.

    Args:
        fields: Which fields to generate. Must contain at least one of
            "title", "description". Controls which structured output schema
            is used (TitleOnly, DescriptionOnly, TitleAndDescription).
        url: Item URL.
        title: Existing title (context, not regenerated unless requested).
        description: Existing description (context).
        content_snippet: Item content.
        llm_service: LLM service instance for making completion calls.
        config: Resolved LLM config (model, key, key source).
        timeout: Seconds to wait for the LLM response before raising. Defaults to
            the UI-tuned value; evals pass a longer value for resilience.
        num_retries: Retry count on transient LLM failures. Defaults to the
            UI-tuned value; evals pass a higher value for resilience.

    Returns:
        Tuple of (MetadataSuggestion, cost). Only requested fields are non-None
        in the result. Generated title is prompted to be under 100 characters;
        no server-side truncation (the prompt instruction is the constraint).

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    generate_title = "title" in fields
    generate_desc = "description" in fields

    if generate_title and generate_desc:
        response_format = TitleAndDescription
    elif generate_title:
        response_format = TitleOnly
    else:
        response_format = DescriptionOnly

    messages = build_metadata_suggestion_messages(
        fields=fields,
        url=url,
        title=title,
        description=description,
        content_snippet=content_snippet,
    )

    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=response_format,
        timeout=timeout,
        num_retries=num_retries,
    )

    parsed = _parse_response(response, response_format, cost)

    return MetadataSuggestion(
        title=getattr(parsed, "title", None),
        description=getattr(parsed, "description", None),
    ), cost


async def suggest_relationships(
    *,
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    candidates: list[RelationshipCandidateContext],
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int = _SUGGESTION_TIMEOUT_DEFAULT,
    num_retries: int = _SUGGESTION_NUM_RETRIES_DEFAULT,
) -> tuple[list[RelationshipCandidate], float | None]:
    """
    Suggest related items from a pre-built candidate list.

    The caller is responsible for searching and deduplicating candidates.
    This function sends candidates to the LLM for relevance judgment and
    filters the response.

    Args:
        title: Source item title.
        url: Source item URL.
        description: Source item description.
        content_snippet: Source item content. Truncated to 5000 chars in
            the prompt.
        candidates: Pre-searched, pre-deduped candidate items, up to 10.
            Each includes entity_id, entity_type, title, description, and
            content_preview for prompt building. Content previews are
            truncated to 1000 chars in the prompt.
        llm_service: LLM service instance for making completion calls.
        config: Resolved LLM config (model, key, key source).
        timeout: Seconds to wait for the LLM response before raising. Defaults to
            the UI-tuned value; evals pass a longer value for resilience.
        num_retries: Retry count on transient LLM failures. Defaults to the
            UI-tuned value; evals pass a higher value for resilience.

    Returns:
        Tuple of (candidates, cost). Returned candidates are validated as a
        subset of input candidate IDs (no hallucinated IDs) and capped at 5.
        Returns ([], None) immediately if candidates is empty (no LLM call).

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    if not candidates:
        return [], None

    messages = build_relationship_suggestion_messages(
        source_title=title,
        source_url=url,
        source_description=description,
        source_content_snippet=content_snippet,
        candidates=candidates,
    )

    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestRelationshipsResponse,
        timeout=timeout,
        num_retries=num_retries,
    )

    parsed = _parse_response(response, SuggestRelationshipsResponse, cost)

    # Only return candidates that were in the input set (no hallucinated IDs)
    valid_ids = {c.entity_id for c in candidates}
    filtered = [c for c in parsed.candidates if c.entity_id in valid_ids]

    return filtered[:_MAX_RELATIONSHIPS], cost


async def suggest_prompt_arguments(
    *,
    prompt_content: str,
    arguments: list[ArgumentInput],
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int = _SUGGESTION_TIMEOUT_DEFAULT,
    num_retries: int = _SUGGESTION_NUM_RETRIES_DEFAULT,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """
    Generate `{name, description, required}` entries for every placeholder
    in `prompt_content` that is not already declared in `arguments` (by
    name, case-insensitive).

    Uses `_GenerateAllArgumentsResult` as the LLM response_format and maps
    the internal shape onto the public `ArgumentSuggestion` list.

    Returns:
        Tuple of (suggestions, cost). `([], None)` (no LLM call) when
        either (a) the template has no `{{ }}` placeholders, or (b) every
        placeholder is already declared. Invalid argument names from the
        LLM response are filtered out.

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable
            output. Carries cost so the caller can still track spend.
    """
    all_placeholders = extract_template_placeholders(prompt_content)
    existing_names = {(a.name or "").lower() for a in arguments if a.name}
    placeholder_names = [
        p for p in all_placeholders if p.lower() not in existing_names
    ]
    if not placeholder_names:
        return [], None

    messages = build_generate_all_arguments_messages(
        prompt_content=prompt_content,
        existing_arguments=arguments,
        placeholder_names=placeholder_names,
    )

    response, cost = await llm_service.complete(
        messages=messages, config=config,
        response_format=_GenerateAllArgumentsResult,
        timeout=timeout,
        num_retries=num_retries,
    )

    parsed = _parse_response(response, _GenerateAllArgumentsResult, cost)

    valid_args: list[ArgumentSuggestion] = []
    for arg in parsed.arguments:
        try:
            validated_name = validate_argument_name(arg.name)
            valid_args.append(
                ArgumentSuggestion(
                    name=validated_name,
                    description=arg.description,
                    required=arg.required,
                ),
            )
        except ValueError:
            logger.debug("filtered_invalid_argument_name", extra={"name": arg.name})

    return valid_args, cost


async def suggest_prompt_argument_fields(
    *,
    prompt_content: str | None,
    arguments: list[ArgumentInput],
    target_index: int,
    target_fields: list[Literal["name", "description"]],
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int = _SUGGESTION_TIMEOUT_DEFAULT,
    num_retries: int = _SUGGESTION_NUM_RETRIES_DEFAULT,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """
    Refine one argument row by regenerating one or both of its fields.

    Dispatches on `len(target_fields)`:
    - 1 → single-field LLM call (`ArgumentNameSuggestion` or
      `ArgumentDescriptionSuggestion`). Preserves the opposite field and
      the row's existing `required` flag context (returned `required=False`
      since single-field refine has no template-wide visibility).
    - 2 → two-field LLM call (`_BothArgumentFieldsSuggestion`). The
      service pre-filters unclaimed placeholder names from the template
      so the LLM never proposes a colliding name; a defensive post-check
      rejects the response if the LLM ignores the pre-filter.

    Returns:
        Tuple of (suggestions, cost). Empty list when:
        - The generated name fails `validate_argument_name` (quota charged).
        - Two-field path: every template placeholder is already claimed
          (no LLM call; `([], None)`).
        - Two-field path: the LLM returned a name colliding with an
          existing row despite the pre-filter (quota charged).

    Raises:
        ValueError: If `target_index >= len(arguments)`.
        LLMResponseParseError: If the LLM returns invalid/unparseable
            output. Carries cost so the caller can still track spend.
    """
    if target_index >= len(arguments):
        raise ValueError(
            f"target_index {target_index} is out of range "
            f"(arguments has {len(arguments)} items)",
        )

    target_arg = arguments[target_index]

    if len(target_fields) == 1:
        return await _refine_single_field(
            target_field=target_fields[0],
            target_arg=target_arg,
            arguments=arguments,
            prompt_content=prompt_content,
            llm_service=llm_service,
            config=config,
            timeout=timeout,
            num_retries=num_retries,
        )
    if len(target_fields) == 2:
        # Two-field path requires template grounding. Schema-validated
        # callers cannot reach this branch with prompt_content=None
        # (model_validator rejects it 422), but direct service callers
        # (evals, unit tests) can — fail loudly with a helpful message
        # rather than silently generating a broken prompt.
        if prompt_content is None:
            raise ValueError(
                "prompt_content is required when target_fields has both "
                "'name' and 'description'",
            )
        return await _refine_both_fields(
            target_index=target_index,
            arguments=arguments,
            prompt_content=prompt_content,
            llm_service=llm_service,
            config=config,
            timeout=timeout,
            num_retries=num_retries,
        )
    raise ValueError(
        f"target_fields must have 1 or 2 elements, got {len(target_fields)}",
    )


async def _refine_single_field(
    *,
    target_field: Literal["name", "description"],
    target_arg: ArgumentInput,
    arguments: list[ArgumentInput],
    prompt_content: str | None,
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int,
    num_retries: int,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """Suggest just `name` or just `description` for one row."""
    messages = build_refine_single_field_messages(
        target_field=target_field,
        target_arg=target_arg,
        existing_arguments=arguments,
        prompt_content=prompt_content,
    )

    if target_field == "name":
        response, cost = await llm_service.complete(
            messages=messages, config=config,
            response_format=ArgumentNameSuggestion,
            timeout=timeout,
            num_retries=num_retries,
        )
        parsed = _parse_response(response, ArgumentNameSuggestion, cost)
        try:
            validated_name = validate_argument_name(parsed.name)
        except ValueError:
            return [], cost
        return [ArgumentSuggestion(
            name=validated_name,
            description=target_arg.description or "",
            required=False,
        )], cost

    response, cost = await llm_service.complete(
        messages=messages, config=config,
        response_format=ArgumentDescriptionSuggestion,
        timeout=timeout,
        num_retries=num_retries,
    )
    parsed = _parse_response(response, ArgumentDescriptionSuggestion, cost)
    return [ArgumentSuggestion(
        name=target_arg.name or "",
        description=parsed.description,
        required=False,
    )], cost


async def _refine_both_fields(
    *,
    target_index: int,
    arguments: list[ArgumentInput],
    prompt_content: str,
    llm_service: LLMService,
    config: LLMConfig,
    timeout: int,
    num_retries: int,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """Regenerate both `name` and `description` for one row, template-grounded."""
    all_placeholders = extract_template_placeholders(prompt_content)
    # Exclude names claimed by any OTHER row — the target row's current
    # name (if any) is being overwritten, so it should not be excluded.
    claimed_names = {
        (a.name or "").lower()
        for i, a in enumerate(arguments)
        if i != target_index and a.name
    }
    unclaimed_placeholder_names = [
        p for p in all_placeholders if p.lower() not in claimed_names
    ]
    if not unclaimed_placeholder_names:
        return [], None

    messages = build_refine_both_fields_messages(
        target_index=target_index,
        existing_arguments=arguments,
        prompt_content=prompt_content,
        unclaimed_placeholder_names=unclaimed_placeholder_names,
    )
    response, cost = await llm_service.complete(
        messages=messages, config=config,
        response_format=_BothArgumentFieldsSuggestion,
        timeout=timeout,
        num_retries=num_retries,
    )
    parsed = _parse_response(response, _BothArgumentFieldsSuggestion, cost)

    try:
        validated_name = validate_argument_name(parsed.name)
    except ValueError:
        return [], cost

    # Defensive backstop: if the LLM ignored the unclaimed-only prompt and
    # picked a name that collides with another row, reject it.
    if validated_name.lower() in claimed_names:
        logger.debug(
            "refine_both_fields_rejected_claimed_name",
            extra={"name": validated_name},
        )
        return [], cost

    return [ArgumentSuggestion(
        name=validated_name,
        description=parsed.description,
        required=parsed.required,
    )], cost
