"""Service layer for content filter operations."""
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.content_filter import ContentFilter
from models.filter_group import FilterGroup as FilterGroupModel
from schemas.content_filter import (
    ContentFilterCreate,
    ContentFilterUpdate,
    FilterExpression,
    FilterGroup as FilterGroupSchema,
)
from services.sidebar_service import add_filter_to_sidebar, remove_filter_from_sidebar
from services.tag_service import get_or_create_tags


async def _sync_filter_groups(
    db: AsyncSession,
    user_id: UUID,
    content_filter: ContentFilter,
    groups: list[FilterGroupSchema],
) -> None:
    """
    Sync filter groups and their tags. Replaces all existing groups.

    This function deletes all existing groups and creates new ones atomically.
    Must be called within a transaction context (the caller's session transaction).

    Args:
        db: Database session.
        user_id: User ID for tag lookup/creation.
        content_filter: The content filter to update.
        groups: List of FilterGroup schemas (Pydantic, not ORM).

    Note:
        Groups with empty tag lists are skipped, which may result in non-contiguous
        positions. This is handled correctly by ORDER BY position in queries.
    """
    # Delete existing groups (cascade deletes junction entries)
    await db.execute(
        delete(FilterGroupModel).where(FilterGroupModel.filter_id == content_filter.id),
    )

    # Create new groups
    for position, group in enumerate(groups):
        if not group.tags:
            continue

        # Get or create tags
        tag_objects = await get_or_create_tags(db, user_id, group.tags)

        filter_group = FilterGroupModel(
            filter_id=content_filter.id,
            position=position,
            operator=group.operator,
        )
        filter_group.tag_objects = tag_objects
        db.add(filter_group)

    await db.flush()


async def create_filter(
    db: AsyncSession,
    user_id: UUID,
    data: ContentFilterCreate,
) -> ContentFilter:
    """
    Create a new content filter and add it to the user's sidebar_order.

    The new filter is appended to the end of sidebar_order.items.
    """
    content_filter = ContentFilter(
        user_id=user_id,
        name=data.name,
        content_types=data.content_types,
        group_operator=data.filter_expression.group_operator,
        default_sort_by=data.default_sort_by,
        default_sort_ascending=data.default_sort_ascending,
    )
    db.add(content_filter)
    await db.flush()  # Get filter ID

    # Create groups with tags
    await _sync_filter_groups(db, user_id, content_filter, data.filter_expression.groups)

    # Add to sidebar_order (appends to end of items)
    await add_filter_to_sidebar(db, user_id, content_filter.id)

    # Re-fetch with eager loading for response serialization
    result = await get_filter(db, user_id, content_filter.id)
    if result is None:
        raise RuntimeError(f"Failed to retrieve filter {content_filter.id} after creation")
    return result


async def ensure_default_filters(db: AsyncSession, user_id: UUID) -> None:
    """Ensure default content filters exist for a user."""
    default_definitions = [
        {"name": "All Bookmarks", "content_types": ["bookmark"]},
        {"name": "All Notes", "content_types": ["note"]},
        {"name": "All Prompts", "content_types": ["prompt"]},
    ]
    default_names = [definition["name"] for definition in default_definitions]

    existing_query = select(ContentFilter.name).where(
        ContentFilter.user_id == user_id,
        ContentFilter.name.in_(default_names),
    )
    existing_result = await db.execute(existing_query)
    existing_names = set(existing_result.scalars().all())

    for definition in default_definitions:
        if definition["name"] in existing_names:
            continue
        await create_filter(
            db,
            user_id,
            ContentFilterCreate(
                name=definition["name"],
                content_types=definition["content_types"],
                filter_expression=FilterExpression(),
                default_sort_by="last_used_at",
                default_sort_ascending=False,
            ),
        )


async def get_filters(db: AsyncSession, user_id: UUID) -> list[ContentFilter]:
    """Get all content filters for a user, ordered by creation date."""
    query = (
        select(ContentFilter)
        .options(
            selectinload(ContentFilter.groups).selectinload(FilterGroupModel.tag_objects),
        )
        .where(ContentFilter.user_id == user_id)
        .order_by(ContentFilter.created_at)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_filter(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
) -> ContentFilter | None:
    """Get a single content filter by ID, scoped to user."""
    query = (
        select(ContentFilter)
        .options(
            selectinload(ContentFilter.groups).selectinload(FilterGroupModel.tag_objects),
        )
        .where(
            ContentFilter.id == filter_id,
            ContentFilter.user_id == user_id,
        )
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def update_filter(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
    data: ContentFilterUpdate,
) -> ContentFilter | None:
    """Update a content filter. Returns None if not found."""
    content_filter = await get_filter(db, user_id, filter_id)
    if content_filter is None:
        return None

    # Update scalar fields (only if explicitly provided)
    if "name" in data.model_fields_set:
        content_filter.name = data.name
    if "content_types" in data.model_fields_set:
        content_filter.content_types = data.content_types
    if "default_sort_by" in data.model_fields_set:
        content_filter.default_sort_by = data.default_sort_by
    if "default_sort_ascending" in data.model_fields_set:
        content_filter.default_sort_ascending = data.default_sort_ascending

    # Update filter expression (groups + group_operator)
    if "filter_expression" in data.model_fields_set and data.filter_expression is not None:
        content_filter.group_operator = data.filter_expression.group_operator
        await _sync_filter_groups(db, user_id, content_filter, data.filter_expression.groups)

    # Explicitly update timestamp since TimestampMixin doesn't auto-update
    content_filter.updated_at = func.clock_timestamp()

    await db.flush()

    # Expire the object to clear cached relationships before re-fetch
    db.expire(content_filter)

    # Re-fetch with eager loading for response serialization
    return await get_filter(db, user_id, filter_id)


async def delete_filter(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
) -> bool:
    """
    Delete a content filter and remove it from sidebar_order.

    Returns True if deleted, False if not found.
    """
    content_filter = await get_filter(db, user_id, filter_id)
    if content_filter is None:
        return False

    # Remove from sidebar_order
    await remove_filter_from_sidebar(db, user_id, filter_id)

    await db.delete(content_filter)
    await db.flush()
    return True
