"""Service layer for sidebar operations."""
import copy
import logging
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from models.content_filter import ContentFilter
from models.user_settings import UserSettings
from schemas.sidebar import (
    BUILTIN_DISPLAY_NAMES,
    SIDEBAR_VERSION,
    BuiltinKey,
    SidebarBuiltinItem,
    SidebarBuiltinItemComputed,
    SidebarCollection,
    SidebarCollectionComputed,
    SidebarFilterItem,
    SidebarFilterItemComputed,
    SidebarItem,
    SidebarOrder,
    SidebarOrderComputed,
)
from services.exceptions import (
    SidebarDuplicateItemError,
    SidebarFilterNotFoundError,
    SidebarNestedCollectionError,
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


def _extract_filter_ids_from_items(items: list[dict]) -> set[UUID]:
    """Extract all filter IDs from a list of sidebar items (recursive for collections)."""
    filter_ids: set[UUID] = set()
    for item in items:
        if item.get("type") == "filter":
            # IDs are stored as strings in JSON, convert to UUID
            item_id = item["id"]
            filter_ids.add(UUID(item_id) if isinstance(item_id, str) else item_id)
        elif item.get("type") == "collection":
            filter_ids.update(_extract_filter_ids_from_items(item.get("items", [])))
    return filter_ids


def _extract_builtin_keys_from_items(items: list[dict]) -> set[str]:
    """Extract all builtin keys from a list of sidebar items (recursive for collections)."""
    builtin_keys: set[str] = set()
    for item in items:
        if item.get("type") == "builtin":
            builtin_keys.add(item["key"])
        elif item.get("type") == "collection":
            builtin_keys.update(_extract_builtin_keys_from_items(item.get("items", [])))
    return builtin_keys


def _extract_collection_ids_from_items(items: list[dict]) -> set[str]:
    """Extract all collection IDs from a list of sidebar items."""
    collection_ids: set[str] = set()
    for item in items:
        if item.get("type") == "collection":
            collection_ids.add(item["id"])
    return collection_ids


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


def _compute_filter_item(
    filter_id: UUID,
    filter_map: dict[UUID, ContentFilter],
) -> SidebarFilterItemComputed | None:
    """Create a computed filter item, or None if filter doesn't exist."""
    content_filter = filter_map.get(filter_id)
    if content_filter is None:
        return None
    return SidebarFilterItemComputed(
        type="filter",
        id=filter_id,
        name=content_filter.name,
        content_types=content_filter.content_types,
    )


def _compute_items(
    items: list[dict],
    filter_map: dict[UUID, ContentFilter],
    seen_filter_ids: set[UUID],
) -> list[SidebarBuiltinItemComputed | SidebarFilterItemComputed | SidebarCollectionComputed]:
    """
    Compute a list of sidebar items, resolving filter names and filtering orphans.

    Args:
        items: Raw sidebar items from the database.
        filter_map: Map of filter_id -> ContentFilter for this user.
        seen_filter_ids: Set to track which filter IDs we've seen (modified in place).

    Returns:
        List of computed sidebar items with resolved names.
    """
    computed: list[
        SidebarBuiltinItemComputed | SidebarFilterItemComputed | SidebarCollectionComputed
    ] = []

    for item in items:
        item_type = item.get("type")

        if item_type == "builtin":
            key = item.get("key")
            if key in BUILTIN_DISPLAY_NAMES:
                computed.append(_compute_builtin_item(key))

        elif item_type == "filter":
            raw_filter_id = item.get("id")
            if raw_filter_id is not None:
                # Convert string ID from JSON to UUID
                if isinstance(raw_filter_id, str):
                    filter_id = UUID(raw_filter_id)
                else:
                    filter_id = raw_filter_id
                computed_item = _compute_filter_item(filter_id, filter_map)
                if computed_item is not None:
                    computed.append(computed_item)
                    seen_filter_ids.add(filter_id)

        elif item_type == "collection":
            # Validate required collection fields
            collection_id = item.get("id")
            collection_name = item.get("name")
            if not collection_id or not collection_name:
                logger.warning(
                    "Skipping malformed collection in sidebar_order: missing id or name. "
                    "item=%r",
                    item,
                )
                continue

            # Recursively compute collection items
            collection_items = item.get("items", [])
            computed_collection_items = _compute_items(
                collection_items, filter_map, seen_filter_ids,
            )

            # Only include builtin and filter items in collection
            # (filter out any nested collections)
            valid_collection_items: list[
                SidebarFilterItemComputed | SidebarBuiltinItemComputed
            ] = [
                i
                for i in computed_collection_items
                if isinstance(i, SidebarFilterItemComputed | SidebarBuiltinItemComputed)
            ]

            computed.append(
                SidebarCollectionComputed(
                    type="collection",
                    id=collection_id,
                    name=collection_name,
                    items=valid_collection_items,
                ),
            )

    return computed


async def get_computed_sidebar(
    db: AsyncSession,
    user_id: UUID,
    filters: list[ContentFilter],
) -> SidebarOrderComputed:
    """
    Fetch sidebar_order and resolve filter names/content_types.

    Args:
        db: Database session.
        user_id: The user's ID.
        filters: Pre-fetched list of user's ContentFilters.

    Returns:
        Computed sidebar with resolved filter names and content types.

    Processing:
        1. Get raw sidebar_order from UserSettings
        2. Walk the structure, resolving filter IDs to names/content_types
        3. Filter out orphaned references (filters in sidebar but deleted from DB)
        4. Prepend orphaned filters (filters in DB but not in sidebar) to root
        5. Add display names for builtins
    """
    settings = await get_or_create_settings(db, user_id)
    sidebar_order = _ensure_sidebar_order_structure(settings.sidebar_order)

    # Build map of filter_id -> ContentFilter
    filter_map = {f.id: f for f in filters}

    # Track which filters we've seen in the sidebar structure
    seen_filter_ids: set[UUID] = set()

    # Compute items (resolves names, filters deleted filters)
    computed_items = _compute_items(
        sidebar_order.get("items", []),
        filter_map,
        seen_filter_ids,
    )

    # Prepend orphaned filters (in DB but not in sidebar) to root
    orphaned_items: list[SidebarFilterItemComputed] = []
    for filter_id, content_filter in filter_map.items():
        if filter_id not in seen_filter_ids:
            orphaned_items.append(
                SidebarFilterItemComputed(
                    type="filter",
                    id=filter_id,
                    name=content_filter.name,
                    content_types=content_filter.content_types,
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
    user_filter_ids: set[UUID],
) -> None:
    """
    Validate a sidebar order structure.

    Args:
        sidebar_order: The sidebar order to validate.
        user_filter_ids: Set of filter IDs that belong to this user.

    Raises:
        SidebarDuplicateItemError: If a duplicate item is found.
        SidebarFilterNotFoundError: If a filter ID doesn't exist or belong to user.
        SidebarNestedCollectionError: If collections are nested.
    """
    # Extract all items for duplicate checking
    seen_filter_ids: set[UUID] = set()
    seen_builtin_keys: set[str] = set()
    seen_collection_ids: set[str] = set()

    def validate_item(item: SidebarItem, allow_collections: bool = True) -> None:
        """Validate a single item and track for duplicates."""
        if isinstance(item, SidebarBuiltinItem):
            if item.key in seen_builtin_keys:
                raise SidebarDuplicateItemError("builtin", item.key)
            seen_builtin_keys.add(item.key)

        elif isinstance(item, SidebarFilterItem):
            if item.id in seen_filter_ids:
                raise SidebarDuplicateItemError("filter", item.id)
            if item.id not in user_filter_ids:
                raise SidebarFilterNotFoundError(item.id)
            seen_filter_ids.add(item.id)

        elif isinstance(item, SidebarCollection):
            if not allow_collections:
                raise SidebarNestedCollectionError()
            if item.id in seen_collection_ids:
                raise SidebarDuplicateItemError("collection", item.id)
            seen_collection_ids.add(item.id)

            # Validate collection children (no nested collections allowed)
            for child in item.items:
                validate_item(child, allow_collections=False)

    # Validate all top-level items
    for item in sidebar_order.items:
        validate_item(item)


async def update_sidebar_order(
    db: AsyncSession,
    user_id: UUID,
    sidebar_order: SidebarOrder,
    user_filter_ids: set[UUID],
) -> UserSettings:
    """
    Validate and save sidebar structure.

    Args:
        db: Database session.
        user_id: The user's ID.
        sidebar_order: The new sidebar structure.
        user_filter_ids: Set of filter IDs that belong to this user.

    Returns:
        Updated UserSettings.

    Raises:
        SidebarDuplicateItemError: If a duplicate item is found.
        SidebarFilterNotFoundError: If a filter ID doesn't exist or belong to user.
        SidebarNestedCollectionError: If collections are nested.
    """
    # Validate the structure
    _validate_sidebar_order(sidebar_order, user_filter_ids)

    # Get or create settings
    settings = await get_or_create_settings(db, user_id)

    # Save the sidebar order (use mode='json' to serialize UUIDs as strings)
    settings.sidebar_order = sidebar_order.model_dump(mode='json')
    flag_modified(settings, "sidebar_order")
    settings.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(settings)
    return settings


async def add_filter_to_sidebar(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
) -> UserSettings:
    """
    Add a newly created filter to the end of sidebar_order.items.

    Args:
        db: Database session.
        user_id: The user's ID.
        filter_id: The ID of the newly created filter.

    Returns:
        Updated UserSettings.
    """
    settings = await get_or_create_settings(db, user_id)

    # Get or create sidebar order structure (creates a copy)
    sidebar_order = _ensure_sidebar_order_structure(settings.sidebar_order)

    # Check if filter already exists in sidebar
    existing_filter_ids = _extract_filter_ids_from_items(sidebar_order.get("items", []))
    if filter_id in existing_filter_ids:
        # Filter already exists, no change needed
        return settings

    # Append to the end of root items (convert UUID to string for JSON storage)
    sidebar_order["items"].append({"type": "filter", "id": str(filter_id)})

    settings.sidebar_order = sidebar_order
    flag_modified(settings, "sidebar_order")
    settings.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(settings)
    return settings


def _remove_filter_from_items(items: list[dict], filter_id: UUID) -> tuple[list[dict], bool]:
    """
    Remove a filter from items (recursively searches collections).

    Args:
        items: List of sidebar items.
        filter_id: The filter ID to remove.

    Returns:
        Tuple of (new items list, was_removed).
    """
    new_items: list[dict] = []
    was_removed = False

    for item in items:
        if item.get("type") == "filter":
            # Compare with string version since IDs are stored as strings in JSON
            item_id_str = item.get("id")
            if item_id_str == str(filter_id):
                was_removed = True
                continue

        if item.get("type") == "collection":
            # Recursively process collection items
            collection_items, collection_removed = _remove_filter_from_items(
                item.get("items", []),
                filter_id,
            )
            if collection_removed:
                was_removed = True
            new_items.append({**item, "items": collection_items})
        else:
            new_items.append(item)

    return new_items, was_removed


async def remove_filter_from_sidebar(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
) -> UserSettings | None:
    """
    Remove a filter from sidebar_order.

    Searches through items and collection items to find and remove the filter.

    Args:
        db: Database session.
        user_id: The user's ID.
        filter_id: The ID of the filter to remove.

    Returns:
        Updated UserSettings, or None if no settings exist.
    """
    from services.settings_service import get_settings  # noqa: PLC0415

    settings = await get_settings(db, user_id)
    if settings is None or settings.sidebar_order is None:
        return settings

    # Deep copy to avoid mutation issues with SQLAlchemy JSONB
    sidebar_order = copy.deepcopy(settings.sidebar_order)

    # Remove the filter from items (recursive)
    new_items, was_removed = _remove_filter_from_items(
        sidebar_order.get("items", []),
        filter_id,
    )

    if was_removed:
        sidebar_order["items"] = new_items
        settings.sidebar_order = sidebar_order
        flag_modified(settings, "sidebar_order")
        settings.updated_at = func.clock_timestamp()
        await db.flush()
        await db.refresh(settings)

    return settings
