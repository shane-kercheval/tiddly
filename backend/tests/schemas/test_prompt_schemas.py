"""Tests for prompt schemas."""
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from schemas.prompt import (
    PromptArgument,
    PromptCreate,
    PromptListItem,
    PromptListResponse,
    PromptResponse,
    PromptUpdate,
)


class TestPromptArgument:
    """Tests for PromptArgument schema."""

    def test__prompt_argument__valid_name(self) -> None:
        """Valid argument names should be accepted."""
        valid_names = ["x", "user_name", "a1_b2", "code_to_review", "language"]
        for name in valid_names:
            arg = PromptArgument(name=name)
            assert arg.name == name

    def test__prompt_argument__invalid_name_uppercase(self) -> None:
        """Uppercase letters in argument name should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptArgument(name="UserName")
        assert "Invalid argument name format" in str(exc_info.value)

    def test__prompt_argument__invalid_name_starts_with_number(self) -> None:
        """Argument names starting with number should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptArgument(name="1name")
        assert "Invalid argument name format" in str(exc_info.value)

    def test__prompt_argument__invalid_name_has_hyphen(self) -> None:
        """Argument names with hyphens should be rejected (not valid Jinja2 identifiers)."""
        with pytest.raises(ValidationError) as exc_info:
            PromptArgument(name="user-name")
        assert "Invalid argument name format" in str(exc_info.value)

    def test__prompt_argument__name_max_length(self) -> None:
        """Argument name at max length (100) should be accepted, over should be rejected."""
        # 100 chars accepted
        long_name = "a" * 100
        arg = PromptArgument(name=long_name)
        assert arg.name == long_name

        # 101 chars rejected
        with pytest.raises(ValidationError) as exc_info:
            PromptArgument(name="a" * 101)
        assert "exceeds maximum length" in str(exc_info.value)

    def test__prompt_argument__required_defaults_to_none(self) -> None:
        """Required field should default to None."""
        arg = PromptArgument(name="test")
        assert arg.required is None

    def test__prompt_argument__description_optional(self) -> None:
        """Description should be optional and accept strings."""
        arg = PromptArgument(name="test", description="A test argument")
        assert arg.description == "A test argument"

        arg_no_desc = PromptArgument(name="test")
        assert arg_no_desc.description is None


class TestPromptCreate:
    """Tests for PromptCreate schema."""

    def test__prompt_create__valid_name(self) -> None:
        """Valid prompt names should be accepted."""
        valid_names = ["x", "my-prompt", "a1-b2", "code-review", "explain-code"]
        for name in valid_names:
            prompt = PromptCreate(name=name, content="Test content")
            assert prompt.name == name

    def test__prompt_create__invalid_name_uppercase(self) -> None:
        """Uppercase letters in prompt name should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="MyPrompt", content="Test content")
        assert "Invalid prompt name format" in str(exc_info.value)

    def test__prompt_create__invalid_name_underscore(self) -> None:
        """Underscores in prompt name should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="my_prompt", content="Test content")
        assert "Invalid prompt name format" in str(exc_info.value)

    def test__prompt_create__invalid_name_starts_with_hyphen(self) -> None:
        """Prompt names starting with hyphen should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="-prompt", content="Test content")
        assert "Invalid prompt name format" in str(exc_info.value)

    def test__prompt_create__invalid_name_ends_with_hyphen(self) -> None:
        """Prompt names ending with hyphen should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="prompt-", content="Test content")
        assert "Invalid prompt name format" in str(exc_info.value)

    def test__prompt_create__name_max_length(self) -> None:
        """Prompt name at max length (100) should be accepted, over should be rejected."""
        # 100 chars accepted
        long_name = "a" * 100
        prompt = PromptCreate(name=long_name, content="Test content")
        assert prompt.name == long_name

        # 101 chars rejected
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="a" * 101, content="Test content")
        assert "exceeds maximum length" in str(exc_info.value)

    def test__prompt_create__title_max_length(self) -> None:
        """Title at max length (500) should be accepted, over should be rejected."""
        # 500 chars accepted
        long_title = "a" * 500
        prompt = PromptCreate(name="test", content="Test content", title=long_title)
        assert prompt.title == long_title

        # 501 chars rejected
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="test", content="Test content", title="a" * 501)
        assert "exceeds maximum length" in str(exc_info.value)

    def test__prompt_create__duplicate_argument_names_rejected(self) -> None:
        """Duplicate argument names should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(
                name="test",
                content="Test content",
                arguments=[
                    PromptArgument(name="code"),
                    PromptArgument(name="language"),
                    PromptArgument(name="code"),  # duplicate
                ],
            )
        assert "Duplicate argument name(s)" in str(exc_info.value)
        assert "code" in str(exc_info.value)

    def test__prompt_create__tags_normalized(self) -> None:
        """Tags should be normalized to lowercase."""
        prompt = PromptCreate(
            name="test",
            content="Test content",
            tags=["Machine-Learning", "web-dev", "AI"],
        )
        assert "machine-learning" in prompt.tags
        assert "web-dev" in prompt.tags
        assert "ai" in prompt.tags

    def test__prompt_create__empty_arguments_list_valid(self) -> None:
        """Empty arguments list should be valid."""
        prompt = PromptCreate(name="test", content="Test content", arguments=[])
        assert prompt.arguments == []

    def test__prompt_create__description_max_length(self) -> None:
        """Description should respect max_description_length setting (1000)."""
        # 1000 chars accepted
        long_desc = "a" * 1000
        prompt = PromptCreate(name="test", content="Test content", description=long_desc)
        assert prompt.description == long_desc

        # 1001 chars rejected
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="test", content="Test content", description="a" * 1001)
        assert "exceeds maximum length" in str(exc_info.value)

    def test__prompt_create__content_max_length(self) -> None:
        """Content should respect max_prompt_content_length setting (100000)."""
        # 100000 chars accepted
        long_content = "a" * 100_000
        prompt = PromptCreate(name="test", content=long_content)
        assert prompt.content == long_content

        # 100001 chars rejected
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="test", content="a" * 100_001)
        assert "exceeds maximum length" in str(exc_info.value)

    def test__prompt_create__content_required(self) -> None:
        """Content is required for prompt creation."""
        with pytest.raises(ValidationError) as exc_info:
            PromptCreate(name="test")
        assert "content" in str(exc_info.value).lower()

    def test__prompt_create__archived_at_optional(self) -> None:
        """archived_at should be optional."""
        prompt = PromptCreate(name="test", content="Test content")
        assert prompt.archived_at is None

        now = datetime.now(UTC)
        prompt_with_archive = PromptCreate(name="test", content="Test content", archived_at=now)
        assert prompt_with_archive.archived_at == now

    def test__prompt_create__all_fields(self) -> None:
        """Should accept all fields together."""
        prompt = PromptCreate(
            name="code-review",
            title="Code Review Assistant",
            description="Reviews code for issues",
            content="Please review: {{ code }}",
            arguments=[
                PromptArgument(name="code", description="The code to review", required=True),
            ],
            tags=["development", "review"],
        )
        assert prompt.name == "code-review"
        assert prompt.title == "Code Review Assistant"
        assert prompt.description == "Reviews code for issues"
        assert prompt.content == "Please review: {{ code }}"
        assert len(prompt.arguments) == 1
        assert prompt.arguments[0].name == "code"
        assert prompt.tags == ["development", "review"]


class TestPromptUpdate:
    """Tests for PromptUpdate schema."""

    def test__prompt_update__all_fields_optional(self) -> None:
        """All fields should be optional."""
        update = PromptUpdate()
        assert update.name is None
        assert update.title is None
        assert update.description is None
        assert update.content is None
        assert update.arguments is None
        assert update.tags is None
        assert update.archived_at is None

    def test__prompt_update__tags_none_means_no_change(self) -> None:
        """tags=None should mean no change (not clear tags)."""
        update = PromptUpdate(title="New Title")
        assert update.tags is None

    def test__prompt_update__tags_empty_list_clears_tags(self) -> None:
        """tags=[] should clear all tags."""
        update = PromptUpdate(tags=[])
        assert update.tags == []

    def test__prompt_update__validates_name_if_provided(self) -> None:
        """Name should be validated if provided."""
        with pytest.raises(ValidationError) as exc_info:
            PromptUpdate(name="Invalid_Name")
        assert "Invalid prompt name format" in str(exc_info.value)

    def test__prompt_update__validates_arguments_if_provided(self) -> None:
        """Duplicate argument names should be rejected if arguments provided."""
        with pytest.raises(ValidationError) as exc_info:
            PromptUpdate(
                arguments=[
                    PromptArgument(name="test"),
                    PromptArgument(name="test"),  # duplicate
                ],
            )
        assert "Duplicate argument name(s)" in str(exc_info.value)

    def test__prompt_update__partial_update(self) -> None:
        """Should accept partial updates."""
        update = PromptUpdate(title="New Title", description="New description")
        assert update.title == "New Title"
        assert update.description == "New description"
        assert update.name is None
        assert update.content is None


class TestPromptListItem:
    """Tests for PromptListItem schema."""

    def test__prompt_list_item__excludes_content(self) -> None:
        """PromptListItem should not have content field."""
        # PromptListItem doesn't have content in its fields
        fields = PromptListItem.model_fields.keys()
        assert "content" not in fields

    def test__prompt_list_item__extracts_tags_from_tag_objects(self) -> None:
        """Should extract tag names from tag_objects relationship."""
        # Create a mock object that simulates SQLAlchemy model behavior
        # The model_validator checks for tag_objects in __dict__
        tag1 = SimpleNamespace(name="python")
        tag2 = SimpleNamespace(name="tutorial")

        mock_prompt = SimpleNamespace(
            id=uuid4(),
            name="test-prompt",
            title="Test Prompt",
            description=None,
            arguments=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            last_used_at=datetime.now(UTC),
            deleted_at=None,
            archived_at=None,
            tag_objects=[tag1, tag2],
        )

        item = PromptListItem.model_validate(mock_prompt)
        assert item.tags == ["python", "tutorial"]

    def test__prompt_list_item__includes_arguments(self) -> None:
        """PromptListItem should include arguments for MCP list_prompts."""
        fields = PromptListItem.model_fields.keys()
        assert "arguments" in fields

    def test__prompt_list_item__from_dict(self) -> None:
        """Should accept dict input."""
        test_id = uuid4()
        data = {
            "id": test_id,
            "name": "test-prompt",
            "title": "Test Prompt",
            "description": "A test prompt",
            "arguments": [{"name": "code", "description": "Code input", "required": True}],
            "tags": ["python", "test"],
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
            "last_used_at": datetime.now(UTC),
            "deleted_at": None,
            "archived_at": None,
        }
        item = PromptListItem.model_validate(data)
        assert item.id == test_id
        assert item.name == "test-prompt"
        assert item.tags == ["python", "test"]
        assert len(item.arguments) == 1


class TestPromptResponse:
    """Tests for PromptResponse schema."""

    def test__prompt_response__includes_content(self) -> None:
        """PromptResponse should include content field."""
        fields = PromptResponse.model_fields.keys()
        assert "content" in fields

    def test__prompt_response__extends_list_item(self) -> None:
        """PromptResponse should have all fields from PromptListItem plus content."""
        list_item_fields = set(PromptListItem.model_fields.keys())
        response_fields = set(PromptResponse.model_fields.keys())

        # Response should have all list item fields
        assert list_item_fields.issubset(response_fields)
        # Plus content
        assert "content" in response_fields

    def test__prompt_response__from_dict(self) -> None:
        """Should accept dict input with content."""
        data = {
            "id": uuid4(),
            "name": "test-prompt",
            "title": "Test Prompt",
            "description": "A test prompt",
            "content": "Template content: {{ variable }}",
            "arguments": [],
            "tags": [],
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
            "last_used_at": datetime.now(UTC),
            "deleted_at": None,
            "archived_at": None,
        }
        response = PromptResponse.model_validate(data)
        assert response.content == "Template content: {{ variable }}"


class TestPromptListResponse:
    """Tests for PromptListResponse schema."""

    def test__prompt_list_response__structure(self) -> None:
        """Should have items, total, offset, limit, has_more."""
        response = PromptListResponse(
            items=[],
            total=0,
            offset=0,
            limit=50,
            has_more=False,
        )
        assert response.items == []
        assert response.total == 0
        assert response.offset == 0
        assert response.limit == 50
        assert response.has_more is False

    def test__prompt_list_response__with_items(self) -> None:
        """Should accept list of PromptListItem."""
        item_data = {
            "id": uuid4(),
            "name": "test",
            "title": None,
            "description": None,
            "arguments": [],
            "tags": [],
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
            "last_used_at": datetime.now(UTC),
        }
        response = PromptListResponse(
            items=[PromptListItem.model_validate(item_data)],
            total=1,
            offset=0,
            limit=50,
            has_more=False,
        )
        assert len(response.items) == 1
        assert response.total == 1
