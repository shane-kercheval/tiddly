"""Tests for sidebar schema validation."""
from uuid import uuid4

import pytest
from pydantic import ValidationError

from schemas.sidebar import (
    SIDEBAR_VERSION,
    SidebarBuiltinItem,
    SidebarCollection,
    SidebarFilterItem,
    SidebarOrder,
)


# =============================================================================
# SidebarBuiltinItem Tests
# =============================================================================


def test__sidebar_builtin_item__valid_all() -> None:
    """Test that 'all' is a valid builtin key."""
    item = SidebarBuiltinItem(type="builtin", key="all")
    assert item.key == "all"
    assert item.type == "builtin"


def test__sidebar_builtin_item__valid_archived() -> None:
    """Test that 'archived' is a valid builtin key."""
    item = SidebarBuiltinItem(type="builtin", key="archived")
    assert item.key == "archived"


def test__sidebar_builtin_item__valid_trash() -> None:
    """Test that 'trash' is a valid builtin key."""
    item = SidebarBuiltinItem(type="builtin", key="trash")
    assert item.key == "trash"


def test__sidebar_builtin_item__rejects_invalid_key() -> None:
    """Test that invalid builtin keys are rejected."""
    with pytest.raises(ValidationError) as exc_info:
        SidebarBuiltinItem(type="builtin", key="invalid")

    assert "key" in str(exc_info.value)


def test__sidebar_builtin_item__rejects_all_bookmarks() -> None:
    """Test that 'all-bookmarks' is not a valid builtin key (removed in new format)."""
    with pytest.raises(ValidationError):
        SidebarBuiltinItem(type="builtin", key="all-bookmarks")


def test__sidebar_builtin_item__rejects_all_notes() -> None:
    """Test that 'all-notes' is not a valid builtin key (removed in new format)."""
    with pytest.raises(ValidationError):
        SidebarBuiltinItem(type="builtin", key="all-notes")


# =============================================================================
# SidebarFilterItem Tests
# =============================================================================


def test__sidebar_filter_item__valid() -> None:
    """Test that filter items with UUID IDs are valid."""
    test_id = uuid4()
    item = SidebarFilterItem(type="filter", id=test_id)
    assert item.id == test_id
    assert item.type == "filter"


def test__sidebar_filter_item__valid_uuid_string() -> None:
    """Test that filter items with UUID strings are valid."""
    uuid_str = "550e8400-e29b-41d4-a716-446655440000"
    item = SidebarFilterItem(type="filter", id=uuid_str)  # type: ignore[arg-type]
    assert str(item.id) == uuid_str


def test__sidebar_filter_item__coerces_string_id() -> None:
    """Test that string UUID IDs are coerced to UUID by Pydantic."""
    # Pydantic's default behavior is to coerce compatible types
    uuid_str = "550e8400-e29b-41d4-a716-446655440001"
    item = SidebarFilterItem(type="filter", id=uuid_str)  # type: ignore[arg-type]
    assert str(item.id) == uuid_str


# =============================================================================
# SidebarCollection Tests
# =============================================================================


def test__sidebar_collection__valid_minimal() -> None:
    """Test that a valid minimal collection is accepted."""
    group = SidebarCollection(
        type="collection",
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Work",
        items=[],
    )
    assert group.name == "Work"
    assert group.items == []


def test__sidebar_collection__valid_with_items() -> None:
    """Test that a collection with items is valid."""
    group = SidebarCollection(
        type="collection",
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Work",
        items=[
            SidebarFilterItem(type="filter", id=uuid4()),
            SidebarBuiltinItem(type="builtin", key="archived"),
        ],
    )
    assert len(group.items) == 2


def test__sidebar_collection__rejects_invalid_uuid() -> None:
    """Test that invalid UUID format is rejected."""
    with pytest.raises(ValidationError) as exc_info:
        SidebarCollection(
            type="collection",
            id="not-a-uuid",
            name="Work",
            items=[],
        )

    assert "id" in str(exc_info.value)


def test__sidebar_collection__rejects_uppercase_uuid() -> None:
    """Test that uppercase UUID is rejected (must be lowercase)."""
    with pytest.raises(ValidationError):
        SidebarCollection(
            type="collection",
            id="550E8400-E29B-41D4-A716-446655440000",  # Uppercase
            name="Work",
            items=[],
        )


def test__sidebar_collection__rejects_empty_name() -> None:
    """Test that empty collection name is rejected."""
    with pytest.raises(ValidationError) as exc_info:
        SidebarCollection(
            type="collection",
            id="550e8400-e29b-41d4-a716-446655440000",
            name="",
            items=[],
        )

    assert "name" in str(exc_info.value)


def test__sidebar_collection__rejects_too_long_name() -> None:
    """Test that collection name over 100 chars is rejected."""
    with pytest.raises(ValidationError) as exc_info:
        SidebarCollection(
            type="collection",
            id="550e8400-e29b-41d4-a716-446655440000",
            name="x" * 101,
            items=[],
        )

    assert "name" in str(exc_info.value)


def test__sidebar_collection__accepts_max_length_name() -> None:
    """Test that collection name at exactly 100 chars is accepted."""
    group = SidebarCollection(
        type="collection",
        id="550e8400-e29b-41d4-a716-446655440000",
        name="x" * 100,
        items=[],
    )
    assert len(group.name) == 100


# =============================================================================
# SidebarOrder Tests
# =============================================================================


def test__sidebar_order__valid_minimal() -> None:
    """Test that a minimal valid sidebar order is accepted."""
    order = SidebarOrder(
        version=SIDEBAR_VERSION,
        items=[
            SidebarBuiltinItem(type="builtin", key="all"),
        ],
    )
    assert order.version == SIDEBAR_VERSION
    assert len(order.items) == 1


def test__sidebar_order__valid_with_all_types() -> None:
    """Test sidebar order with builtins, lists, and groups."""
    order = SidebarOrder(
        version=SIDEBAR_VERSION,
        items=[
            SidebarBuiltinItem(type="builtin", key="all"),
            SidebarCollection(
                type="collection",
                id="550e8400-e29b-41d4-a716-446655440000",
                name="Work",
                items=[
                    SidebarFilterItem(type="filter", id=uuid4()),
                    SidebarFilterItem(type="filter", id=uuid4()),
                ],
            ),
            SidebarFilterItem(type="filter", id=uuid4()),
            SidebarBuiltinItem(type="builtin", key="archived"),
            SidebarBuiltinItem(type="builtin", key="trash"),
        ],
    )
    assert len(order.items) == 5


def test__sidebar_order__defaults_version() -> None:
    """Test that version defaults to SIDEBAR_VERSION."""
    order = SidebarOrder(items=[])
    assert order.version == SIDEBAR_VERSION


def test__sidebar_order__valid_empty_items() -> None:
    """Test that empty items list is valid."""
    order = SidebarOrder(version=SIDEBAR_VERSION, items=[])
    assert order.items == []


def test__sidebar_order__from_dict() -> None:
    """Test that SidebarOrder can be constructed from a dict."""
    data = {
        "version": 1,
        "items": [
            {"type": "builtin", "key": "all"},
            {
                "type": "collection",
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Work",
                "items": [
                    {"type": "filter", "id": "550e8400-e29b-41d4-a716-446655440001"},
                ],
            },
            {"type": "filter", "id": "550e8400-e29b-41d4-a716-446655440002"},
        ],
    }
    order = SidebarOrder.model_validate(data)
    assert order.version == 1
    assert len(order.items) == 3


def test__sidebar_order__rejects_nested_groups() -> None:
    """Test that nested collections are rejected at schema level."""
    # Groups can only contain list and builtin items, not other groups.
    # This is enforced by the type annotation on SidebarCollection.items.
    with pytest.raises(ValidationError):
        SidebarOrder.model_validate({
            "version": 1,
            "items": [
                {
                    "type": "collection",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Outer",
                    "items": [
                        {
                            "type": "collection",  # Nested group - should fail
                            "id": "660e8400-e29b-41d4-a716-446655440001",
                            "name": "Inner",
                            "items": [],
                        },
                    ],
                },
            ],
        })
