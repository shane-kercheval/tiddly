"""Tests for content filter service layer functionality."""
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.content_filter import ContentFilter
from models.user import User
from schemas.content_filter import (
    ContentFilterCreate,
    ContentFilterUpdate,
    FilterExpression,
    FilterGroup,
)
from services.content_filter_service import (
    create_filter,
    delete_filter,
    get_filter,
    get_filters,
    update_filter,
)
from services.settings_service import get_settings


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(auth0_id="test-filter-user-123", email="filter@example.com")
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def other_user(db_session: AsyncSession) -> User:
    """Create another test user for isolation tests."""
    user = User(auth0_id="other-filter-user-456", email="other@example.com")
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


def make_filter_expression(tags_groups: list[list[str]]) -> FilterExpression:
    """Helper to create filter expressions."""
    return FilterExpression(
        groups=[FilterGroup(tags=tags) for tags in tags_groups],
        group_operator="OR",
    )


# =============================================================================
# create_filter Tests
# =============================================================================


async def test__create_filter__creates_filter_with_filter_expression(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a content filter stores filter expression correctly."""
    data = ContentFilterCreate(
        name="Work Tasks",
        filter_expression=make_filter_expression([["work", "priority"]]),
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.id is not None
    assert result.name == "Work Tasks"
    assert result.user_id == test_user.id
    assert result.filter_expression == {
        "groups": [{"tags": ["work", "priority"], "operator": "AND"}],
        "group_operator": "OR",
    }
    # Default content_types should be ["bookmark", "note"]
    assert result.content_types == ["bookmark", "note"]


async def test__create_filter__adds_to_sidebar_order(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter adds it to the user's sidebar_order."""
    data = ContentFilterCreate(
        name="My Filter",
        filter_expression=make_filter_expression([["tag1"]]),
    )

    result = await create_filter(db_session, test_user.id, data)

    settings = await get_settings(db_session, test_user.id)
    assert settings is not None
    assert settings.sidebar_order is not None
    # Filter should be in the sidebar items (IDs stored as strings in JSON)
    filter_ids = [
        item["id"] for item in settings.sidebar_order["items"]
        if item.get("type") == "filter"
    ]
    assert str(result.id) in filter_ids


async def test__create_filter__multiple_filters_append_in_order(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating multiple filters appends each to sidebar_order."""
    data1 = ContentFilterCreate(
        name="First",
        filter_expression=make_filter_expression([["tag1"]]),
    )
    data2 = ContentFilterCreate(
        name="Second",
        filter_expression=make_filter_expression([["tag2"]]),
    )

    filter1 = await create_filter(db_session, test_user.id, data1)
    filter2 = await create_filter(db_session, test_user.id, data2)

    settings = await get_settings(db_session, test_user.id)
    assert settings is not None
    assert settings.sidebar_order is not None
    # Both filters should be in sidebar items (IDs stored as strings in JSON)
    filter_ids = [
        item["id"] for item in settings.sidebar_order["items"]
        if item.get("type") == "filter"
    ]
    assert str(filter1.id) in filter_ids
    assert str(filter2.id) in filter_ids


async def test__create_filter__normalizes_tags(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that tags in filter expression are normalized to lowercase."""
    data = ContentFilterCreate(
        name="Normalized",
        filter_expression=FilterExpression(
            groups=[FilterGroup(tags=["WORK", "Priority"])],
            group_operator="OR",
        ),
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.filter_expression["groups"][0]["tags"] == ["work", "priority"]


async def test__create_filter__with_custom_content_types(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter with custom content_types."""
    data = ContentFilterCreate(
        name="Notes Only",
        filter_expression=make_filter_expression([["notes"]]),
        content_types=["note"],
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.content_types == ["note"]


async def test__create_filter__with_single_content_type(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter with a single content type (bookmarks only)."""
    data = ContentFilterCreate(
        name="Bookmarks Only",
        filter_expression=make_filter_expression([["bookmarks"]]),
        content_types=["bookmark"],
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.content_types == ["bookmark"]


# =============================================================================
# get_filters Tests
# =============================================================================


async def test__get_filters__returns_empty_when_no_filters(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test get_filters returns empty list when user has no filters."""
    result = await get_filters(db_session, test_user.id)
    assert result == []


async def test__get_filters__returns_user_filters_ordered_by_created_at(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test get_filters returns filters ordered by creation date."""
    # Create filters in order
    for i, name in enumerate(["First", "Second", "Third"]):
        data = ContentFilterCreate(
            name=name,
            filter_expression=make_filter_expression([[f"tag{i}"]]),
        )
        await create_filter(db_session, test_user.id, data)

    result = await get_filters(db_session, test_user.id)

    assert len(result) == 3
    assert result[0].name == "First"
    assert result[1].name == "Second"
    assert result[2].name == "Third"


async def test__get_filters__user_isolation(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test get_filters only returns filters belonging to the user."""
    # Create filter for test_user
    data1 = ContentFilterCreate(
        name="User1 Filter",
        filter_expression=make_filter_expression([["tag1"]]),
    )
    await create_filter(db_session, test_user.id, data1)

    # Create filter for other_user
    data2 = ContentFilterCreate(
        name="User2 Filter",
        filter_expression=make_filter_expression([["tag2"]]),
    )
    await create_filter(db_session, other_user.id, data2)

    # Each user should only see their own filters
    user1_filters = await get_filters(db_session, test_user.id)
    user2_filters = await get_filters(db_session, other_user.id)

    assert len(user1_filters) == 1
    assert user1_filters[0].name == "User1 Filter"
    assert len(user2_filters) == 1
    assert user2_filters[0].name == "User2 Filter"


# =============================================================================
# get_filter Tests
# =============================================================================


async def test__get_filter__returns_filter_by_id(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test get_filter returns the correct filter by ID."""
    data = ContentFilterCreate(
        name="Target Filter",
        filter_expression=make_filter_expression([["target"]]),
    )
    created = await create_filter(db_session, test_user.id, data)

    result = await get_filter(db_session, test_user.id, created.id)

    assert result is not None
    assert result.id == created.id
    assert result.name == "Target Filter"


async def test__get_filter__returns_none_for_nonexistent(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test get_filter returns None for non-existent filter."""
    result = await get_filter(db_session, test_user.id, uuid4())
    assert result is None


async def test__get_filter__returns_none_for_other_users_filter(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test get_filter returns None when trying to access another user's filter."""
    # Create filter for other_user
    data = ContentFilterCreate(
        name="Other's Filter",
        filter_expression=make_filter_expression([["other"]]),
    )
    other_filter = await create_filter(db_session, other_user.id, data)

    # Try to access with test_user
    result = await get_filter(db_session, test_user.id, other_filter.id)

    assert result is None


# =============================================================================
# update_filter Tests
# =============================================================================


async def test__update_filter__updates_name(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test update_filter updates the name."""
    data = ContentFilterCreate(
        name="Original Name",
        filter_expression=make_filter_expression([["tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)

    update_data = ContentFilterUpdate(name="New Name")
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.name == "New Name"


async def test__update_filter__updates_filter_expression(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test update_filter updates the filter expression."""
    data = ContentFilterCreate(
        name="Test Filter",
        filter_expression=make_filter_expression([["old-tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)

    update_data = ContentFilterUpdate(
        filter_expression=make_filter_expression([["new-tag1"], ["new-tag2"]]),
    )
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert len(result.filter_expression["groups"]) == 2
    assert result.filter_expression["groups"][0]["tags"] == ["new-tag1"]
    assert result.filter_expression["groups"][1]["tags"] == ["new-tag2"]


async def test__update_filter__updates_content_types(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test update_filter updates the content_types."""
    data = ContentFilterCreate(
        name="Test Filter",
        filter_expression=make_filter_expression([["tag"]]),
        content_types=["bookmark", "note"],
    )
    created = await create_filter(db_session, test_user.id, data)

    update_data = ContentFilterUpdate(content_types=["note"])
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.content_types == ["note"]


async def test__update_filter__ignores_unset_fields(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test update_filter only updates fields that are set."""
    data = ContentFilterCreate(
        name="Keep This Name",
        filter_expression=make_filter_expression([["keep-tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)

    # Update with empty data should not change anything
    update_data = ContentFilterUpdate()
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.name == "Keep This Name"
    assert result.filter_expression["groups"][0]["tags"] == ["keep-tag"]


async def test__update_filter__returns_none_for_nonexistent(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test update_filter returns None for non-existent filter."""
    update_data = ContentFilterUpdate(name="New Name")
    result = await update_filter(db_session, test_user.id, uuid4(), update_data)
    assert result is None


async def test__update_filter__returns_none_for_other_users_filter(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test update_filter returns None when trying to update another user's filter."""
    # Create filter for other_user
    data = ContentFilterCreate(
        name="Other's Filter",
        filter_expression=make_filter_expression([["other"]]),
    )
    other_filter = await create_filter(db_session, other_user.id, data)

    # Try to update with test_user
    update_data = ContentFilterUpdate(name="Hijacked")
    result = await update_filter(db_session, test_user.id, other_filter.id, update_data)

    assert result is None

    # Verify original unchanged
    original = await get_filter(db_session, other_user.id, other_filter.id)
    assert original is not None
    assert original.name == "Other's Filter"


# =============================================================================
# delete_filter Tests
# =============================================================================


async def test__delete_filter__deletes_filter(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test delete_filter removes the filter."""
    data = ContentFilterCreate(
        name="To Delete",
        filter_expression=make_filter_expression([["delete"]]),
    )
    created = await create_filter(db_session, test_user.id, data)

    result = await delete_filter(db_session, test_user.id, created.id)

    assert result is True
    # Verify deleted
    fetched = await get_filter(db_session, test_user.id, created.id)
    assert fetched is None


async def test__delete_filter__removes_from_sidebar_order(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test delete_filter removes the filter from sidebar_order."""
    data = ContentFilterCreate(
        name="To Delete",
        filter_expression=make_filter_expression([["delete"]]),
    )
    created = await create_filter(db_session, test_user.id, data)

    # Verify it's in sidebar_order (IDs stored as strings in JSON)
    settings = await get_settings(db_session, test_user.id)
    assert settings is not None
    assert settings.sidebar_order is not None
    filter_ids = [
        item["id"] for item in settings.sidebar_order["items"]
        if item.get("type") == "filter"
    ]
    assert str(created.id) in filter_ids

    # Delete
    await delete_filter(db_session, test_user.id, created.id)

    # Verify removed from sidebar_order
    await db_session.refresh(settings)
    filter_ids = [
        item["id"] for item in settings.sidebar_order["items"]
        if item.get("type") == "filter"
    ]
    assert str(created.id) not in filter_ids


async def test__delete_filter__returns_false_for_nonexistent(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test delete_filter returns False for non-existent filter."""
    result = await delete_filter(db_session, test_user.id, uuid4())
    assert result is False


async def test__delete_filter__returns_false_for_other_users_filter(
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
) -> None:
    """Test delete_filter returns False when trying to delete another user's filter."""
    # Create filter for other_user
    data = ContentFilterCreate(
        name="Other's Filter",
        filter_expression=make_filter_expression([["other"]]),
    )
    other_filter = await create_filter(db_session, other_user.id, data)

    # Try to delete with test_user
    result = await delete_filter(db_session, test_user.id, other_filter.id)

    assert result is False

    # Verify not deleted
    original = await get_filter(db_session, other_user.id, other_filter.id)
    assert original is not None


# =============================================================================
# updated_at Timestamp Tests
# =============================================================================


async def test__update_filter__updates_timestamp(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that update_filter updates the updated_at timestamp."""
    data = ContentFilterCreate(
        name="Original",
        filter_expression=make_filter_expression([["tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)
    await db_session.refresh(created)
    original_updated_at = created.updated_at

    # Update the filter
    update_data = ContentFilterUpdate(name="Updated Name")
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.updated_at > original_updated_at


async def test__update_filter__updates_timestamp_for_filter_changes(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that update_filter updates timestamp when filter expression changes."""
    data = ContentFilterCreate(
        name="Filter Test",
        filter_expression=make_filter_expression([["old-tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)
    await db_session.refresh(created)
    original_updated_at = created.updated_at

    # Update filter expression
    update_data = ContentFilterUpdate(
        filter_expression=make_filter_expression([["new-tag"]]),
    )
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.updated_at > original_updated_at


async def test__update_filter__updates_timestamp_even_with_no_field_changes(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """
    Test that update_filter updates timestamp even when no fields are actually changed.

    Note: This tests the current implementation behavior where updated_at is always
    set on update, even if the model_dump(exclude_unset=True) returns empty data.
    This is intentional to track when an update operation occurred.
    """
    data = ContentFilterCreate(
        name="No Change",
        filter_expression=make_filter_expression([["tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)
    await db_session.refresh(created)
    original_updated_at = created.updated_at

    # Update with empty data
    update_data = ContentFilterUpdate()
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    # Timestamp is updated because we explicitly set it in the service
    assert result.updated_at > original_updated_at


# =============================================================================
# Cascade Delete Tests
# =============================================================================


async def test__user_delete__cascades_to_filters(
    db_session: AsyncSession,
) -> None:
    """Test that deleting a user cascades to delete their filters."""
    user = User(auth0_id="cascade-filter-user", email="cascade@example.com")
    db_session.add(user)
    await db_session.flush()

    data = ContentFilterCreate(
        name="User's Filter",
        filter_expression=make_filter_expression([["cascade"]]),
    )
    created = await create_filter(db_session, user.id, data)
    filter_id = created.id

    # Delete user
    await db_session.delete(user)
    await db_session.flush()

    # Filter should be gone (use raw query to check without user scope)
    from sqlalchemy import select
    query = select(ContentFilter).where(ContentFilter.id == filter_id)
    result = await db_session.execute(query)
    assert result.scalar_one_or_none() is None


# =============================================================================
# Filter Expression Validation Tests
# =============================================================================


async def test__create_filter__complex_filter_expression(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter with a complex filter expression."""
    # (work AND high-priority) OR (urgent) OR (critical AND deadline)
    data = ContentFilterCreate(
        name="Complex Filter",
        filter_expression=FilterExpression(
            groups=[
                FilterGroup(tags=["work", "high-priority"]),
                FilterGroup(tags=["urgent"]),
                FilterGroup(tags=["critical", "deadline"]),
            ],
            group_operator="OR",
        ),
    )

    result = await create_filter(db_session, test_user.id, data)

    assert len(result.filter_expression["groups"]) == 3
    assert result.filter_expression["groups"][0]["tags"] == ["work", "high-priority"]
    assert result.filter_expression["groups"][1]["tags"] == ["urgent"]
    assert result.filter_expression["groups"][2]["tags"] == ["critical", "deadline"]


# =============================================================================
# Default Sort Field Tests
# =============================================================================


async def test__create_filter__creates_filter_with_sort_defaults(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter with default sort configuration."""
    data = ContentFilterCreate(
        name="Sorted Filter",
        filter_expression=make_filter_expression([["work"]]),
        default_sort_by="created_at",
        default_sort_ascending=True,
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.default_sort_by == "created_at"
    assert result.default_sort_ascending is True


async def test__create_filter__creates_filter_without_sort_defaults(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter without sort configuration uses NULL values."""
    data = ContentFilterCreate(
        name="No Sort Config",
        filter_expression=make_filter_expression([["work"]]),
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.default_sort_by is None
    assert result.default_sort_ascending is None


async def test__create_filter__creates_filter_with_sort_by_only(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating a filter with only sort_by (ascending defaults to None/False)."""
    data = ContentFilterCreate(
        name="Sort By Only",
        filter_expression=make_filter_expression([["work"]]),
        default_sort_by="last_used_at",
    )

    result = await create_filter(db_session, test_user.id, data)

    assert result.default_sort_by == "last_used_at"
    assert result.default_sort_ascending is None


async def test__create_filter__creates_filter_with_all_sort_options(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test creating filters with all valid sort options."""
    sort_options = ["created_at", "updated_at", "last_used_at", "title"]

    for i, sort_by in enumerate(sort_options):
        data = ContentFilterCreate(
            name=f"Filter sorted by {sort_by}",
            filter_expression=make_filter_expression([[f"tag-sort-{i}"]]),
            default_sort_by=sort_by,  # type: ignore[arg-type]
            default_sort_ascending=False,
        )

        result = await create_filter(db_session, test_user.id, data)

        assert result.default_sort_by == sort_by
        assert result.default_sort_ascending is False


async def test__update_filter__updates_sort_fields(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test updating a filter's sort configuration."""
    # Create without sort config
    data = ContentFilterCreate(
        name="To Update Sort",
        filter_expression=make_filter_expression([["tag"]]),
    )
    created = await create_filter(db_session, test_user.id, data)
    assert created.default_sort_by is None

    # Update with sort config
    update_data = ContentFilterUpdate(
        default_sort_by="title",
        default_sort_ascending=True,
    )
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.default_sort_by == "title"
    assert result.default_sort_ascending is True


async def test__update_filter__updates_sort_by_only(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test updating only the sort_by field."""
    data = ContentFilterCreate(
        name="Partial Update",
        filter_expression=make_filter_expression([["tag"]]),
        default_sort_by="created_at",
        default_sort_ascending=True,
    )
    created = await create_filter(db_session, test_user.id, data)

    # Update only sort_by, ascending should remain unchanged
    update_data = ContentFilterUpdate(default_sort_by="updated_at")
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    assert result.default_sort_by == "updated_at"
    # ascending should remain unchanged since exclude_unset=True
    assert result.default_sort_ascending is True


async def test__update_filter__clears_sort_config_with_none(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that setting sort fields to None clears them."""
    data = ContentFilterCreate(
        name="Clear Sort",
        filter_expression=make_filter_expression([["tag"]]),
        default_sort_by="created_at",
        default_sort_ascending=True,
    )
    created = await create_filter(db_session, test_user.id, data)

    # Note: To actually clear values, we need to explicitly set them to None
    # and they need to be included in the update. With exclude_unset=True,
    # we can only clear by explicitly setting to None if the field is provided.
    update_data = ContentFilterUpdate(
        default_sort_by=None,
        default_sort_ascending=None,
    )
    result = await update_filter(db_session, test_user.id, created.id, update_data)

    assert result is not None
    # Values are explicitly set to None
    assert result.default_sort_by is None
    assert result.default_sort_ascending is None


async def test__get_filter__returns_sort_fields(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that get_filter returns sort configuration."""
    data = ContentFilterCreate(
        name="Get With Sort",
        filter_expression=make_filter_expression([["tag"]]),
        default_sort_by="last_used_at",
        default_sort_ascending=False,
    )
    created = await create_filter(db_session, test_user.id, data)

    result = await get_filter(db_session, test_user.id, created.id)

    assert result is not None
    assert result.default_sort_by == "last_used_at"
    assert result.default_sort_ascending is False


async def test__get_filters__returns_sort_fields(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that get_filters returns sort configuration for all filters."""
    # Create filter with sort config
    data1 = ContentFilterCreate(
        name="With Sort",
        filter_expression=make_filter_expression([["tag1"]]),
        default_sort_by="title",
        default_sort_ascending=True,
    )
    # Create filter without sort config
    data2 = ContentFilterCreate(
        name="Without Sort",
        filter_expression=make_filter_expression([["tag2"]]),
    )

    await create_filter(db_session, test_user.id, data1)
    await create_filter(db_session, test_user.id, data2)

    results = await get_filters(db_session, test_user.id)

    assert len(results) == 2
    # First filter (created first)
    assert results[0].default_sort_by == "title"
    assert results[0].default_sort_ascending is True
    # Second filter
    assert results[1].default_sort_by is None
    assert results[1].default_sort_ascending is None
