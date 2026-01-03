"""Tests for prompt service."""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt
from models.user import User
from schemas.prompt import PromptCreate, PromptUpdate
from services.prompt_service import PromptService, validate_template


# =============================================================================
# Template Validation Tests
# =============================================================================


def test__validate_template__empty_content_passes() -> None:
    """Test that empty content passes validation."""
    validate_template(None, [])
    validate_template("", [])


def test__validate_template__no_variables_passes() -> None:
    """Test that template without variables passes."""
    validate_template("Hello, this is plain text.", [])


def test__validate_template__all_variables_defined_passes() -> None:
    """Test that template with all variables defined passes."""
    validate_template(
        "Hello {{ name }}, you are {{ age }} years old.",
        [{"name": "name"}, {"name": "age"}],
    )


def test__validate_template__undefined_variable_raises() -> None:
    """Test that undefined variable raises ValueError."""
    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        validate_template(
            "Hello {{ undefined }}",
            [],
        )
    assert "undefined variable" in str(exc_info.value).lower()
    assert "undefined" in str(exc_info.value)


def test__validate_template__multiple_undefined_variables() -> None:
    """Test that multiple undefined variables are reported."""
    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        validate_template(
            "Hello {{ foo }} and {{ bar }}",
            [],
        )
    assert "foo" in str(exc_info.value)
    assert "bar" in str(exc_info.value)


def test__validate_template__invalid_syntax_raises() -> None:
    """Test that invalid Jinja2 syntax raises ValueError."""
    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        validate_template(
            "Hello {{ unclosed",
            [],
        )
    assert "syntax" in str(exc_info.value).lower()


def test__validate_template__invalid_syntax_nested() -> None:
    """Test that nested invalid syntax is caught."""
    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        validate_template(
            "{% if foo %}{{ bar",
            [],
        )
    assert "syntax" in str(exc_info.value).lower()


def test__validate_template__builtin_names_not_required() -> None:
    """Test that Jinja2 builtins don't need to be defined as arguments."""
    # 'range' and 'loop' are Jinja2 builtins
    # However, find_undeclared_variables doesn't include them by default
    validate_template(
        "{% for i in items %}{{ i }}{% endfor %}",
        [{"name": "items"}],
    )


# =============================================================================
# Service CRUD Tests
# =============================================================================


@pytest.fixture
async def user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(auth0_id="test|12345", email="test@example.com")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def prompt_service() -> PromptService:
    """Create a prompt service instance."""
    return PromptService()


async def test__create__success(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test creating a prompt via service."""
    data = PromptCreate(
        name="test-prompt",
        title="Test Prompt",
        description="A test prompt",
        content="Hello {{ name }}!",
        arguments=[{"name": "name", "required": True}],
    )

    prompt = await prompt_service.create(db_session, user.id, data)

    assert prompt.id is not None
    assert prompt.name == "test-prompt"
    assert prompt.title == "Test Prompt"
    assert prompt.user_id == user.id


async def test__create__duplicate_name_raises(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that creating duplicate name raises ValueError."""
    data = PromptCreate(name="duplicate")
    await prompt_service.create(db_session, user.id, data)

    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        await prompt_service.create(db_session, user.id, data)
    assert "already exists" in str(exc_info.value)


async def test__create__different_users_same_name_allowed(
    db_session: AsyncSession, prompt_service: PromptService,
) -> None:
    """Test that different users can have prompts with the same name."""
    # Create two users
    user1 = User(auth0_id="user1|test", email="user1@example.com")
    user2 = User(auth0_id="user2|test", email="user2@example.com")
    db_session.add(user1)
    db_session.add(user2)
    await db_session.flush()

    # Both users can create prompts with the same name
    data = PromptCreate(name="shared-name")
    prompt1 = await prompt_service.create(db_session, user1.id, data)
    prompt2 = await prompt_service.create(db_session, user2.id, data)

    assert prompt1.id != prompt2.id
    assert prompt1.name == prompt2.name == "shared-name"
    assert prompt1.user_id == user1.id
    assert prompt2.user_id == user2.id


async def test__create__invalid_template_raises(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that invalid template raises ValueError."""
    data = PromptCreate(
        name="invalid-template",
        content="{{ undefined_var }}",
        arguments=[],
    )

    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        await prompt_service.create(db_session, user.id, data)
    assert "undefined variable" in str(exc_info.value).lower()


async def test__get_by_name__found(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test getting a prompt by name."""
    data = PromptCreate(name="find-me")
    created = await prompt_service.create(db_session, user.id, data)

    found = await prompt_service.get_by_name(db_session, user.id, "find-me")
    assert found is not None
    assert found.id == created.id


async def test__get_by_name__not_found(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test getting non-existent prompt returns None."""
    found = await prompt_service.get_by_name(db_session, user.id, "nonexistent")
    assert found is None


async def test__get_by_name__wrong_user(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that prompts are scoped to user."""
    data = PromptCreate(name="user-scoped")
    await prompt_service.create(db_session, user.id, data)

    # Different user ID should not find it
    found = await prompt_service.get_by_name(db_session, user.id + 1, "user-scoped")
    assert found is None


async def test__get_by_id__found(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test getting a prompt by ID."""
    data = PromptCreate(name="find-by-id")
    created = await prompt_service.create(db_session, user.id, data)

    found = await prompt_service.get_by_id(db_session, user.id, created.id)
    assert found is not None
    assert found.id == created.id
    assert found.name == "find-by-id"


async def test__get_by_id__not_found(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test getting non-existent prompt by ID returns None."""
    found = await prompt_service.get_by_id(db_session, user.id, 99999)
    assert found is None


async def test__get_by_id__wrong_user(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that get_by_id is scoped to user."""
    data = PromptCreate(name="id-scoped")
    created = await prompt_service.create(db_session, user.id, data)

    # Different user ID should not find it
    found = await prompt_service.get_by_id(db_session, user.id + 1, created.id)
    assert found is None


async def test__list__empty(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test listing when no prompts exist."""
    prompts, total = await prompt_service.list(db_session, user.id)
    assert prompts == []
    assert total == 0


async def test__list__returns_all(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test listing returns all user prompts."""
    await prompt_service.create(db_session, user.id, PromptCreate(name="prompt-1"))
    await prompt_service.create(db_session, user.id, PromptCreate(name="prompt-2"))
    await prompt_service.create(db_session, user.id, PromptCreate(name="prompt-3"))

    prompts, total = await prompt_service.list(db_session, user.id)
    assert len(prompts) == 3
    assert total == 3


async def test__list__pagination(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test list pagination."""
    for i in range(5):
        await prompt_service.create(db_session, user.id, PromptCreate(name=f"p-{i}"))

    prompts, total = await prompt_service.list(db_session, user.id, offset=0, limit=2)
    assert len(prompts) == 2
    assert total == 5

    prompts, total = await prompt_service.list(db_session, user.id, offset=4, limit=2)
    assert len(prompts) == 1
    assert total == 5


async def test__update__success(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test updating a prompt."""
    await prompt_service.create(db_session, user.id, PromptCreate(name="update-me"))

    updated = await prompt_service.update(
        db_session, user.id, "update-me",
        PromptUpdate(title="New Title", description="New Description"),
    )

    assert updated is not None
    assert updated.title == "New Title"
    assert updated.description == "New Description"


async def test__update__rename(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test renaming a prompt."""
    await prompt_service.create(db_session, user.id, PromptCreate(name="old-name"))

    updated = await prompt_service.update(
        db_session, user.id, "old-name",
        PromptUpdate(name="new-name"),
    )

    assert updated is not None
    assert updated.name == "new-name"

    # Old name should not exist
    old = await prompt_service.get_by_name(db_session, user.id, "old-name")
    assert old is None


async def test__update__rename_collision_raises(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test renaming to existing name raises ValueError."""
    await prompt_service.create(db_session, user.id, PromptCreate(name="prompt-a"))
    await prompt_service.create(db_session, user.id, PromptCreate(name="prompt-b"))

    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        await prompt_service.update(
            db_session, user.id, "prompt-a",
            PromptUpdate(name="prompt-b"),
        )
    assert "already exists" in str(exc_info.value)


async def test__update__not_found(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test updating non-existent prompt returns None."""
    result = await prompt_service.update(
        db_session, user.id, "nonexistent",
        PromptUpdate(title="New Title"),
    )
    assert result is None


async def test__update__template_validation(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test template validation on update."""
    await prompt_service.create(
        db_session, user.id,
        PromptCreate(
            name="template-test",
            content="{{ name }}",
            arguments=[{"name": "name"}],
        ),
    )

    # Update with undefined variable should fail
    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        await prompt_service.update(
            db_session, user.id, "template-test",
            PromptUpdate(content="{{ undefined }}"),
        )
    assert "undefined variable" in str(exc_info.value).lower()


async def test__delete__success(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test deleting a prompt."""
    await prompt_service.create(db_session, user.id, PromptCreate(name="delete-me"))

    result = await prompt_service.delete(db_session, user.id, "delete-me")
    assert result is True

    # Verify deleted
    found = await prompt_service.get_by_name(db_session, user.id, "delete-me")
    assert found is None


async def test__delete__not_found(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test deleting non-existent prompt returns False."""
    result = await prompt_service.delete(db_session, user.id, "nonexistent")
    assert result is False


# =============================================================================
# Model Cascade Tests
# =============================================================================


async def test__cascade_delete__user_deletion_removes_prompts(
    db_session: AsyncSession,
) -> None:
    """Test that deleting a user cascades to delete their prompts."""
    # Create user and prompt
    user = User(auth0_id="cascade|test", email="cascade@example.com")
    db_session.add(user)
    await db_session.flush()

    prompt = Prompt(
        user_id=user.id,
        name="cascade-test",
        arguments=[],
    )
    db_session.add(prompt)
    await db_session.flush()
    prompt_id = prompt.id

    # Delete user
    await db_session.delete(user)
    await db_session.flush()

    # Prompt should be gone (cascade delete)
    from sqlalchemy import select
    result = await db_session.execute(select(Prompt).where(Prompt.id == prompt_id))
    assert result.scalar_one_or_none() is None


# =============================================================================
# Null Value Handling Tests
# =============================================================================


async def test__update__null_name_ignored(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that update with null name is treated as no change."""
    await prompt_service.create(
        db_session, user.id,
        PromptCreate(name="keep-name", title="Original"),
    )

    # Update with null name - should be ignored
    updated = await prompt_service.update(
        db_session, user.id, "keep-name",
        PromptUpdate(name=None, title="New Title"),
    )

    assert updated is not None
    assert updated.name == "keep-name"  # Name unchanged
    assert updated.title == "New Title"


async def test__update__null_arguments_clears(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that update with null arguments clears to empty list."""
    await prompt_service.create(
        db_session, user.id,
        PromptCreate(
            name="has-args",
            content="Hello {{ name }}",
            arguments=[{"name": "name"}],
        ),
    )

    # Update with null arguments and new content (no variables)
    updated = await prompt_service.update(
        db_session, user.id, "has-args",
        PromptUpdate(arguments=None, content="No variables"),
    )

    assert updated is not None
    assert updated.arguments == []
    assert updated.content == "No variables"


async def test__update__null_arguments_validates_template(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that clearing arguments fails if template uses variables."""
    await prompt_service.create(
        db_session, user.id,
        PromptCreate(
            name="template-vars",
            content="Hello {{ name }}",
            arguments=[{"name": "name"}],
        ),
    )

    # Clearing arguments should fail - template still uses {{ name }}
    with pytest.raises(ValueError) as exc_info:  # noqa: PT011
        await prompt_service.update(
            db_session, user.id, "template-vars",
            PromptUpdate(arguments=None),
        )
    assert "undefined variable" in str(exc_info.value).lower()


# =============================================================================
# User Isolation Tests
# =============================================================================


async def test__list__excludes_other_users_prompts(
    db_session: AsyncSession, prompt_service: PromptService,
) -> None:
    """Test that list only returns the current user's prompts."""
    # Create two users
    user1 = User(auth0_id="user1|isolation", email="user1@example.com")
    user2 = User(auth0_id="user2|isolation", email="user2@example.com")
    db_session.add(user1)
    db_session.add(user2)
    await db_session.flush()

    # Create prompts for both users
    await prompt_service.create(db_session, user1.id, PromptCreate(name="user1-prompt"))
    await prompt_service.create(db_session, user2.id, PromptCreate(name="user2-prompt"))

    # List should only return user1's prompts
    prompts, total = await prompt_service.list(db_session, user1.id)

    assert total == 1
    assert prompts[0].name == "user1-prompt"


async def test__update__wrong_user_returns_none(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that update returns None for wrong user."""
    # Create a prompt for test user
    await prompt_service.create(
        db_session, user.id,
        PromptCreate(name="user-prompt", title="Original"),
    )

    # Create another user
    other_user = User(auth0_id="other|user", email="other@example.com")
    db_session.add(other_user)
    await db_session.flush()

    # Try to update test_user's prompt as other_user
    result = await prompt_service.update(
        db_session, other_user.id, "user-prompt",
        PromptUpdate(title="Hacked"),
    )

    assert result is None

    # Verify original prompt unchanged
    original = await prompt_service.get_by_name(db_session, user.id, "user-prompt")
    assert original is not None
    assert original.title == "Original"


async def test__delete__wrong_user_returns_false(
    db_session: AsyncSession, user: User, prompt_service: PromptService,
) -> None:
    """Test that delete returns False for wrong user."""
    # Create a prompt for test user
    await prompt_service.create(db_session, user.id, PromptCreate(name="protected"))

    # Create another user
    other_user = User(auth0_id="attacker|user", email="attacker@example.com")
    db_session.add(other_user)
    await db_session.flush()

    # Try to delete test_user's prompt as other_user
    result = await prompt_service.delete(db_session, other_user.id, "protected")

    assert result is False

    # Verify prompt still exists
    original = await prompt_service.get_by_name(db_session, user.id, "protected")
    assert original is not None
