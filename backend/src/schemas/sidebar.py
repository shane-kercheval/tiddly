"""Pydantic schemas for sidebar structure and API endpoints."""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Current schema version for future migrations
SIDEBAR_VERSION = 1

# Valid built-in keys for sidebar navigation
BuiltinKey = Literal["all", "archived", "trash"]

# UUID regex pattern for validation
UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


# =============================================================================
# Input schemas (used in PUT requests)
# =============================================================================


class SidebarBuiltinItem(BaseModel):
    """A built-in navigation item (All, Archived, Trash)."""

    type: Literal["builtin"]
    key: BuiltinKey


class SidebarFilterItem(BaseModel):
    """A user-created filter item."""

    type: Literal["filter"]
    id: UUID


class SidebarCollection(BaseModel):
    """A collection containing other items (cannot be nested)."""

    type: Literal["collection"]
    id: Annotated[str, Field(pattern=UUID_PATTERN)]
    name: Annotated[str, Field(min_length=1, max_length=100)]
    items: list["SidebarFilterItem | SidebarBuiltinItem"]


# Union type for any sidebar item
SidebarItem = SidebarBuiltinItem | SidebarFilterItem | SidebarCollection


class SidebarOrder(BaseModel):
    """
    The complete sidebar structure for a user.

    Example structure:
    {
        "version": 1,
        "items": [
            {"type": "builtin", "key": "all"},
            {
                "type": "collection",
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Work",
                "items": [
                    {"type": "filter", "id": "..."},
                    {"type": "filter", "id": "..."}
                ]
            },
            {"type": "filter", "id": "..."},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"}
        ]
    }
    """

    version: int = SIDEBAR_VERSION
    items: list[SidebarItem]


# =============================================================================
# Computed schemas (returned by GET responses with resolved names)
# =============================================================================


class SidebarBuiltinItemComputed(SidebarBuiltinItem):
    """A built-in item with display name resolved."""

    name: str  # "All", "Archived", "Trash"


class SidebarFilterItemComputed(SidebarFilterItem):
    """A filter item with name and content types resolved from database."""

    name: str
    content_types: list[str]


class SidebarCollectionComputed(BaseModel):
    """A collection with resolved child items."""

    type: Literal["collection"]
    id: str
    name: str
    items: list[SidebarFilterItemComputed | SidebarBuiltinItemComputed]


# Union type for computed sidebar items
SidebarItemComputed = (
    SidebarBuiltinItemComputed | SidebarFilterItemComputed | SidebarCollectionComputed
)


class SidebarOrderComputed(BaseModel):
    """
    The complete sidebar structure with resolved names.

    Returned by GET /settings/sidebar with all filter names and
    content types resolved from the database.
    """

    version: int
    items: list[SidebarItemComputed]


# =============================================================================
# Display name mapping
# =============================================================================

BUILTIN_DISPLAY_NAMES: dict[BuiltinKey, str] = {
    "all": "All Content",
    "archived": "Archived",
    "trash": "Trash",
}
