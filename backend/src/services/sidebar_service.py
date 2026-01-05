"""Service layer for sidebar operations."""
import copy
import logging

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from models.content_list import ContentList
from models.user_settings import UserSettings
from schemas.sidebar import (
    BUILTIN_DISPLAY_NAMES,
    SIDEBAR_VERSION,
    BuiltinKey,
    SidebarBuiltinItem,
    SidebarBuiltinItemComputed,
    SidebarGroup,
    SidebarGroupComputed,
    SidebarItem,
    SidebarListItem,
    SidebarListItemComputed,
    SidebarOrder,
    SidebarOrderComputed,
)
from services.exceptions import (
    SidebarDuplicateItemError,
    SidebarListNotFoundError,
    SidebarNestedGroupError,
)
from services.settings_service import get_or_create_settings

logger = logging.getLogger(__name__)


def get_default_sidebar_order() -> dict:
    """
    Return the default sidebar structure for new users.

    Contains only the built-in navigation items: All, Archived, Trash.
    """
    return {
        "version": SIDEBAR_VERSION,
        "items": [
            {"type": "builtin", "key": "all"},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
        ],
    }


def _extract_list_ids_from_items(items: list[dict]) -> set[int]:
    """Extract all list IDs from a list of sidebar items (recursive for groups)."""
    list_ids: set[int] = set()
    for item in items:
        if item.get("type") == "list":
            list_ids.add(item["id"])
        elif item.get("type") == "group":
            list_ids.update(_extract_list_ids_from_items(item.get("items", [])))
    return list_ids


def _extract_builtin_keys_from_items(items: list[dict]) -> set[str]:
    """Extract all builtin keys from a list of sidebar items (recursive for groups)."""
    builtin_keys: set[str] = set()
    for item in items:
        if item.get("type") == "builtin":
            builtin_keys.add(item["key"])
        elif item.get("type") == "group":
            builtin_keys.update(_extract_builtin_keys_from_items(item.get("items", [])))
    return builtin_keys


def _extract_group_ids_from_items(items: list[dict]) -> set[str]:
    """Extract all group IDs from a list of sidebar items."""
    group_ids: set[str] = set()
    for item in items:
        if item.get("type") == "group":
            group_ids.add(item["id"])
    return group_ids


def _ensure_sidebar_order_structure(sidebar_order: dict | None) -> dict:
    """
    Ensure sidebar_order has the correct structure, filling in defaults.

    Always returns a NEW dict to avoid mutating the input. This makes the
    function safe to use regardless of whether the caller passes a tracked
    SQLAlchemy object or not.
    """
    if sidebar_order is None:
        return get_default_sidebar_order()

    # Create a deep copy to avoid mutating the input
    result = copy.deepcopy(sidebar_order)

    # Ensure version exists
    if "version" not in result:
        result["version"] = SIDEBAR_VERSION

    # Ensure items exists
    if "items" not in result:
        result["items"] = get_default_sidebar_order()["items"]

    return result


def _compute_builtin_item(key: BuiltinKey) -> SidebarBuiltinItemComputed:
    """Create a computed builtin item with display name."""
    return SidebarBuiltinItemComputed(
        type="builtin",
        key=key,
        name=BUILTIN_DISPLAY_NAMES[key],
    )


def _compute_list_item(
    list_id: int,
    list_map: dict[int, ContentList],
) -> SidebarListItemComputed | None:
    """Create a computed list item, or None if list doesn't exist."""
    content_list = list_map.get(list_id)
    if content_list is None:
        return None
    return SidebarListItemComputed(
        type="list",
        id=list_id,
        name=content_list.name,
        content_types=content_list.content_types,
    )


def _compute_items(
    items: list[dict],
    list_map: dict[int, ContentList],
    seen_list_ids: set[int],
) -> list[SidebarBuiltinItemComputed | SidebarListItemComputed | SidebarGroupComputed]:
    """
    Compute a list of sidebar items, resolving list names and filtering orphans.

    Args:
        items: Raw sidebar items from the database.
        list_map: Map of list_id -> ContentList for this user.
        seen_list_ids: Set to track which list IDs we've seen (modified in place).

    Returns:
        List of computed sidebar items with resolved names.
    """
    computed: list[
        SidebarBuiltinItemComputed | SidebarListItemComputed | SidebarGroupComputed
    ] = []

    for item in items:
        item_type = item.get("type")

        if item_type == "builtin":
            key = item.get("key")
            if key in BUILTIN_DISPLAY_NAMES:
                computed.append(_compute_builtin_item(key))

        elif item_type == "list":
            list_id = item.get("id")
            if list_id is not None:
                computed_item = _compute_list_item(list_id, list_map)
                if computed_item is not None:
                    computed.append(computed_item)
                    seen_list_ids.add(list_id)

        elif item_type == "group":
            # Validate required group fields
            group_id = item.get("id")
            group_name = item.get("name")
            if not group_id or not group_name:
                logger.warning(
                    "Skipping malformed group in sidebar_order: missing id or name. "
                    "item=%r",
                    item,
                )
                continue

            # Recursively compute group items
            group_items = item.get("items", [])
            computed_group_items = _compute_items(group_items, list_map, seen_list_ids)

            # Only include builtin and list items in group (filter out any nested groups)
            valid_group_items: list[
                SidebarListItemComputed | SidebarBuiltinItemComputed
            ] = [
                i
                for i in computed_group_items
                if isinstance(i, SidebarListItemComputed | SidebarBuiltinItemComputed)
            ]

            computed.append(
                SidebarGroupComputed(
                    type="group",
                    id=group_id,
                    name=group_name,
                    items=valid_group_items,
                ),
            )

    return computed


async def get_computed_sidebar(
    db: AsyncSession,
    user_id: int,
    lists: list[ContentList],
) -> SidebarOrderComputed:
    """
    Fetch sidebar_order and resolve list names/content_types.

    Args:
        db: Database session.
        user_id: The user's ID.
        lists: Pre-fetched list of user's ContentLists.

    Returns:
        Computed sidebar with resolved list names and content types.

    Processing:
        1. Get raw sidebar_order from UserSettings
        2. Walk the structure, resolving list IDs to names/content_types
        3. Filter out orphaned references (lists in sidebar but deleted from DB)
        4. Prepend orphaned lists (lists in DB but not in sidebar) to root
        5. Add display names for builtins
    """
    settings = await get_or_create_settings(db, user_id)
    sidebar_order = _ensure_sidebar_order_structure(settings.sidebar_order)

    # Build map of list_id -> ContentList
    list_map = {lst.id: lst for lst in lists}

    # Track which lists we've seen in the sidebar structure
    seen_list_ids: set[int] = set()

    # Compute items (resolves names, filters deleted lists)
    computed_items = _compute_items(
        sidebar_order.get("items", []),
        list_map,
        seen_list_ids,
    )

    # Prepend orphaned lists (in DB but not in sidebar) to root
    orphaned_items: list[SidebarListItemComputed] = []
    for list_id, content_list in list_map.items():
        if list_id not in seen_list_ids:
            orphaned_items.append(
                SidebarListItemComputed(
                    type="list",
                    id=list_id,
                    name=content_list.name,
                    content_types=content_list.content_types,
                ),
            )
    if orphaned_items:
        computed_items = orphaned_items + computed_items

    return SidebarOrderComputed(
        version=sidebar_order.get("version", SIDEBAR_VERSION),
        items=computed_items,
    )


def _validate_sidebar_order(
    sidebar_order: SidebarOrder,
    user_list_ids: set[int],
) -> None:
    """
    Validate a sidebar order structure.

    Args:
        sidebar_order: The sidebar order to validate.
        user_list_ids: Set of list IDs that belong to this user.

    Raises:
        SidebarDuplicateItemError: If a duplicate item is found.
        SidebarListNotFoundError: If a list ID doesn't exist or belong to user.
        SidebarNestedGroupError: If groups are nested.
    """
    # Extract all items for duplicate checking
    seen_list_ids: set[int] = set()
    seen_builtin_keys: set[str] = set()
    seen_group_ids: set[str] = set()

    def validate_item(item: SidebarItem, allow_groups: bool = True) -> None:
        """Validate a single item and track for duplicates."""
        if isinstance(item, SidebarBuiltinItem):
            if item.key in seen_builtin_keys:
                raise SidebarDuplicateItemError("builtin", item.key)
            seen_builtin_keys.add(item.key)

        elif isinstance(item, SidebarListItem):
            if item.id in seen_list_ids:
                raise SidebarDuplicateItemError("list", item.id)
            if item.id not in user_list_ids:
                raise SidebarListNotFoundError(item.id)
            seen_list_ids.add(item.id)

        elif isinstance(item, SidebarGroup):
            if not allow_groups:
                raise SidebarNestedGroupError()
            if item.id in seen_group_ids:
                raise SidebarDuplicateItemError("group", item.id)
            seen_group_ids.add(item.id)

            # Validate group children (no nested groups allowed)
            for child in item.items:
                validate_item(child, allow_groups=False)

    # Validate all top-level items
    for item in sidebar_order.items:
        validate_item(item)


async def update_sidebar_order(
    db: AsyncSession,
    user_id: int,
    sidebar_order: SidebarOrder,
    user_list_ids: set[int],
) -> UserSettings:
    """
    Validate and save sidebar structure.

    Args:
        db: Database session.
        user_id: The user's ID.
        sidebar_order: The new sidebar structure.
        user_list_ids: Set of list IDs that belong to this user.

    Returns:
        Updated UserSettings.

    Raises:
        SidebarDuplicateItemError: If a duplicate item is found.
        SidebarListNotFoundError: If a list ID doesn't exist or belong to user.
        SidebarNestedGroupError: If groups are nested.
    """
    # Validate the structure
    _validate_sidebar_order(sidebar_order, user_list_ids)

    # Get or create settings
    settings = await get_or_create_settings(db, user_id)

    # Save the sidebar order
    settings.sidebar_order = sidebar_order.model_dump()
    flag_modified(settings, "sidebar_order")
    settings.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(settings)
    return settings


async def add_list_to_sidebar(
    db: AsyncSession,
    user_id: int,
    list_id: int,
) -> UserSettings:
    """
    Add a newly created list to the end of sidebar_order.items.

    Args:
        db: Database session.
        user_id: The user's ID.
        list_id: The ID of the newly created list.

    Returns:
        Updated UserSettings.
    """
    settings = await get_or_create_settings(db, user_id)

    # Get or create sidebar order structure (creates a copy)
    sidebar_order = _ensure_sidebar_order_structure(settings.sidebar_order)

    # Check if list already exists in sidebar
    existing_list_ids = _extract_list_ids_from_items(sidebar_order.get("items", []))
    if list_id in existing_list_ids:
        # List already exists, no change needed
        return settings

    # Append to the end of root items
    sidebar_order["items"].append({"type": "list", "id": list_id})

    settings.sidebar_order = sidebar_order
    flag_modified(settings, "sidebar_order")
    settings.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(settings)
    return settings


def _remove_list_from_items(items: list[dict], list_id: int) -> tuple[list[dict], bool]:
    """
    Remove a list from items (recursively searches groups).

    Args:
        items: List of sidebar items.
        list_id: The list ID to remove.

    Returns:
        Tuple of (new items list, was_removed).
    """
    new_items: list[dict] = []
    was_removed = False

    for item in items:
        if item.get("type") == "list" and item.get("id") == list_id:
            was_removed = True
            continue

        if item.get("type") == "group":
            # Recursively process group items
            group_items, group_removed = _remove_list_from_items(
                item.get("items", []),
                list_id,
            )
            if group_removed:
                was_removed = True
            new_items.append({**item, "items": group_items})
        else:
            new_items.append(item)

    return new_items, was_removed


async def remove_list_from_sidebar(
    db: AsyncSession,
    user_id: int,
    list_id: int,
) -> UserSettings | None:
    """
    Remove a list from sidebar_order.

    Searches through items and group items to find and remove the list.

    Args:
        db: Database session.
        user_id: The user's ID.
        list_id: The ID of the list to remove.

    Returns:
        Updated UserSettings, or None if no settings exist.
    """
    from services.settings_service import get_settings

    settings = await get_settings(db, user_id)
    if settings is None or settings.sidebar_order is None:
        return settings

    # Deep copy to avoid mutation issues with SQLAlchemy JSONB
    sidebar_order = copy.deepcopy(settings.sidebar_order)

    # Remove the list from items (recursive)
    new_items, was_removed = _remove_list_from_items(
        sidebar_order.get("items", []),
        list_id,
    )

    if was_removed:
        sidebar_order["items"] = new_items
        settings.sidebar_order = sidebar_order
        flag_modified(settings, "sidebar_order")
        settings.updated_at = func.clock_timestamp()
        await db.flush()
        await db.refresh(settings)

    return settings
