"""Tests for sidebar service layer functionality."""
import copy

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.content_list import ContentList
from models.user import User
from models.user_settings import UserSettings
from schemas.sidebar import (
    SIDEBAR_VERSION,
    SidebarBuiltinItem,
    SidebarGroup,
    SidebarListItem,
    SidebarOrder,
)
from services.sidebar_service import (
    _ensure_sidebar_order_structure,
    _extract_builtin_keys_from_items,
    _extract_group_ids_from_items,
    _extract_list_ids_from_items,
    _remove_list_from_items,
    _validate_sidebar_order,
    add_list_to_sidebar,
    get_computed_sidebar,
    get_default_sidebar_order,
    remove_list_from_sidebar,
    update_sidebar_order,
)


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(auth0_id="test-sidebar-user-123", email="sidebar@example.com")
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_list(db_session: AsyncSession, test_user: User) -> ContentList:
    """Create a test content list."""
    content_list = ContentList(
        user_id=test_user.id,
        name="Test List",
        content_types=["bookmark"],
        filter_expression={"groups": [], "group_operator": "OR"},
    )
    db_session.add(content_list)
    await db_session.flush()
    await db_session.refresh(content_list)
    return content_list


# =============================================================================
# get_default_sidebar_order Tests
# =============================================================================


def test__get_default_sidebar_order__returns_correct_structure() -> None:
    """Test that get_default_sidebar_order returns the correct default structure."""
    result = get_default_sidebar_order()

    assert result["version"] == SIDEBAR_VERSION
    assert len(result["items"]) == 3

    # Check builtin items
    assert result["items"][0] == {"type": "builtin", "key": "all"}
    assert result["items"][1] == {"type": "builtin", "key": "archived"}
    assert result["items"][2] == {"type": "builtin", "key": "trash"}


# =============================================================================
# _ensure_sidebar_order_structure Tests
# =============================================================================


def test__ensure_sidebar_order_structure__returns_default_for_none() -> None:
    """Test that None input returns default structure."""
    result = _ensure_sidebar_order_structure(None)
    assert result == get_default_sidebar_order()


def test__ensure_sidebar_order_structure__does_not_mutate_input() -> None:
    """Test that the function does not mutate its input dict."""
    original = {"version": 1, "items": [{"type": "builtin", "key": "all"}]}
    original_copy = copy.deepcopy(original)

    _ensure_sidebar_order_structure(original)

    assert original == original_copy


def test__ensure_sidebar_order_structure__adds_missing_version() -> None:
    """Test that missing version is added."""
    result = _ensure_sidebar_order_structure({"items": []})
    assert result["version"] == SIDEBAR_VERSION


def test__ensure_sidebar_order_structure__adds_missing_items() -> None:
    """Test that missing items key is filled with defaults."""
    result = _ensure_sidebar_order_structure({"version": 1})
    assert "items" in result
    assert len(result["items"]) == 3  # Default builtins


# =============================================================================
# Helper extraction function tests
# =============================================================================


def test__extract_list_ids_from_items__extracts_from_root() -> None:
    """Test extracting list IDs from root items."""
    items = [
        {"type": "list", "id": 1},
        {"type": "builtin", "key": "all"},
        {"type": "list", "id": 2},
    ]
    result = _extract_list_ids_from_items(items)
    assert result == {1, 2}


def test__extract_list_ids_from_items__extracts_from_groups() -> None:
    """Test extracting list IDs from groups."""
    items = [
        {
            "type": "group",
            "id": "uuid-1",
            "name": "Group",
            "items": [
                {"type": "list", "id": 3},
                {"type": "list", "id": 4},
            ],
        },
        {"type": "list", "id": 5},
    ]
    result = _extract_list_ids_from_items(items)
    assert result == {3, 4, 5}


def test__extract_builtin_keys_from_items__extracts_all() -> None:
    """Test extracting builtin keys."""
    items = [
        {"type": "builtin", "key": "all"},
        {"type": "builtin", "key": "archived"},
        {"type": "group", "items": [{"type": "builtin", "key": "trash"}]},
    ]
    result = _extract_builtin_keys_from_items(items)
    assert result == {"all", "archived", "trash"}


def test__extract_group_ids_from_items__extracts_ids() -> None:
    """Test extracting group IDs."""
    items = [
        {"type": "group", "id": "uuid-1", "items": []},
        {"type": "group", "id": "uuid-2", "items": []},
        {"type": "list", "id": 1},
    ]
    result = _extract_group_ids_from_items(items)
    assert result == {"uuid-1", "uuid-2"}


# =============================================================================
# _remove_list_from_items Tests
# =============================================================================


def test__remove_list_from_items__removes_from_root() -> None:
    """Test removing a list from root items."""
    items = [
        {"type": "list", "id": 1},
        {"type": "list", "id": 2},
        {"type": "builtin", "key": "all"},
    ]
    new_items, was_removed = _remove_list_from_items(items, 1)

    assert was_removed is True
    assert len(new_items) == 2
    assert {"type": "list", "id": 1} not in new_items


def test__remove_list_from_items__removes_from_group() -> None:
    """Test removing a list from within a group."""
    items = [
        {
            "type": "group",
            "id": "uuid-1",
            "name": "Group",
            "items": [
                {"type": "list", "id": 1},
                {"type": "list", "id": 2},
            ],
        },
    ]
    new_items, was_removed = _remove_list_from_items(items, 1)

    assert was_removed is True
    assert len(new_items[0]["items"]) == 1
    assert new_items[0]["items"][0]["id"] == 2


def test__remove_list_from_items__returns_false_when_not_found() -> None:
    """Test that removing a nonexistent list returns False."""
    items = [{"type": "list", "id": 1}]
    new_items, was_removed = _remove_list_from_items(items, 999)

    assert was_removed is False
    assert new_items == items


# =============================================================================
# _validate_sidebar_order Tests
# =============================================================================


def test__validate_sidebar_order__accepts_valid_structure() -> None:
    """Test that a valid structure passes validation."""
    order = SidebarOrder(
        items=[
            SidebarBuiltinItem(type="builtin", key="all"),
            SidebarListItem(type="list", id=1),
        ],
    )
    # Should not raise
    _validate_sidebar_order(order, {1})


def test__validate_sidebar_order__rejects_duplicate_list() -> None:
    """Test that duplicate list IDs are rejected."""
    order = SidebarOrder(
        items=[
            SidebarListItem(type="list", id=1),
            SidebarListItem(type="list", id=1),
        ],
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_sidebar_order(order, {1})

    assert exc_info.value.status_code == 400
    assert "Duplicate list item" in exc_info.value.detail


def test__validate_sidebar_order__rejects_duplicate_builtin() -> None:
    """Test that duplicate builtin keys are rejected."""
    order = SidebarOrder(
        items=[
            SidebarBuiltinItem(type="builtin", key="all"),
            SidebarBuiltinItem(type="builtin", key="all"),
        ],
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_sidebar_order(order, set())

    assert exc_info.value.status_code == 400
    assert "Duplicate builtin item" in exc_info.value.detail


def test__validate_sidebar_order__rejects_duplicate_group_id() -> None:
    """Test that duplicate group IDs are rejected."""
    order = SidebarOrder(
        items=[
            SidebarGroup(
                type="group",
                id="550e8400-e29b-41d4-a716-446655440000",
                name="Group 1",
                items=[],
            ),
            SidebarGroup(
                type="group",
                id="550e8400-e29b-41d4-a716-446655440000",
                name="Group 2",
                items=[],
            ),
        ],
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_sidebar_order(order, set())

    assert exc_info.value.status_code == 400
    assert "Duplicate group ID" in exc_info.value.detail


def test__validate_sidebar_order__rejects_nonexistent_list() -> None:
    """Test that list IDs not belonging to user are rejected."""
    order = SidebarOrder(
        items=[
            SidebarListItem(type="list", id=999),
        ],
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_sidebar_order(order, {1, 2, 3})  # 999 not in set

    assert exc_info.value.status_code == 400
    assert "List not found" in exc_info.value.detail


def test__validate_sidebar_order__allows_duplicate_group_names() -> None:
    """Test that groups with same name but different IDs are allowed."""
    order = SidebarOrder(
        items=[
            SidebarGroup(
                type="group",
                id="550e8400-e29b-41d4-a716-446655440000",
                name="Work",
                items=[],
            ),
            SidebarGroup(
                type="group",
                id="660e8400-e29b-41d4-a716-446655440001",
                name="Work",  # Same name, different ID - allowed
                items=[],
            ),
        ],
    )
    # Should not raise
    _validate_sidebar_order(order, set())


# =============================================================================
# get_computed_sidebar Tests
# =============================================================================


async def test__get_computed_sidebar__returns_default_for_new_user(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that new users get default sidebar."""
    result = await get_computed_sidebar(db_session, test_user.id, [])

    assert result.version == SIDEBAR_VERSION
    assert len(result.items) == 3

    # Check builtin names are resolved
    builtin_keys = [
        item.key for item in result.items if hasattr(item, "key")
    ]
    assert "all" in builtin_keys
    assert "archived" in builtin_keys
    assert "trash" in builtin_keys


async def test__get_computed_sidebar__resolves_list_names(
    db_session: AsyncSession,
    test_user: User,
    test_list: ContentList,
) -> None:
    """Test that list names are resolved from database."""
    # Set up sidebar with the list
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {"type": "list", "id": test_list.id},
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await get_computed_sidebar(db_session, test_user.id, [test_list])

    # Find the list item
    list_items = [item for item in result.items if hasattr(item, "name") and hasattr(item, "content_types")]
    assert len(list_items) == 1
    assert list_items[0].name == "Test List"
    assert list_items[0].content_types == ["bookmark"]


async def test__get_computed_sidebar__filters_deleted_list_references(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that references to deleted lists are filtered out."""
    # Set up sidebar with a nonexistent list
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {"type": "list", "id": 9999},  # Doesn't exist
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await get_computed_sidebar(db_session, test_user.id, [])

    # Should only have the builtin
    assert len(result.items) == 1
    assert result.items[0].key == "all"  # type: ignore[union-attr]


async def test__get_computed_sidebar__appends_orphan_lists_to_root(
    db_session: AsyncSession,
    test_user: User,
    test_list: ContentList,
) -> None:
    """Test that lists in DB but not in sidebar are appended to root."""
    # Set up sidebar WITHOUT the list
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await get_computed_sidebar(db_session, test_user.id, [test_list])

    # Should have builtin + orphan list
    assert len(result.items) == 2

    # Last item should be the orphaned list
    last_item = result.items[-1]
    assert hasattr(last_item, "id")
    assert last_item.id == test_list.id  # type: ignore[union-attr]


async def test__get_computed_sidebar__preserves_group_structure(
    db_session: AsyncSession,
    test_user: User,
    test_list: ContentList,
) -> None:
    """Test that group structure is preserved in computed sidebar."""
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {
                    "type": "group",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Work",
                    "items": [
                        {"type": "list", "id": test_list.id},
                    ],
                },
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await get_computed_sidebar(db_session, test_user.id, [test_list])

    assert len(result.items) == 1
    group = result.items[0]
    assert group.type == "group"
    assert group.name == "Work"  # type: ignore[union-attr]
    assert len(group.items) == 1  # type: ignore[union-attr]


# =============================================================================
# update_sidebar_order Tests
# =============================================================================


async def test__update_sidebar_order__saves_valid_structure(
    db_session: AsyncSession,
    test_user: User,
    test_list: ContentList,
) -> None:
    """Test that a valid sidebar order is saved."""
    order = SidebarOrder(
        items=[
            SidebarBuiltinItem(type="builtin", key="all"),
            SidebarListItem(type="list", id=test_list.id),
        ],
    )

    result = await update_sidebar_order(
        db_session, test_user.id, order, {test_list.id},
    )

    assert result.sidebar_order is not None
    assert len(result.sidebar_order["items"]) == 2


async def test__update_sidebar_order__rejects_other_users_list(
    db_session: AsyncSession,
    test_user: User,
    test_list: ContentList,
) -> None:
    """Test that lists not belonging to user are rejected."""
    order = SidebarOrder(
        items=[
            SidebarListItem(type="list", id=test_list.id),
        ],
    )

    with pytest.raises(HTTPException) as exc_info:
        await update_sidebar_order(
            db_session, test_user.id, order, set(),  # Empty set = no lists belong to user
        )

    assert exc_info.value.status_code == 400


# =============================================================================
# add_list_to_sidebar Tests
# =============================================================================


async def test__add_list_to_sidebar__creates_default_with_list(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test adding list when no settings exist creates default with list."""
    result = await add_list_to_sidebar(db_session, test_user.id, 42)

    assert result.sidebar_order is not None
    list_ids = _extract_list_ids_from_items(result.sidebar_order["items"])
    assert 42 in list_ids


async def test__add_list_to_sidebar__appends_to_existing(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that list is appended to end of existing sidebar."""
    # Create initial sidebar
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await add_list_to_sidebar(db_session, test_user.id, 42)

    # List should be at the end
    items = result.sidebar_order["items"]
    assert items[-1] == {"type": "list", "id": 42}


async def test__add_list_to_sidebar__does_not_duplicate(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that adding existing list does not create duplicate."""
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "list", "id": 42},
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await add_list_to_sidebar(db_session, test_user.id, 42)

    list_ids = _extract_list_ids_from_items(result.sidebar_order["items"])
    # Should only appear once
    assert list_ids == {42}


# =============================================================================
# remove_list_from_sidebar Tests
# =============================================================================


async def test__remove_list_from_sidebar__returns_none_when_no_settings(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test that removing list when no settings exist returns None."""
    result = await remove_list_from_sidebar(db_session, test_user.id, 1)
    assert result is None


async def test__remove_list_from_sidebar__removes_from_root(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test removing list from root level."""
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {"type": "list", "id": 5},
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await remove_list_from_sidebar(db_session, test_user.id, 5)

    assert result is not None
    list_ids = _extract_list_ids_from_items(result.sidebar_order["items"])
    assert 5 not in list_ids


async def test__remove_list_from_sidebar__removes_from_group(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test removing list from within a group."""
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {
                    "type": "group",
                    "id": "uuid-1",
                    "name": "Work",
                    "items": [
                        {"type": "list", "id": 10},
                    ],
                },
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()

    result = await remove_list_from_sidebar(db_session, test_user.id, 10)

    assert result is not None
    list_ids = _extract_list_ids_from_items(result.sidebar_order["items"])
    assert 10 not in list_ids


async def test__remove_list_from_sidebar__handles_nonexistent_list(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Test removing list that doesn't exist in sidebar is a no-op."""
    settings = UserSettings(
        user_id=test_user.id,
        sidebar_order={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
            ],
        },
    )
    db_session.add(settings)
    await db_session.flush()
    original_order = copy.deepcopy(settings.sidebar_order)

    result = await remove_list_from_sidebar(db_session, test_user.id, 999)

    assert result is not None
    assert result.sidebar_order == original_order
