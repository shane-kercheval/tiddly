"""Unit tests for AI schema types."""
import typing

import pytest
from pydantic import ValidationError

from schemas.ai import (
    CONTENT_SNIPPET_LLM_WINDOW_CHARS,
    CONTENT_SNIPPET_MAX_CHARS,
    AIModelEntry,
    AIUseCaseKey,
    ArgumentInput,
    SuggestMetadataRequest,
    SuggestPromptArgumentFieldsRequest,
    SuggestPromptArgumentsRequest,
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
            SuggestPromptArgumentsRequest,
            SuggestPromptArgumentFieldsRequest,
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


# ---------------------------------------------------------------------------
# SuggestPromptArgumentsRequest (plural — generate-all)
# ---------------------------------------------------------------------------


class TestSuggestPromptArgumentsRequest:
    """Schema-boundary behavior for the plural endpoint's request model."""

    def test__missing_prompt_content__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentsRequest()  # type: ignore[call-arg]

    def test__empty_prompt_content__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentsRequest(prompt_content="")

    def test__whitespace_only_prompt_content__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentsRequest(prompt_content="   ")

    def test__accepts_valid_prompt_content(self) -> None:
        req = SuggestPromptArgumentsRequest(prompt_content="Hello {{ name }}")
        assert req.prompt_content == "Hello {{ name }}"
        assert req.arguments == []

    def test__strips_leading_trailing_whitespace_on_prompt_content(self) -> None:
        req = SuggestPromptArgumentsRequest(prompt_content="  template  ")
        assert req.prompt_content == "template"

    def test__oversize_prompt_content__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentsRequest(prompt_content="x" * 50_001)


# ---------------------------------------------------------------------------
# SuggestPromptArgumentFieldsRequest (singular — refine fields)
# ---------------------------------------------------------------------------


def _base_args() -> list[dict]:
    """A non-empty arguments list with a populated row at index 0."""
    return [{"name": "language", "description": "The language to use"}]


class TestSuggestPromptArgumentFieldsRequest:
    """Schema-boundary behavior for the singular endpoint's request model."""

    # ------------------------------ required fields ------------------------

    def test__missing_all_required_fields__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentFieldsRequest()  # type: ignore[call-arg]

    def test__missing_target_fields__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentFieldsRequest(  # type: ignore[call-arg]
                arguments=_base_args(),
                target_index=0,
            )

    def test__missing_target_index__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentFieldsRequest(  # type: ignore[call-arg]
                arguments=_base_args(),
                target_fields=["description"],
            )

    def test__missing_arguments__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentFieldsRequest(  # type: ignore[call-arg]
                target_index=0,
                target_fields=["name"],
                prompt_content="hi {{ x }}",
            )

    # ------------------------------ arguments -------------------------------

    def test__empty_arguments_list__rejected(self) -> None:
        with pytest.raises(ValidationError, match="at least one entry"):
            SuggestPromptArgumentFieldsRequest(
                arguments=[],
                target_index=0,
                target_fields=["description"],
                prompt_content="hi {{ x }}",
            )

    # ------------------------------ target_fields ---------------------------

    def test__empty_target_fields__rejected(self) -> None:
        with pytest.raises(ValidationError, match="at least one"):
            SuggestPromptArgumentFieldsRequest(
                arguments=_base_args(),
                target_index=0,
                target_fields=[],
            )

    def test__unknown_target_fields_element__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentFieldsRequest(
                arguments=_base_args(),
                target_index=0,
                target_fields=["foo"],  # type: ignore[list-item]
            )

    def test__duplicate_target_fields__rejected(self) -> None:
        with pytest.raises(ValidationError, match="duplicates"):
            SuggestPromptArgumentFieldsRequest(
                arguments=_base_args(),
                target_index=0,
                target_fields=["name", "name"],
            )

    def test__target_fields_three_elements_with_duplicate_rejected(self) -> None:
        """Length-3 input with a duplicate hits the duplicate guard."""
        with pytest.raises(ValidationError, match="duplicates"):
            SuggestPromptArgumentFieldsRequest(
                arguments=_base_args(),
                target_index=0,
                target_fields=["name", "description", "name"],
            )

    def test__target_fields_canonicalized_to_name_first(self) -> None:
        req = SuggestPromptArgumentFieldsRequest(
            arguments=_base_args(),
            target_index=0,
            target_fields=["description", "name"],
            prompt_content="hi {{ x }}",
        )
        assert req.target_fields == ["name", "description"]

    # ------------------------------ target_index ----------------------------

    def test__negative_target_index__rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestPromptArgumentFieldsRequest(
                arguments=_base_args(),
                target_index=-1,
                target_fields=["description"],
            )

    def test__target_index_out_of_range__accepted_at_schema_layer(self) -> None:
        """
        Schema-layer model_validator short-circuits when index is out of range;
        service-layer handles it as a 400. Schema must not reject here.
        """
        req = SuggestPromptArgumentFieldsRequest(
            arguments=_base_args(),
            target_index=99,
            target_fields=["description"],
        )
        assert req.target_index == 99

    # ------------------------------ prompt_content --------------------------

    def test__empty_prompt_content__normalized_to_none(self) -> None:
        """
        Empty string is normalized to None by the `mode="before"` validator
        (same treatment as whitespace-only). Downstream sees canonical None
        rather than an empty string. Whether the request overall succeeds
        depends on the grounding rule — the base-args row has a name, so
        grounding is satisfied here.
        """
        req = SuggestPromptArgumentFieldsRequest(
            arguments=_base_args(),
            target_index=0,
            target_fields=["description"],
            prompt_content="",
        )
        assert req.prompt_content is None

    def test__whitespace_only_prompt_content__normalized_to_none(self) -> None:
        # With the target row's name populated, the grounding signal is
        # satisfied even without a template — so we can observe that
        # whitespace-only input normalized to None rather than being rejected
        # outright by min_length=1. (That rejection path is covered in
        # test__empty_prompt_content__rejected.)
        req = SuggestPromptArgumentFieldsRequest(
            arguments=_base_args(),
            target_index=0,
            target_fields=["description"],
            prompt_content="   ",
        )
        assert req.prompt_content is None

    # ------------------------------ grounding signal ------------------------

    def test__name_only__no_description_no_template__rejected(self) -> None:
        with pytest.raises(ValidationError, match="no grounding signal"):
            SuggestPromptArgumentFieldsRequest(
                arguments=[{"name": None, "description": None}],
                target_index=0,
                target_fields=["name"],
                prompt_content=None,
            )

    def test__description_only__no_name_no_template__rejected(self) -> None:
        with pytest.raises(ValidationError, match="no grounding signal"):
            SuggestPromptArgumentFieldsRequest(
                arguments=[{"name": None, "description": None}],
                target_index=0,
                target_fields=["description"],
                prompt_content=None,
            )

    def test__both_fields__no_template__rejected(self) -> None:
        with pytest.raises(
            ValidationError, match="both name and description without prompt_content",
        ):
            SuggestPromptArgumentFieldsRequest(
                arguments=[{"name": None, "description": None}],
                target_index=0,
                target_fields=["name", "description"],
                prompt_content=None,
            )

    def test__name_only__opposite_field_empty_rules(self) -> None:
        """
        For `target_fields=["name"]`, the row's own `name` doesn't count as
        grounding — the `description` (opposite field) must be present, or
        `prompt_content` must be provided.
        """
        with pytest.raises(ValidationError, match="no grounding signal"):
            SuggestPromptArgumentFieldsRequest(
                arguments=[{"name": "already_here", "description": None}],
                target_index=0,
                target_fields=["name"],
                prompt_content=None,
            )

    def test__description_only__opposite_field_empty_rules(self) -> None:
        with pytest.raises(ValidationError, match="no grounding signal"):
            SuggestPromptArgumentFieldsRequest(
                arguments=[{"name": None, "description": "An existing description."}],
                target_index=0,
                target_fields=["description"],
                prompt_content=None,
            )

    def test__both_fields_with_template__accepted(self) -> None:
        req = SuggestPromptArgumentFieldsRequest(
            arguments=[{"name": None, "description": None}],
            target_index=0,
            target_fields=["name", "description"],
            prompt_content="Hello {{ x }}",
        )
        assert req.target_fields == ["name", "description"]

    def test__name_only_with_empty_row_but_template__accepted(self) -> None:
        req = SuggestPromptArgumentFieldsRequest(
            arguments=[{"name": None, "description": None}],
            target_index=0,
            target_fields=["name"],
            prompt_content="Hello {{ x }}",
        )
        assert req.target_fields == ["name"]

    def test__whitespace_only_target_fields_normalize_to_none_trigger_grounding(
        self,
    ) -> None:
        """
        If the target row's fields are whitespace-only, the ArgumentInput
        normalizer converts them to None, so the grounding check fires
        with a helpful message rather than silently passing.
        """
        with pytest.raises(ValidationError, match="no grounding signal"):
            SuggestPromptArgumentFieldsRequest(
                arguments=[{"name": "   ", "description": "   "}],
                target_index=0,
                target_fields=["name"],
                prompt_content=None,
            )


# ---------------------------------------------------------------------------
# ArgumentInput whitespace normalization
# ---------------------------------------------------------------------------


class TestArgumentInputWhitespaceNormalization:
    """
    Whitespace in name/description is stripped; whitespace-only becomes None.

    This is the single canonicalization point for whitespace — the prompt
    builder, LLM call, logs, tests, and evals never see leading/trailing
    whitespace or whitespace-only strings.
    """

    def test__trims_leading_trailing_whitespace(self) -> None:
        arg = ArgumentInput(name="  foo  ", description="  bar  ")
        assert arg.name == "foo"
        assert arg.description == "bar"

    def test__whitespace_only_name_becomes_none(self) -> None:
        arg = ArgumentInput(name="   ", description="bar")
        assert arg.name is None
        assert arg.description == "bar"

    def test__empty_strings_become_none(self) -> None:
        arg = ArgumentInput(name="", description="")
        assert arg.name is None
        assert arg.description is None

    def test__trim_brings_value_within_max_length(self) -> None:
        # 200 non-space chars + trailing whitespace — trim → passes max_length=200.
        arg = ArgumentInput(name="a" * 200 + "   ", description=None)
        assert arg.name == "a" * 200
