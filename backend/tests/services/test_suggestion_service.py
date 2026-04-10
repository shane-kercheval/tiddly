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
    TagFewShotExample,
    TagVocabularyEntry,
)
from services.suggestion_service import (
    LLMResponseParseError,
    suggest_arguments,
    suggest_metadata,
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
    config.model = "gemini/gemini-2.5-flash-lite"
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
            few_shot_examples=[],
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
            few_shot_examples=[],
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
            few_shot_examples=[],
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
            few_shot_examples=[],
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
                few_shot_examples=[],
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
                few_shot_examples=[],
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
                few_shot_examples=[],
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
            few_shot_examples=[],
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
            few_shot_examples=[],
            llm_service=service,
            config=_mock_config(),
        )
        assert cost is None

    async def test_passes_vocabulary_and_examples_to_prompt(self) -> None:
        """Verify vocabulary and examples are passed through to the LLM call."""
        service = _mock_llm_service('{"tags": ["python"]}')
        vocab = [TagVocabularyEntry(name="python", count=47)]
        examples = [TagFewShotExample(title="Pytest Guide", description="Testing", tags=["python", "testing"])]
        await suggest_tags(
            title="Test",
            url=None,
            description=None,
            content_snippet=None,
            content_type="bookmark",
            current_tags=[],
            tag_vocabulary=vocab,
            few_shot_examples=examples,
            llm_service=service,
            config=_mock_config(),
        )
        call_kwargs = service.complete.call_args.kwargs
        system_msg = call_kwargs["messages"][0]["content"]
        assert "python (47)" in system_msg
        assert "Pytest Guide" in system_msg
        assert "Testing" in system_msg


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
# suggest_arguments
# ---------------------------------------------------------------------------


class TestSuggestArguments:
    """Tests for suggest_arguments service function."""

    async def test_generate_all_extracts_placeholders(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic"},
            {"name": "language", "description": "The language"},
        ]})
        service = _mock_llm_service(content)
        result, cost = await suggest_arguments(
            prompt_content="Explain {{ topic }} in {{ language }}.",
            arguments=[],
            target=None,
            llm_service=service,
            config=_mock_config(),
        )
        names = [a.name for a in result]
        assert "topic" in names
        assert "language" in names
        assert cost == 0.001

    async def test_generate_all_excludes_existing(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic"},
        ]})
        service = _mock_llm_service(content)
        result, _ = await suggest_arguments(
            prompt_content="Explain {{ topic }} in {{ language }}.",
            arguments=[ArgumentInput(name="language", description="Already exists")],
            target=None,
            llm_service=service,
            config=_mock_config(),
        )
        names = [a.name for a in result]
        assert "topic" in names
        assert "language" not in names

    async def test_generate_all_empty_when_all_exist(self) -> None:
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_arguments(
            prompt_content="Hello {{ name }}",
            arguments=[ArgumentInput(name="name", description="The name")],
            target=None,
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost is None
        service.complete.assert_not_called()

    async def test_generate_all_no_content(self) -> None:
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_arguments(
            prompt_content=None,
            arguments=[],
            target=None,
            llm_service=service,
            config=_mock_config(),
        )
        assert result == []
        assert cost is None
        service.complete.assert_not_called()

    async def test_generate_all_no_placeholders(self) -> None:
        """Content exists but has no {{ }} placeholders — no LLM call."""
        service = _mock_llm_service("should not be called")
        result, cost = await suggest_arguments(
            prompt_content="Write a poem about nature. No variables here.",
            arguments=[],
            target=None,
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
        result, _ = await suggest_arguments(
            prompt_content="{{ valid_name }} {{ also_valid }}",
            arguments=[],
            target="valid_name",
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
        result, _ = await suggest_arguments(
            prompt_content="{{ topic }} {% if context %}{{ context }}{% endif %}",
            arguments=[],
            target=None,
            llm_service=service,
            config=_mock_config(),
        )
        by_name = {a.name: a for a in result}
        assert by_name["topic"].required is True
        assert by_name["context"].required is False

    async def test_required_defaults_to_false(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic"},
        ]})
        service = _mock_llm_service(content)
        result, _ = await suggest_arguments(
            prompt_content="{{ topic }}",
            arguments=[],
            target=None,
            llm_service=service,
            config=_mock_config(),
        )
        assert result[0].required is False

    async def test_parse_error_raises_with_cost(self) -> None:
        service = _mock_llm_service("bad json", cost=0.01)
        with pytest.raises(LLMResponseParseError) as exc_info:
            await suggest_arguments(
                prompt_content="{{ name }}",
                arguments=[],
                target=None,
                llm_service=service,
                config=_mock_config(),
            )
        assert exc_info.value.cost == 0.01

    async def test_individual_target_mode(self) -> None:
        content = json.dumps({"arguments": [
            {"name": "programming_language", "description": "The language to use"},
        ]})
        service = _mock_llm_service(content)
        result, _ = await suggest_arguments(
            prompt_content="Write in {{ language }}",
            arguments=[ArgumentInput(name="language", description="")],
            target="language",
            llm_service=service,
            config=_mock_config(),
        )
        assert len(result) >= 1
        service.complete.assert_called_once()
