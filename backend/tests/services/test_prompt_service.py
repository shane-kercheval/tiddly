"""
Tests for prompt service layer functionality.

Tests CRUD operations, soft delete, archive, restore, view filtering,
template validation, and name uniqueness for prompts.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt
from models.user import User
from schemas.prompt import PromptCreate, PromptUpdate, PromptArgument
from services.exceptions import InvalidStateError
from services.prompt_service import NameConflictError, PromptService, validate_template


prompt_service = PromptService()


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(auth0_id="test-user-prompts-123", email="test-prompts@example.com")
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def other_user(db_session: AsyncSession) -> User:
    """Create another test user for isolation tests."""
    user = User(auth0_id="other-user-prompts-456", email="other-prompts@example.com")
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_prompt(db_session: AsyncSession, test_user: User) -> Prompt:
    """Create a test prompt."""
    data = PromptCreate(
        name="test-prompt",
        title="Test Prompt",
        description="A test prompt",
        content="Hello {{ name }}!",
        arguments=[PromptArgument(name="name", description="The name", required=True)],
    )
    prompt = await prompt_service.create(db_session, test_user.id, data)
    await db_session.flush()
    return prompt


# =============================================================================
# CRUD Operations Tests
# =============================================================================


async def test__create__creates_prompt_with_required_fields(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a prompt with only required fields."""
    data = PromptCreate(name="minimal-prompt")
    prompt = await prompt_service.create(db_session, test_user.id, data)

    assert prompt.id is not None
    assert prompt.name == "minimal-prompt"
    assert prompt.user_id == test_user.id
    assert prompt.title is None
    assert prompt.description is None
    assert prompt.content is None
    assert prompt.arguments == []


async def test__create__creates_prompt_with_all_fields(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a prompt with all fields populated."""
    data = PromptCreate(
        name="full-prompt",
        title="Full Prompt Title",
        description="A complete prompt",
        content="Hello {{ user_name }}!",
        arguments=[
            PromptArgument(name="user_name", description="User's name", required=True),
        ],
        tags=["test", "python"],
    )
    prompt = await prompt_service.create(db_session, test_user.id, data)

    assert prompt.name == "full-prompt"
    assert prompt.title == "Full Prompt Title"
    assert prompt.description == "A complete prompt"
    assert prompt.content == "Hello {{ user_name }}!"
    assert len(prompt.arguments) == 1
    assert prompt.arguments[0]["name"] == "user_name"
    assert len(prompt.tag_objects) == 2


async def test__create__creates_prompt_with_tags(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a prompt with tags."""
    data = PromptCreate(
        name="tagged-prompt",
        tags=["coding", "python", "ai"],
    )
    prompt = await prompt_service.create(db_session, test_user.id, data)

    assert len(prompt.tag_objects) == 3
    tag_names = [t.name for t in prompt.tag_objects]
    assert "coding" in tag_names
    assert "python" in tag_names
    assert "ai" in tag_names


async def test__create__rejects_duplicate_name_for_user(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that creating a prompt with duplicate name raises NameConflictError."""
    data = PromptCreate(name=test_prompt.name)

    with pytest.raises(NameConflictError) as exc_info:
        await prompt_service.create(db_session, test_user.id, data)

    assert test_prompt.name in str(exc_info.value)


async def test__create__allows_duplicate_name_different_users(
    db_session: AsyncSession,
    test_user: User,  # noqa: ARG001
    other_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that different users can have prompts with the same name."""
    data = PromptCreate(name=test_prompt.name)
    prompt = await prompt_service.create(db_session, other_user.id, data)

    assert prompt.name == test_prompt.name
    assert prompt.user_id == other_user.id


async def test__get__returns_prompt_by_id(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test getting a prompt by ID."""
    result = await prompt_service.get(db_session, test_user.id, test_prompt.id)

    assert result is not None
    assert result.id == test_prompt.id
    assert result.name == test_prompt.name


async def test__get__returns_none_for_nonexistent(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that get returns None for non-existent prompt."""
    result = await prompt_service.get(db_session, test_user.id, 99999)
    assert result is None


async def test__update__updates_all_fields(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test updating all fields of a prompt."""
    data = PromptUpdate(
        name="updated-prompt",
        title="Updated Title",
        description="Updated description",
        content="Updated {{ message }}",
        arguments=[PromptArgument(name="message", required=False)],
        tags=["updated-tag"],
    )
    updated = await prompt_service.update(db_session, test_user.id, test_prompt.id, data)

    assert updated is not None
    assert updated.name == "updated-prompt"
    assert updated.title == "Updated Title"
    assert updated.description == "Updated description"
    assert updated.content == "Updated {{ message }}"
    assert len(updated.arguments) == 1
    assert updated.arguments[0]["name"] == "message"
    assert len(updated.tag_objects) == 1


async def test__update__partial_update_preserves_other_fields(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that partial update only changes specified fields."""
    original_content = test_prompt.content
    original_arguments = test_prompt.arguments

    data = PromptUpdate(title="Only Title Changed")
    updated = await prompt_service.update(db_session, test_user.id, test_prompt.id, data)

    assert updated is not None
    assert updated.title == "Only Title Changed"
    assert updated.content == original_content
    assert updated.arguments == original_arguments


async def test__update__rejects_name_change_to_existing(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that updating name to an existing name raises NameConflictError."""
    # Create another prompt
    data1 = PromptCreate(name="another-prompt")
    another = await prompt_service.create(db_session, test_user.id, data1)
    await db_session.flush()

    # Try to rename test_prompt to another's name
    data2 = PromptUpdate(name=another.name)
    with pytest.raises(NameConflictError):
        await prompt_service.update(db_session, test_user.id, test_prompt.id, data2)


async def test__update__allows_name_change_to_soft_deleted_name(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that a name can be reused after the original is soft-deleted."""
    # Create another prompt and soft-delete it
    data1 = PromptCreate(name="reusable-name")
    another = await prompt_service.create(db_session, test_user.id, data1)
    await db_session.flush()
    await prompt_service.delete(db_session, test_user.id, another.id)
    await db_session.flush()

    # Now we should be able to rename test_prompt to the deleted name
    data2 = PromptUpdate(name="reusable-name")
    updated = await prompt_service.update(db_session, test_user.id, test_prompt.id, data2)

    assert updated is not None
    assert updated.name == "reusable-name"


async def test__delete__soft_deletes_by_default(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that delete soft-deletes by default."""
    result = await prompt_service.delete(db_session, test_user.id, test_prompt.id)

    assert result is True

    # Verify still in DB with deleted_at set
    query = select(Prompt).where(Prompt.id == test_prompt.id)
    db_result = await db_session.execute(query)
    prompt = db_result.scalar_one()
    assert prompt.deleted_at is not None


async def test__delete__permanent_delete_removes_from_db(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that permanent delete removes from database."""
    # First soft-delete
    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    # Then permanent delete
    result = await prompt_service.delete(
        db_session, test_user.id, test_prompt.id, permanent=True,
    )

    assert result is True

    # Verify completely gone
    query = select(Prompt).where(Prompt.id == test_prompt.id)
    db_result = await db_session.execute(query)
    assert db_result.scalar_one_or_none() is None


# =============================================================================
# Soft Delete Behavior Tests
# =============================================================================


async def test__soft_delete__sets_deleted_at(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that soft delete sets deleted_at timestamp."""
    result = await prompt_service.delete(db_session, test_user.id, test_prompt.id)

    assert result is True

    query = select(Prompt).where(Prompt.id == test_prompt.id)
    db_result = await db_session.execute(query)
    prompt = db_result.scalar_one()
    assert prompt.deleted_at is not None


async def test__soft_delete__frees_name_for_reuse(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that soft-deleting frees the name for reuse."""
    original_name = test_prompt.name

    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    # Should be able to create new prompt with same name
    data = PromptCreate(name=original_name)
    new_prompt = await prompt_service.create(db_session, test_user.id, data)

    assert new_prompt.name == original_name
    assert new_prompt.id != test_prompt.id


async def test__search__excludes_soft_deleted_by_default(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that search excludes soft-deleted prompts by default."""
    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, view="active")

    assert total == 0


async def test__get__returns_soft_deleted_prompt_with_include_deleted(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that get returns soft-deleted prompt with include_deleted=True."""
    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    result = await prompt_service.get(
        db_session, test_user.id, test_prompt.id, include_deleted=True,
    )

    assert result is not None
    assert result.deleted_at is not None


# =============================================================================
# View Filtering Tests
# =============================================================================


async def test__search__view_active_excludes_deleted_and_archived(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that view='active' excludes both deleted and archived prompts."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="active-prompt"),
    )
    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="deleted-prompt"),
    )
    p3 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="archived-prompt"),
    )
    await db_session.flush()

    await prompt_service.delete(db_session, test_user.id, p2.id)
    await prompt_service.archive(db_session, test_user.id, p3.id)
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, view="active")

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__view_archived_returns_only_archived(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that view='archived' returns only archived prompts."""
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="active-prompt"),
    )
    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="archived-prompt"),
    )
    await db_session.flush()

    await prompt_service.archive(db_session, test_user.id, p2.id)
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, view="archived")

    assert total == 1
    assert prompts[0].id == p2.id


async def test__search__view_deleted_returns_only_deleted(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that view='deleted' returns only deleted prompts."""
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="active-prompt"),
    )
    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="deleted-prompt"),
    )
    await db_session.flush()

    await prompt_service.delete(db_session, test_user.id, p2.id)
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, view="deleted")

    assert total == 1
    assert prompts[0].id == p2.id


# =============================================================================
# Restore Tests
# =============================================================================


async def test__restore__clears_deleted_at(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that restore clears deleted_at timestamp."""
    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    restored = await prompt_service.restore(db_session, test_user.id, test_prompt.id)

    assert restored is not None
    assert restored.deleted_at is None


async def test__restore__clears_archived_at_if_set(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that restoring deleted+archived prompt clears both timestamps."""
    await prompt_service.archive(db_session, test_user.id, test_prompt.id)
    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    restored = await prompt_service.restore(db_session, test_user.id, test_prompt.id)

    assert restored is not None
    assert restored.deleted_at is None
    assert restored.archived_at is None


async def test__restore__raises_error_for_not_deleted(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that restoring a non-deleted prompt raises InvalidStateError."""
    with pytest.raises(InvalidStateError) as exc_info:
        await prompt_service.restore(db_session, test_user.id, test_prompt.id)

    assert "not deleted" in str(exc_info.value)


# =============================================================================
# Archive/Unarchive Tests
# =============================================================================


async def test__archive__sets_archived_at(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that archive sets archived_at timestamp."""
    archived = await prompt_service.archive(db_session, test_user.id, test_prompt.id)

    assert archived is not None
    assert archived.archived_at is not None


async def test__archive__is_idempotent(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that archiving an already-archived prompt is idempotent."""
    await prompt_service.archive(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    # Archive again - should succeed
    archived = await prompt_service.archive(db_session, test_user.id, test_prompt.id)

    assert archived is not None
    assert archived.archived_at is not None


async def test__unarchive__clears_archived_at(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that unarchive clears archived_at timestamp."""
    await prompt_service.archive(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    unarchived = await prompt_service.unarchive(db_session, test_user.id, test_prompt.id)

    assert unarchived is not None
    assert unarchived.archived_at is None


async def test__unarchive__raises_error_for_not_archived(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that unarchiving a non-archived prompt raises InvalidStateError."""
    with pytest.raises(InvalidStateError) as exc_info:
        await prompt_service.unarchive(db_session, test_user.id, test_prompt.id)

    assert "not archived" in str(exc_info.value)


# =============================================================================
# Track Usage Tests
# =============================================================================


async def test__track_usage__updates_last_used_at(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that track_usage updates the last_used_at timestamp."""
    import asyncio

    original_last_used = test_prompt.last_used_at

    await asyncio.sleep(0.01)

    result = await prompt_service.track_usage(db_session, test_user.id, test_prompt.id)
    await db_session.flush()
    await db_session.refresh(test_prompt)

    assert result is True
    assert test_prompt.last_used_at > original_last_used


async def test__track_usage__returns_false_for_nonexistent(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that track_usage returns False for non-existent prompt."""
    result = await prompt_service.track_usage(db_session, test_user.id, 99999)
    assert result is False


# =============================================================================
# Tag Filtering Tests
# =============================================================================


async def test__search__filters_by_single_tag(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test filtering by a single tag."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="tagged-prompt", tags=["python"]),
    )
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="untagged-prompt"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, tags=["python"],
    )

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__filters_by_multiple_tags_match_all(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test filtering by multiple tags with match_all (AND)."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="both-tags", tags=["python", "ai"]),
    )
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="python-only", tags=["python"]),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, tags=["python", "ai"], tag_match="all",
    )

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__filters_by_multiple_tags_match_any(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test filtering by multiple tags with match_any (OR)."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="python-prompt", tags=["python"]),
    )
    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="ai-prompt", tags=["ai"]),
    )
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="java-prompt", tags=["java"]),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, tags=["python", "ai"], tag_match="any",
    )

    assert total == 2
    ids = [p.id for p in prompts]
    assert p1.id in ids
    assert p2.id in ids


async def test__search__tag_filter_returns_empty_for_no_match(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that tag filter returns empty when no prompts match."""
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="tagged-prompt", tags=["python"]),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, tags=["nonexistent-tag"],
    )

    assert total == 0
    assert prompts == []


# =============================================================================
# Sort Tests
# =============================================================================


async def test__search__sort_by_created_at_desc(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test sorting by created_at descending (default)."""
    import asyncio

    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="first-prompt"),
    )
    await db_session.flush()
    await asyncio.sleep(0.01)

    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="second-prompt"),
    )
    await db_session.flush()

    prompts, _ = await prompt_service.search(
        db_session, test_user.id, sort_by="created_at", sort_order="desc",
    )

    assert prompts[0].id == p2.id
    assert prompts[1].id == p1.id


async def test__search__sort_by_created_at_asc(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test sorting by created_at ascending."""
    import asyncio

    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="first-prompt"),
    )
    await db_session.flush()
    await asyncio.sleep(0.01)

    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="second-prompt"),
    )
    await db_session.flush()

    prompts, _ = await prompt_service.search(
        db_session, test_user.id, sort_by="created_at", sort_order="asc",
    )

    assert prompts[0].id == p1.id
    assert prompts[1].id == p2.id


async def test__search__sort_by_title_uses_coalesce(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that sorting by title uses COALESCE with name for null titles."""
    # Prompt without title (should sort by name)
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="zebra-prompt"),
    )
    # Prompt with title
    p2 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="aaa-prompt", title="Alpha Title"),
    )
    await db_session.flush()

    prompts, _ = await prompt_service.search(
        db_session, test_user.id, sort_by="title", sort_order="asc",
    )

    # "Alpha Title" < "zebra-prompt" alphabetically
    assert prompts[0].id == p2.id
    assert prompts[1].id == p1.id


# =============================================================================
# Text Search Tests
# =============================================================================


async def test__search__search_matches_name(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that text search finds matches in name."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="python-helper"),
    )
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="javascript-helper"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, query="python")

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__search_matches_title(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that text search finds matches in title."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="prompt-1", title="Python Expert"),
    )
    await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="prompt-2", title="JavaScript Expert"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, query="python")

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__search_matches_description(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that text search finds matches in description."""
    p1 = await prompt_service.create(
        db_session, test_user.id,
        PromptCreate(name="prompt-1", description="Helps with Python code"),
    )
    await prompt_service.create(
        db_session, test_user.id,
        PromptCreate(name="prompt-2", description="Helps with JavaScript code"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, query="python")

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__search_matches_content(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that text search finds matches in content."""
    p1 = await prompt_service.create(
        db_session, test_user.id,
        PromptCreate(name="prompt-1", content="You are a Python expert."),
    )
    await prompt_service.create(
        db_session, test_user.id,
        PromptCreate(name="prompt-2", content="You are a JavaScript expert."),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, query="python")

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__search_case_insensitive(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that text search is case insensitive."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="python-helper"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, query="PYTHON")

    assert total == 1
    assert prompts[0].id == p1.id


async def test__search__search_partial_match(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that text search supports partial matches."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="code-review-helper"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id, query="review")

    assert total == 1
    assert prompts[0].id == p1.id


# =============================================================================
# Pagination Tests
# =============================================================================


async def test__search__pagination_offset(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test pagination with offset."""
    for i in range(5):
        await prompt_service.create(
            db_session, test_user.id, PromptCreate(name=f"prompt-{i}"),
        )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, offset=2, limit=10,
    )

    assert total == 5
    assert len(prompts) == 3


async def test__search__pagination_limit(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test pagination with limit."""
    for i in range(5):
        await prompt_service.create(
            db_session, test_user.id, PromptCreate(name=f"prompt-{i}"),
        )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, offset=0, limit=3,
    )

    assert total == 5
    assert len(prompts) == 3


async def test__search__returns_total_count(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that total count reflects all matching items before pagination."""
    for i in range(10):
        await prompt_service.create(
            db_session, test_user.id, PromptCreate(name=f"prompt-{i}"),
        )
    await db_session.flush()

    prompts, total = await prompt_service.search(
        db_session, test_user.id, offset=0, limit=3,
    )

    assert total == 10
    assert len(prompts) == 3


# =============================================================================
# User Isolation Tests
# =============================================================================


async def test__search__excludes_other_users_prompts(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test that search only returns the current user's prompts."""
    p1 = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="my-prompt"),
    )
    await prompt_service.create(
        db_session, other_user.id, PromptCreate(name="other-prompt"),
    )
    await db_session.flush()

    prompts, total = await prompt_service.search(db_session, test_user.id)

    assert total == 1
    assert prompts[0].id == p1.id


async def test__get__returns_none_for_other_users_prompt(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test that get returns None for another user's prompt."""
    p1 = await prompt_service.create(
        db_session, other_user.id, PromptCreate(name="other-prompt"),
    )
    await db_session.flush()

    result = await prompt_service.get(db_session, test_user.id, p1.id)

    assert result is None


async def test__update__returns_none_for_other_users_prompt(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test that update returns None for another user's prompt."""
    p1 = await prompt_service.create(
        db_session, other_user.id, PromptCreate(name="other-prompt"),
    )
    await db_session.flush()

    result = await prompt_service.update(
        db_session, test_user.id, p1.id, PromptUpdate(title="Hacked"),
    )

    assert result is None


async def test__delete__returns_false_for_other_users_prompt(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test that delete returns False for another user's prompt."""
    p1 = await prompt_service.create(
        db_session, other_user.id, PromptCreate(name="other-prompt"),
    )
    await db_session.flush()

    result = await prompt_service.delete(db_session, test_user.id, p1.id)

    assert result is False


# =============================================================================
# Cascade Delete Tests
# =============================================================================


async def test__cascade_delete__user_deletion_removes_prompts(
    db_session: AsyncSession,
) -> None:
    """Test that deleting a user removes all their prompts."""
    # Create a user with prompts
    user = User(auth0_id="cascade-test-user", email="cascade@example.com")
    db_session.add(user)
    await db_session.flush()

    await prompt_service.create(
        db_session, user.id, PromptCreate(name="prompt-1"),
    )
    await prompt_service.create(
        db_session, user.id, PromptCreate(name="prompt-2"),
    )
    await db_session.flush()

    # Delete the user
    await db_session.delete(user)
    await db_session.flush()

    # Verify prompts are gone
    result = await db_session.execute(
        select(Prompt).where(Prompt.user_id == user.id),
    )
    assert result.scalars().all() == []


# =============================================================================
# Template Validation Tests
# =============================================================================


def test__validate_template__valid_syntax() -> None:
    """Test that valid template syntax passes validation."""
    validate_template("Hello {{ name }}!", [{"name": "name"}])
    # Should not raise


def test__validate_template__invalid_syntax() -> None:
    """Test that invalid template syntax raises ValueError."""
    with pytest.raises(ValueError, match="Invalid Jinja2 syntax"):
        validate_template("Hello {{ name", [])


def test__validate_template__undefined_variable() -> None:
    """Test that undefined variables raise ValueError."""
    with pytest.raises(ValueError, match="undefined variable.*name"):
        validate_template("Hello {{ name }}!", [])


def test__validate_template__empty_content() -> None:
    """Test that empty content passes validation."""
    validate_template("", [])
    validate_template(None, [])
    # Should not raise


def test__validate_template__unused_arguments_allowed() -> None:
    """Test that unused arguments are allowed."""
    validate_template("Hello World!", [{"name": "unused_arg"}])
    # Should not raise


async def test__create__validates_template_syntax(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that create validates template syntax."""
    data = PromptCreate(
        name="invalid-syntax-prompt",
        content="Hello {{ name",
    )

    with pytest.raises(ValueError, match="Invalid Jinja2 syntax"):
        await prompt_service.create(db_session, test_user.id, data)


async def test__create__validates_template_undefined_variables(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that create validates undefined variables."""
    data = PromptCreate(
        name="undefined-var-prompt",
        content="Hello {{ name }}!",
        arguments=[],  # No arguments defined
    )

    with pytest.raises(ValueError, match="undefined variable"):
        await prompt_service.create(db_session, test_user.id, data)


async def test__create__allows_empty_content(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that create allows empty content."""
    data = PromptCreate(name="empty-content-prompt", content="")
    prompt = await prompt_service.create(db_session, test_user.id, data)

    assert prompt.content == ""


async def test__create__allows_template_with_defined_arguments(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that create allows template with all variables defined."""
    data = PromptCreate(
        name="valid-template-prompt",
        content="Hello {{ user_name }}, welcome to {{ app_name }}!",
        arguments=[
            PromptArgument(name="user_name", required=True),
            PromptArgument(name="app_name", required=True),
        ],
    )
    prompt = await prompt_service.create(db_session, test_user.id, data)

    assert prompt.content is not None
    assert len(prompt.arguments) == 2


async def test__create__allows_unused_arguments(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that create allows arguments that aren't used in template."""
    data = PromptCreate(
        name="unused-args-prompt",
        content="Hello World!",
        arguments=[PromptArgument(name="unused_arg")],
    )
    prompt = await prompt_service.create(db_session, test_user.id, data)

    assert len(prompt.arguments) == 1


async def test__update__validates_template_syntax(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that update validates template syntax."""
    data = PromptUpdate(content="Hello {{ name")

    with pytest.raises(ValueError, match="Invalid Jinja2 syntax"):
        await prompt_service.update(db_session, test_user.id, test_prompt.id, data)


async def test__update__validates_template_undefined_variables(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that update validates undefined variables in new content."""
    data = PromptUpdate(
        content="Hello {{ new_undefined_var }}!",
        arguments=[],  # Clear all arguments
    )

    with pytest.raises(ValueError, match="undefined variable"):
        await prompt_service.update(db_session, test_user.id, test_prompt.id, data)


async def test__update__validates_when_removing_argument_still_used(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that removing an argument still used in content fails validation."""
    # test_prompt has content "Hello {{ name }}!" and argument "name"
    # Try to remove the argument while keeping the content
    data = PromptUpdate(arguments=[])  # Remove all arguments

    with pytest.raises(ValueError, match="undefined variable.*name"):
        await prompt_service.update(db_session, test_user.id, test_prompt.id, data)


async def test__update__validates_when_adding_template_var_without_argument(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that adding a template variable without corresponding argument fails."""
    # Add new variable to content without adding the argument
    data = PromptUpdate(content="Hello {{ name }} and {{ new_var }}!")

    with pytest.raises(ValueError, match="undefined variable.*new_var"):
        await prompt_service.update(db_session, test_user.id, test_prompt.id, data)


async def test__update__validates_merged_state_content_and_arguments(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that validation uses merged state when both content and arguments change."""
    # Both content and arguments change together - should pass if consistent
    data = PromptUpdate(
        content="Hello {{ greeting }}!",
        arguments=[PromptArgument(name="greeting", required=True)],
    )
    updated = await prompt_service.update(db_session, test_user.id, test_prompt.id, data)

    assert updated is not None
    assert updated.content == "Hello {{ greeting }}!"
    assert updated.arguments[0]["name"] == "greeting"


# =============================================================================
# get_by_name Tests
# =============================================================================


async def test__get_by_name__returns_prompt(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that get_by_name returns the prompt."""
    result = await prompt_service.get_by_name(db_session, test_user.id, test_prompt.name)

    assert result is not None
    assert result.id == test_prompt.id
    assert result.name == test_prompt.name


async def test__get_by_name__returns_none_for_nonexistent(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that get_by_name returns None for non-existent name."""
    result = await prompt_service.get_by_name(db_session, test_user.id, "nonexistent")

    assert result is None


async def test__get_by_name__returns_none_for_deleted(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that get_by_name returns None for deleted prompt."""
    await prompt_service.delete(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    result = await prompt_service.get_by_name(db_session, test_user.id, test_prompt.name)

    assert result is None


async def test__get_by_name__returns_none_for_archived(
    db_session: AsyncSession,
    test_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that get_by_name returns None for archived prompt."""
    await prompt_service.archive(db_session, test_user.id, test_prompt.id)
    await db_session.flush()

    result = await prompt_service.get_by_name(db_session, test_user.id, test_prompt.name)

    assert result is None


async def test__get_by_name__returns_none_for_other_users_prompt(
    db_session: AsyncSession,
    test_user: User,  # noqa: ARG001
    other_user: User,
    test_prompt: Prompt,
) -> None:
    """Test that get_by_name returns None for another user's prompt."""
    result = await prompt_service.get_by_name(db_session, other_user.id, test_prompt.name)

    assert result is None
