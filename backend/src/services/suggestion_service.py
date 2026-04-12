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

from pydantic import ValidationError

from schemas.ai import (
    ArgumentInput,
    ArgumentSuggestion,
    RelationshipCandidate,
    RelationshipCandidateContext,
    SuggestArgumentsResponse,
    SuggestRelationshipsResponse,
    SuggestTagsResponse,
    TagVocabularyEntry,
    _DescriptionOnly,
    _TitleAndDescription,
    _TitleOnly,
)
from schemas.validators import validate_argument_name
from services.llm_prompts import (
    build_argument_suggestion_messages,
    build_metadata_suggestion_messages,
    build_relationship_suggestion_messages,
    build_tag_suggestion_messages,
    extract_template_placeholders,
)
from services.llm_service import LLMConfig, LLMService

logger = logging.getLogger(__name__)

# Response caps enforced after post-processing
_MAX_TAGS = 7
_MAX_RELATIONSHIPS = 5


class LLMResponseParseError(Exception):
    """Raised when the LLM returns a response that cannot be parsed into the expected schema."""

    def __init__(self, message: str, cost: float | None = None) -> None:
        super().__init__(message)
        self.cost = cost


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
) -> tuple[MetadataSuggestion, float | None]:
    """
    Suggest title and/or description for a content item.

    The fields parameter controls which fields are generated. Existing values
    for non-requested fields are sent as context but not regenerated.

    Args:
        fields: Which fields to generate. Must contain at least one of
            "title", "description". Controls which structured output schema
            is used (_TitleOnly, _DescriptionOnly, _TitleAndDescription).
        url: Item URL.
        title: Existing title (context, not regenerated unless requested).
        description: Existing description (context).
        content_snippet: Item content.
        llm_service: LLM service instance for making completion calls.
        config: Resolved LLM config (model, key, key source).

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
        response_format = _TitleAndDescription
    elif generate_title:
        response_format = _TitleOnly
    else:
        response_format = _DescriptionOnly

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
    )

    parsed = _parse_response(response, SuggestRelationshipsResponse, cost)

    # Only return candidates that were in the input set (no hallucinated IDs)
    valid_ids = {c.entity_id for c in candidates}
    filtered = [c for c in parsed.candidates if c.entity_id in valid_ids]

    return filtered[:_MAX_RELATIONSHIPS], cost


async def suggest_arguments(
    *,
    prompt_content: str | None,
    arguments: list[ArgumentInput],
    target: str | None,
    llm_service: LLMService,
    config: LLMConfig,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """
    Suggest prompt template arguments.

    Two modes based on target:
    - target=None (generate-all): Extracts {{ placeholder }} names from
      prompt_content, excludes names already in arguments, and asks the LLM
      to generate descriptions for new placeholders. Returns early with an
      empty list if no new placeholders are found (no LLM call).
    - target=<name> (individual): Suggests a name and/or description for
      a specific argument.

    Args:
        prompt_content: The Jinja2 template text. Used for placeholder
            extraction in generate-all mode and as context in both modes.
        arguments: Existing arguments. In generate-all mode, names are
            excluded from placeholder extraction.
        target: Argument name to suggest for, or None for generate-all.
        llm_service: LLM service instance for making completion calls.
        config: Resolved LLM config (model, key, key source).

    Returns:
        Tuple of (suggestions, cost). Argument names are validated against
        ARGUMENT_NAME_PATTERN (lowercase_with_underscores, starts with letter);
        invalid names are filtered out. If the LLM omits `required`, it
        defaults to False (ArgumentSuggestion schema default).
        Returns ([], None) in generate-all mode if prompt_content is
        None or all placeholders already have arguments (no LLM call).

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    # For "generate all", extract placeholders deterministically from template
    placeholder_names = None
    if target is None:
        if not prompt_content:
            return [], None
        all_placeholders = extract_template_placeholders(prompt_content)
        existing_names = {
            (a.name or "").lower()
            for a in arguments
            if a.name
        }
        placeholder_names = [
            p for p in all_placeholders if p.lower() not in existing_names
        ]
        if not placeholder_names:
            return [], None

    messages = build_argument_suggestion_messages(
        prompt_content=prompt_content,
        existing_arguments=arguments,
        target=target,
        placeholder_names=placeholder_names,
    )

    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestArgumentsResponse,
    )

    parsed = _parse_response(response, SuggestArgumentsResponse, cost)

    # Filter out arguments with invalid names
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
