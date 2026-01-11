"""Service layer for content filter operations."""
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.content_filter import ContentFilter
from schemas.content_filter import ContentFilterCreate, ContentFilterUpdate, FilterExpression
from services.sidebar_service import add_filter_to_sidebar, remove_filter_from_sidebar


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
        filter_expression=data.filter_expression.model_dump(),
        default_sort_by=data.default_sort_by,
        default_sort_ascending=data.default_sort_ascending,
    )
    db.add(content_filter)
    await db.flush()
    await db.refresh(content_filter)

    # Add to sidebar_order (appends to end of items)
    await add_filter_to_sidebar(db, user_id, content_filter.id)

    return content_filter


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
    query = select(ContentFilter).where(
        ContentFilter.id == filter_id,
        ContentFilter.user_id == user_id,
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

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(content_filter, field, value)

    # Explicitly update timestamp since TimestampMixin doesn't auto-update
    content_filter.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(content_filter)
    return content_filter


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
