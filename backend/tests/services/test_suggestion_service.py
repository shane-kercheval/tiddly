"""
Tests for the suggestion service layer.

Tests core logic (dedup, caps, filtering, error handling) by mocking
llm_service.complete(). No DB or HTTP dependencies.
"""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from schemas.ai import (
    ArgumentInput,
    RelationshipCandidateContext,
    TagVocabularyEntry,
)
from services._suggestion_llm_schemas import (
    ArgumentDescriptionSuggestion,
    ArgumentNameSuggestion,
    _BothArgumentFieldsSuggestion,
    _GenerateAllArgumentsResult,
)
from services.suggestion_service import (
    LLMResponseParseError,
    suggest_metadata,
    suggest_prompt_argument_fields,
    suggest_prompt_arguments,
    suggest_relationships,
    suggest_tags,
)


def _mock_llm_service(content: str, cost: float | None = 0.001) -> MagicMock:
    """Create a mock LLMService with a complete() that returns given content."""
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = content
    response.model = "test-model"

    service = MagicMock()
    service.complete = AsyncMock(return_value=(response, cost))
    return service


def _mock_config() -> MagicMock:
    """Create a mock LLMConfig."""
    config = MagicMock()
    config.model = "gemini/gemini-flash-lite-latest"
    config.key_source = "platform"
    return config


def _empty_response_service(cost: float | None = 0.001) -> MagicMock:
    """Create a mock LLMService that returns an empty choices list."""
    response = MagicMock()
    response.choices = []
    response.model = "test-model"

    service = MagicMock()
    service.complete = AsyncMock(return_value=(response, cost))
    return service


def _none_content_service(cost: float | None = 0.001) -> MagicMock:
    """Create a mock LLMService that returns None content."""
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = None
    response.model = "test-model"

    service = MagicMock()
    service.complete = AsyncMock(return_value=(response, cost))
    return service


# ---------------------------------------------------------------------------
# suggest_tags
# ---------------------------------------------------------------------------


class TestSuggestTags:
    """Tests for suggest_tags service function."""

    async def test_returns_tags(self) -> None:
        service = _mock_llm_service('{"tags": ["python", "flask", "api"]}')
        tags, cost = await suggest_tags(
            title="Flask Tutorial",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert tags == ["python", "flask", "api"]
        assert cost == 0.001

    async def test_dedup_case_insensitive(self) -> None:
        service = _mock_llm_service('{"tags": ["Python", "flask", "API"]}')
        tags, _ = await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=["python", "api"],
            tag_vocabulary=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert tags == ["flask"]

    async def test_cap_at_7(self) -> None:
        many_tags = json.dumps({"tags": [f"tag-{i}" for i in range(10)]})
        service = _mock_llm_service(many_tags)
        tags, _ = await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert len(tags) == 7

    async def test_empty_response(self) -> None:
        service = _mock_llm_service('{"tags": []}')
        tags, _ = await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert tags == []

    async def test_parse_error_raises_with_cost(self) -> None:
        service = _mock_llm_service("not valid json", cost=0.002)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_tags(
                title="Test",
                url=None,
                description=None,
                content_snippet=None,
                content_type="bookmark",
                current_tags=[],
                tag_vocabulary=[],

                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.002

    async def test_empty_choices_raises_parse_error(self) -> None:
        service = _empty_response_service(cost=0.003)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_tags(
                title="Test",
                url=None,
                description=None,
                content_snippet=None,
                content_type="bookmark",
                current_tags=[],
                tag_vocabulary=[],

                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.003

    async def test_none_content_raises_parse_error(self) -> None:
        service = _none_content_service(cost=0.004)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_tags(
                title="Test",
                url=None,
                description=None,
                content_snippet=None,
                content_type="bookmark",
                current_tags=[],
                tag_vocabulary=[],

                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.004

    async def test_cost_passthrough(self) -> None:
        service = _mock_llm_service('{"tags": ["test"]}', cost=0.05)
        _, cost = await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert cost == 0.05

    async def test_cost_none_passthrough(self) -> None:
        service = _mock_llm_service('{"tags": ["test"]}', cost=None)
        _, cost = await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert cost is None

    async def test_passes_vocabulary_to_prompt(self) -> None:
        """Verify vocabulary is passed through to the LLM call."""
        service = _mock_llm_service('{"tags": ["python"]}')
        vocab = [TagVocabularyEntry(name="python", count=47)]
        await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=vocab,
            llm_service=service,
            config=_mock_config(),
        )
        call_kwargs = service.complete.call_args.kwargs
        system_msg = call_kwargs["messages"][0]["content"]
        assert "python (47)" in system_msg


# ---------------------------------------------------------------------------
# suggest_metadata
# ---------------------------------------------------------------------------


class TestSuggestMetadata:
    """Tests for suggest_metadata service function."""

    async def test_title_only(self) -> None:
        service = _mock_llm_service('{"title": "A Great Title"}')
        result, cost = await suggest_metadata(
            fields=["title"],
            url=None,
            title=None,
            description="Existing desc",
            content_snippet="Some content",
            llm_service=service,
            config=_mock_config(),
        )
        assert result.title == "A Great Title"
        assert result.description is None
        assert cost == 0.001

    async def test_description_only(self) -> None:
        service = _mock_llm_service('{"description": "A summary."}')
        result, _ = await suggest_metadata(
            fields=["description"],
            url=None,
            title="Existing Title",
            description=None,
            content_snippet="Some content",
            llm_service=service,
            config=_mock_config(),
        )
        assert result.title is None
        assert result.description == "A summary."

    async def test_both_fields(self) -> None:
        service = _mock_llm_service('{"title": "T", "description": "D"}')
        result, _ = await suggest_metadata(
            fields=["title", "description"],
            url=None,
            title=None,
            description=None,
            content_snippet="Some content",
            llm_service=service,
            config=_mock_config(),
        )
        assert result.title == "T"
        assert result.description == "D"

    async def test_parse_error_raises_with_cost(self) -> None:
        service = _mock_llm_service("invalid", cost=0.005)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_metadata(
                fields=["title"],
                url=None,
                title=None,
                description=None,
                content_snippet=None,
                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.005


# ---------------------------------------------------------------------------
# suggest_relationships
# ---------------------------------------------------------------------------


class TestSuggestRelationships:
    """Tests for suggest_relationships service function."""

    def _make_candidates(self, n: int) -> list[RelationshipCandidateContext]:
        return [
            RelationshipCandidateContext(
                entity_id=f"id-{i}",
                entity_type="bookmark",
                title=f"Item {i}",
                description=f"Description {i}",
                content_preview=f"Preview {i}",
            )
            for i in range(n)
        ]

    async def test_empty_candidates_returns_early(self) -> None:
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_relationships(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            candidates=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost is None
        service.complete.assert_not_called()

    async def test_filters_hallucinated_ids(self) -> None:
        candidates = self._make_candidates(3)
        response_content = json.dumps({"candidates": [
            {"entity_id": "id-0", "entity_type": "bookmark", "title": "Item 0"},
            {"entity_id": "hallucinated-id", "entity_type": "bookmark", "title": "Fake"},
            {"entity_id": "id-2", "entity_type": "bookmark", "title": "Item 2"},
        ]})
        service = _mock_llm_service(response_content)
        result, _ = await suggest_relationships(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            candidates=candidates,
            llm_service=service,
            config=_mock_config(),
        )
        ids = [c.entity_id for c in result]
        assert "hallucinated-id" not in ids
        assert ids == ["id-0", "id-2"]

    async def test_cap_at_5(self) -> None:
        candidates = self._make_candidates(8)
        response_content = json.dumps({"candidates": [
            {"entity_id": f"id-{i}", "entity_type": "bookmark", "title": f"Item {i}"}
            for i in range(8)
        ]})
        service = _mock_llm_service(response_content)
        result, _ = await suggest_relationships(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            candidates=candidates,
            llm_service=service,
            config=_mock_config(),
        )
        assert len(result) == 5

    async def test_parse_error_raises_with_cost(self) -> None:
        candidates = self._make_candidates(2)
        service = _mock_llm_service("bad json", cost=0.01)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_relationships(
                title="Test",
                url=None,
                description=None,
                content_snippet=None,
                candidates=candidates,
                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.01


# ---------------------------------------------------------------------------
# suggest_prompt_arguments (plural — generate-all)
# ---------------------------------------------------------------------------


class TestSuggestPromptArguments:
    """Tests for the generate-all service function."""

    async def test_extracts_placeholders(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic"},
            {"name": "language", "description": "The language"},
        ]})
        service = _mock_llm_service(content)
        result, cost = await suggest_prompt_arguments(
            prompt_content="Explain {{ topic }} in {{ language }}.",
            arguments=[],
            llm_service=service,
            config=_mock_config(),
        )
        names = [a.name for a in result]
        assert "topic" in names
        assert "language" in names
        assert cost == 0.001

    async def test_excludes_existing_placeholders(self) -> None:
        """Case-insensitive dedup against existing arguments."""
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic"},
        ]})
        service = _mock_llm_service(content)
        result, _ = await suggest_prompt_arguments(
            prompt_content="Explain {{ topic }} in {{ Language }}.",
            arguments=[ArgumentInput(name="LANGUAGE", description="Already exists")],
            llm_service=service,
            config=_mock_config(),
        )
        names = [a.name for a in result]
        assert "topic" in names
        assert not any(n.lower() == "language" for n in names)

    async def test_no_placeholders_short_circuits(self) -> None:
        """Raw template with no `{{ }}` → ([], None), LLM not called."""
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_prompt_arguments(
            prompt_content="Write a poem about nature. No variables here.",
            arguments=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost is None
        service.complete.assert_not_called()

    async def test_all_placeholders_defined_short_circuits(self) -> None:
        """Every placeholder already declared → ([], None), LLM not called."""
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_prompt_arguments(
            prompt_content="Hello {{ name }}",
            arguments=[ArgumentInput(name="name", description="The name")],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost is None
        service.complete.assert_not_called()

    async def test_filters_invalid_names(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "valid_name", "description": "Good"},
            {"name": "Invalid Name", "description": "Has spaces"},
            {"name": "also_valid", "description": "Fine"},
        ]})
        service = _mock_llm_service(content)
        result, _ = await suggest_prompt_arguments(
            prompt_content="{{ valid_name }} {{ also_valid }} {{ something_else }}",
            arguments=[],
            llm_service=service,
            config=_mock_config(),
        )
        names = [a.name for a in result]
        assert "valid_name" in names
        assert "also_valid" in names
        assert "Invalid Name" not in names

    async def test_required_field_preserved(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic", "required": True},
            {"name": "context", "description": "Optional", "required": False},
        ]})
        service = _mock_llm_service(content)
        result, _ = await suggest_prompt_arguments(
            prompt_content="{{ topic }} {% if context %}{{ context }}{% endif %}",
            arguments=[],
            llm_service=service,
            config=_mock_config(),
        )
        by_name = {a.name: a for a in result}
        assert by_name["topic"].required is True
        assert by_name["context"].required is False

    async def test_parse_error_raises_with_cost(self) -> None:
        service = _mock_llm_service("bad json", cost=0.01)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_prompt_arguments(
                prompt_content="{{ name }}",
                arguments=[],
                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.01

    async def test_uses_internal_llm_schema(self) -> None:
        """
        The LLM `response_format` must be the internal
        `_GenerateAllArgumentsResult`, not the public
        `SuggestPromptArgumentsResponse`. Protects the decoupling between
        LLM structured-output and HTTP contract.
        """
        content = json.dumps({"arguments": [{"name": "x", "description": "d"}]})
        service = _mock_llm_service(content)
        await suggest_prompt_arguments(
            prompt_content="{{ x }}",
            arguments=[],
            llm_service=service,
            config=_mock_config(),
        )
        call_kwargs = service.complete.call_args.kwargs
        assert call_kwargs["response_format"] is _GenerateAllArgumentsResult


# ---------------------------------------------------------------------------
# suggest_prompt_argument_fields (singular — refine fields)
# ---------------------------------------------------------------------------


class TestSuggestPromptArgumentFields:
    """Tests for the refine-fields service function."""

    # ----------------- single-field: name ---------------------------------

    async def test_refine_name_only_generates_name(self) -> None:
        """target_fields=['name'], description populated → returns new name + preserved description."""
        service = _mock_llm_service(json.dumps({"name": "programming_language"}))
        result, _ = await suggest_prompt_argument_fields(
            prompt_content=None,
            arguments=[ArgumentInput(name=None, description="The programming language to use")],
            target_index=0,
            target_fields=["name"],
            llm_service=service,
            config=_mock_config(),
        )
        assert len(result) == 1
        assert result[0].name == "programming_language"
        assert result[0].description == "The programming language to use"
        assert result[0].required is False
        call_kwargs = service.complete.call_args.kwargs
        assert call_kwargs["response_format"] is ArgumentNameSuggestion

    async def test_refine_name_only_when_both_populated_overwrites_name(self) -> None:
        """
        target_fields=['name'], both fields already populated → LLM called,
        new name overwrites, original description preserved.

        Explicit-opt-in regression test: the caller asked for name, so the
        server complies and overwrites. There is no silent inference.
        """
        service = _mock_llm_service(json.dumps({"name": "better_name"}))
        result, cost = await suggest_prompt_argument_fields(
            prompt_content=None,
            arguments=[ArgumentInput(name="original_name", description="original desc")],
            target_index=0,
            target_fields=["name"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].name == "better_name"
        assert result[0].description == "original desc"
        assert cost == 0.001
        service.complete.assert_called_once()

    async def test_refine_name_only_with_empty_target_but_template_context_calls_llm(
        self,
    ) -> None:
        """Blank row + populated template + target_fields=['name'] → LLM called."""
        service = _mock_llm_service(json.dumps({"name": "suggested"}))
        result, _ = await suggest_prompt_argument_fields(
            prompt_content="Use {{ something }}.",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["name"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].name == "suggested"
        service.complete.assert_called_once()

    async def test_invalid_name_generated_returns_empty_with_cost(self) -> None:
        """target_fields=['name'], LLM returns invalid identifier → ([], cost)."""
        service = _mock_llm_service(json.dumps({"name": "Invalid Name"}), cost=0.007)
        result, cost = await suggest_prompt_argument_fields(
            prompt_content=None,
            arguments=[ArgumentInput(name=None, description="Some description")],
            target_index=0,
            target_fields=["name"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost == 0.007

    # ----------------- single-field: description --------------------------

    async def test_refine_description_only_generates_description(self) -> None:
        """target_fields=['description'], name populated → returns preserved name + new description."""
        service = _mock_llm_service(json.dumps({"description": "The language to use"}))
        result, _ = await suggest_prompt_argument_fields(
            prompt_content=None,
            arguments=[ArgumentInput(name="language", description=None)],
            target_index=0,
            target_fields=["description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].name == "language"
        assert result[0].description == "The language to use"
        assert result[0].required is False
        call_kwargs = service.complete.call_args.kwargs
        assert call_kwargs["response_format"] is ArgumentDescriptionSuggestion

    async def test_refine_description_only_when_both_populated_overwrites_description(
        self,
    ) -> None:
        """Explicit-opt-in regression test — symmetric with the name-overwrite test."""
        service = _mock_llm_service(json.dumps({"description": "new desc"}))
        result, _ = await suggest_prompt_argument_fields(
            prompt_content=None,
            arguments=[ArgumentInput(name="language", description="original desc")],
            target_index=0,
            target_fields=["description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].name == "language"
        assert result[0].description == "new desc"
        service.complete.assert_called_once()

    # ----------------- two-field path -------------------------------------

    async def test_refine_both_fields_empty_row_with_template(self) -> None:
        """Two-field refine from a blank row + template with unclaimed placeholders."""
        service = _mock_llm_service(
            json.dumps({"name": "topic", "description": "The topic", "required": True}),
        )
        result, _ = await suggest_prompt_argument_fields(
            prompt_content="Write about {{ topic }} for {{ audience }}.",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].name == "topic"
        assert result[0].description == "The topic"
        assert result[0].required is True
        call_kwargs = service.complete.call_args.kwargs
        assert call_kwargs["response_format"] is _BothArgumentFieldsSuggestion

    async def test_refine_both_fields_overwrites_populated_row(self) -> None:
        """
        Two-field refine when target row has both fields populated — LLM is
        still called and replaces both fields. Programmatic callers may do
        this (UX does not, but the server contract is explicit).
        """
        service = _mock_llm_service(
            json.dumps({"name": "topic", "description": "new description", "required": False}),
        )
        result, _ = await suggest_prompt_argument_fields(
            prompt_content="Write about {{ topic }}.",
            arguments=[ArgumentInput(name="old_name", description="old description")],
            target_index=0,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].name == "topic"
        assert result[0].description == "new description"
        service.complete.assert_called_once()

    async def test_refine_both_fields_filters_claimed_placeholders_before_llm(
        self,
    ) -> None:
        """
        Existing arguments contain `topic`; template has `{{ topic }}` +
        `{{ audience }}`. The unclaimed list sent in the prompt must
        include `audience` but not `topic`.
        """
        service = _mock_llm_service(
            json.dumps({"name": "audience", "description": "The audience", "required": True}),
        )
        await suggest_prompt_argument_fields(
            prompt_content="Write about {{ topic }} for {{ audience }}.",
            arguments=[
                ArgumentInput(name="topic", description="The topic"),
                ArgumentInput(name=None, description=None),
            ],
            target_index=1,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        call_kwargs = service.complete.call_args.kwargs
        user_msg = next(
            m["content"] for m in call_kwargs["messages"] if m["role"] == "user"
        )
        # Find the "Unclaimed placeholder names" line.
        unclaimed_line = next(
            line for line in user_msg.splitlines()
            if line.startswith("Unclaimed placeholder names")
        )
        assert "audience" in unclaimed_line
        assert "topic" not in unclaimed_line

    async def test_refine_both_fields_rejects_claimed_name_from_llm_response(
        self,
    ) -> None:
        """
        LLM ignores the pre-filter and returns a name colliding with an
        existing row. Service returns ([], cost) as defensive backstop.
        """
        service = _mock_llm_service(
            json.dumps({"name": "topic", "description": "Something else", "required": False}),
            cost=0.008,
        )
        result, cost = await suggest_prompt_argument_fields(
            prompt_content="Write about {{ topic }} for {{ audience }}.",
            arguments=[
                ArgumentInput(name="topic", description="The topic"),
                ArgumentInput(name=None, description=None),
            ],
            target_index=1,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost == 0.008
        service.complete.assert_called_once()  # LLM WAS called, quota charged

    async def test_refine_both_fields_all_placeholders_claimed_short_circuits(
        self,
    ) -> None:
        """
        Every template placeholder is already declared — service returns
        ([], None) without calling the LLM.

        The row being refined has index 1 (blank row), and every other row
        already claims every template placeholder. Pre-filter leaves the
        unclaimed list empty → short-circuit.
        """
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_prompt_argument_fields(
            prompt_content="Hello {{ a }} and {{ b }}",
            arguments=[
                ArgumentInput(name="a", description="desc a"),
                ArgumentInput(name=None, description=None),
                ArgumentInput(name="b", description="desc b"),
            ],
            target_index=1,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost is None
        service.complete.assert_not_called()

    async def test_refine_both_fields_propagates_required_false_from_llm_response(
        self,
    ) -> None:
        """LLM returns required=False → value propagated to suggestion."""
        service = _mock_llm_service(
            json.dumps({"name": "context", "description": "Optional context", "required": False}),
        )
        result, _ = await suggest_prompt_argument_fields(
            prompt_content="{{ topic }}{% if context %}{{ context }}{% endif %}",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].required is False

    async def test_refine_both_fields_propagates_required_true_from_llm_response(
        self,
    ) -> None:
        """LLM returns required=True → value propagated to suggestion (mirror of False)."""
        service = _mock_llm_service(
            json.dumps({"name": "topic", "description": "The topic", "required": True}),
        )
        result, _ = await suggest_prompt_argument_fields(
            prompt_content="{{ topic }}{% if context %}{{ context }}{% endif %}",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].required is True

    async def test_refine_both_fields_invalid_name_returns_empty_with_cost(self) -> None:
        """Two-field response with an invalid name → ([], cost)."""
        service = _mock_llm_service(
            json.dumps({"name": "Has Spaces", "description": "some desc", "required": True}),
            cost=0.009,
        )
        result, cost = await suggest_prompt_argument_fields(
            prompt_content="{{ something }}",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["name", "description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost == 0.009

    # ----------------- service-level validation ---------------------------

    async def test_target_index_out_of_range_raises_value_error(self) -> None:
        """LLM not called."""
        service = _mock_llm_service("should not be called")
        with pytest.raises(ValueError, match="out of range"):
            await suggest_prompt_argument_fields(
                prompt_content=None,
                arguments=[ArgumentInput(name="x", description="y")],
                target_index=5,
                target_fields=["description"],
                llm_service=service,
                config=_mock_config(),
            )
        service.complete.assert_not_called()

    async def test_parse_error_raises_with_cost(self) -> None:
        """Bad JSON → LLMResponseParseError with cost."""
        service = _mock_llm_service("bad json", cost=0.01)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_prompt_argument_fields(
                prompt_content=None,
                arguments=[ArgumentInput(name=None, description="some desc")],
                target_index=0,
                target_fields=["name"],
                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.01

    # ----------------- prompt-quality: no "None" sentinel -----------------

    async def test_refine_name_only_with_blank_description_and_template_omits_none_sentinel(
        self,
    ) -> None:
        """
        Schema permits target_fields=['name'] + blank description + template
        grounding. The builder must NOT emit a literal "None" as the
        description in the user message — grounding comes from the
        Template block alone.
        """
        service = _mock_llm_service(json.dumps({"name": "something"}))
        await suggest_prompt_argument_fields(
            prompt_content="Use {{ something }}.",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["name"],
            llm_service=service,
            config=_mock_config(),
        )
        call_kwargs = service.complete.call_args.kwargs
        user_msg = next(
            m["content"] for m in call_kwargs["messages"] if m["role"] == "user"
        )
        assert "None" not in user_msg
        assert 'description: "None"' not in user_msg

    async def test_refine_description_only_with_blank_name_and_template_omits_none_sentinel(
        self,
    ) -> None:
        """Symmetric: target_fields=['description'] + blank name + template must not emit 'None'."""
        service = _mock_llm_service(json.dumps({"description": "something generated"}))
        await suggest_prompt_argument_fields(
            prompt_content="Use {{ something }}.",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["description"],
            llm_service=service,
            config=_mock_config(),
        )
        call_kwargs = service.complete.call_args.kwargs
        user_msg = next(
            m["content"] for m in call_kwargs["messages"] if m["role"] == "user"
        )
        assert "None" not in user_msg
        assert "argument named: None" not in user_msg

    async def test_refine_description_only_with_blank_name_and_template_calls_llm(
        self,
    ) -> None:
        """Mirror of the name-only template-only case: description-only works too."""
        service = _mock_llm_service(json.dumps({"description": "generated description"}))
        result, _ = await suggest_prompt_argument_fields(
            prompt_content="Use {{ something }}.",
            arguments=[ArgumentInput(name=None, description=None)],
            target_index=0,
            target_fields=["description"],
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].description == "generated description"
        service.complete.assert_called_once()

    # ----------------- direct-caller dispatch guards ----------------------

    async def test_empty_target_fields_raises_value_error_direct_call(self) -> None:
        """Direct service callers (evals, tests) bypassing the schema get a clean ValueError."""
        service = _mock_llm_service("should not be called")
        with pytest.raises(ValueError, match="target_fields must have 1 or 2 elements"):
            await suggest_prompt_argument_fields(
                prompt_content="{{ x }}",
                arguments=[ArgumentInput(name="x", description="desc")],
                target_index=0,
                target_fields=[],
                llm_service=service,
                config=_mock_config(),
            )
        service.complete.assert_not_called()

    async def test_more_than_two_target_fields_raises_value_error_direct_call(self) -> None:
        service = _mock_llm_service("should not be called")
        with pytest.raises(ValueError, match="target_fields must have 1 or 2 elements"):
            await suggest_prompt_argument_fields(
                prompt_content="{{ x }}",
                arguments=[ArgumentInput(name="x", description="desc")],
                target_index=0,
                target_fields=["name", "description", "name"],  # type: ignore[list-item]
                llm_service=service,
                config=_mock_config(),
            )
        service.complete.assert_not_called()

    async def test_two_fields_without_template_raises_value_error_direct_call(self) -> None:
        """Direct callers who bypass the schema can't reach the assert path anymore."""
        service = _mock_llm_service("should not be called")
        with pytest.raises(ValueError, match="prompt_content is required"):
            await suggest_prompt_argument_fields(
                prompt_content=None,
                arguments=[ArgumentInput(name=None, description=None)],
                target_index=0,
                target_fields=["name", "description"],
                llm_service=service,
                config=_mock_config(),
            )
        service.complete.assert_not_called()
