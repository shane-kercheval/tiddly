"""Unit tests for AI schema types."""
import typing

from schemas.ai import (
    CONTENT_SNIPPET_LLM_WINDOW_CHARS,
    CONTENT_SNIPPET_MAX_CHARS,
    AIModelEntry,
    AIUseCaseKey,
    SuggestArgumentsRequest,
    SuggestMetadataRequest,
    SuggestRelationshipsRequest,
    SuggestTagsRequest,
    ValidateKeyRequest,
)
from services.llm_service import (
    _SUPPORTED_MODEL_DEFS,
    _SUPPORTED_MODEL_IDS,
    AIUseCase,
)


class TestAIUseCaseKeyDriftGuard:
    """
    Guards against drift between `schemas.ai.AIUseCaseKey` (the hand-written
    Literal exposed in the OpenAPI spec) and `services.llm_service.AIUseCase`
    (the runtime enum). Python's type system can't unify these, so a runtime
    test is the last line of defense.
    """

    def test__ai_use_case_key__matches_ai_use_case_enum_values(self) -> None:
        literal_values = set(typing.get_args(AIUseCaseKey))
        enum_values = {uc.value for uc in AIUseCase}
        assert literal_values == enum_values, (
            f"AIUseCaseKey Literal and AIUseCase enum drifted. "
            f"Literal has {literal_values}, enum has {enum_values}. "
            f"Add/remove values on both sides (see schemas/ai.py and "
            f"services/llm_service.py)."
        )


class TestAIModelEntryDriftGuard:
    """
    Guards against drift between the hand-written `Literal`s on
    `AIModelEntry.provider` / `.tier` (exposed in OpenAPI as enums) and the
    runtime catalog `services.llm_service._SUPPORTED_MODEL_DEFS`.

    Without these guards, adding a new provider or tier to `_SUPPORTED_MODEL_DEFS`
    without updating the Literal would cause Pydantic `ValidationError` at
    `/ai/models` response-build time — i.e., in production, not at import time
    or in CI.
    """

    def test__ai_model_entry_provider__covers_every_catalog_provider(self) -> None:
        literal_values = set(
            typing.get_args(AIModelEntry.model_fields["provider"].annotation),
        )
        catalog_providers = {defn["provider"] for defn in _SUPPORTED_MODEL_DEFS}
        missing = catalog_providers - literal_values
        assert not missing, (
            f"AIModelEntry.provider Literal is missing providers present in "
            f"_SUPPORTED_MODEL_DEFS: {missing}. Add them to the Literal in "
            f"schemas/ai.py."
        )

    def test__ai_model_entry_tier__covers_every_catalog_tier(self) -> None:
        literal_values = set(
            typing.get_args(AIModelEntry.model_fields["tier"].annotation),
        )
        catalog_tiers = {defn["tier"] for defn in _SUPPORTED_MODEL_DEFS}
        missing = catalog_tiers - literal_values
        assert not missing, (
            f"AIModelEntry.tier Literal is missing tiers present in "
            f"_SUPPORTED_MODEL_DEFS: {missing}. Add them to the Literal in "
            f"schemas/ai.py."
        )


class TestSchemaExampleModelIdsDriftGuard:
    """
    Guards against stale model IDs in OpenAPI examples.

    Several request schemas hardcode model IDs in `json_schema_extra.examples`
    (e.g. `"openai/gpt-5.4-nano"`). These are not checked against the runtime
    model catalog (`_SUPPORTED_MODEL_IDS`), so deprecating or renaming a
    model would leave stale examples in Swagger. This test catches that at
    CI time instead of at the next time someone notices the docs are wrong.
    """

    def test__every_example_model_id__is_in_supported_catalog(self) -> None:
        # Models whose request schemas contain a `model` key in their examples.
        # Response schemas and internal-only models excluded.
        schemas_with_examples = [
            SuggestTagsRequest,
            SuggestMetadataRequest,
            SuggestRelationshipsRequest,
            SuggestArgumentsRequest,
            ValidateKeyRequest,
        ]
        offenders: list[tuple[str, str]] = []
        for schema in schemas_with_examples:
            extra = schema.model_config.get("json_schema_extra")
            if not isinstance(extra, dict):
                continue
            for example in extra.get("examples", []):
                model_id = example.get("model")
                if model_id is None:
                    continue
                if model_id not in _SUPPORTED_MODEL_IDS:
                    offenders.append((schema.__name__, model_id))

        assert not offenders, (
            f"OpenAPI examples reference model IDs not in _SUPPORTED_MODEL_IDS: "
            f"{offenders}. Update the schema examples to use a currently-supported "
            f"model ID (see services/llm_service.py::_SUPPORTED_MODEL_DEFS)."
        )


class TestContentSnippetDriftGuard:
    """
    Guards against drift between the content_snippet constants and their
    usage sites — the API-boundary `max_length` Pydantic validator, the
    LLM-prompt truncation in `services/llm_prompts.py`, and the numbers
    quoted in field / endpoint documentation.

    Keeping the two constants in `schemas/ai.py` (source) means
    `llm_prompts.py` references them directly. The two tests below enforce
    the remaining invariants the type system can't.
    """

    def test__window_is_strictly_less_than_max(self) -> None:
        """
        LLM window must be strictly less than max accepted.

        If the window were equal to the max, the truncation slice in
        `llm_prompts.py` would be a no-op and the prose docs describing
        "sending more is wasted bandwidth" would be misleading — there'd
        be no wasted bandwidth because the full payload would reach the
        LLM. The gap between the two values is load-bearing.
        """
        assert CONTENT_SNIPPET_LLM_WINDOW_CHARS < CONTENT_SNIPPET_MAX_CHARS

    def test__schema_max_length_uses_the_constant(self) -> None:
        """
        Every request schema with `content_snippet` must set `max_length` from
        `CONTENT_SNIPPET_MAX_CHARS`, not a hardcoded literal.
        """
        for model in (
            SuggestTagsRequest,
            SuggestMetadataRequest,
            SuggestRelationshipsRequest,
        ):
            field = model.model_fields["content_snippet"]
            max_lengths = [
                m.max_length for m in field.metadata if hasattr(m, "max_length")
            ]
            assert CONTENT_SNIPPET_MAX_CHARS in max_lengths, (
                f"{model.__name__}.content_snippet doesn't use "
                f"CONTENT_SNIPPET_MAX_CHARS; found max_length constraints: "
                f"{max_lengths}. Use the constant from schemas/ai.py."
            )
