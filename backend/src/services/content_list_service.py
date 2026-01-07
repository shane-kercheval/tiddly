"""Service layer for content list operations."""
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.content_list import ContentList
from schemas.content_list import ContentListCreate, ContentListUpdate, FilterExpression
from services.sidebar_service import add_list_to_sidebar, remove_list_from_sidebar


async def create_list(
    db: AsyncSession,
    user_id: UUID,
    data: ContentListCreate,
) -> ContentList:
    """
    Create a new content list and add it to the user's sidebar_order.

    The new list is appended to the end of sidebar_order.items.
    """
    content_list = ContentList(
        user_id=user_id,
        name=data.name,
        content_types=data.content_types,
        filter_expression=data.filter_expression.model_dump(),
        default_sort_by=data.default_sort_by,
        default_sort_ascending=data.default_sort_ascending,
    )
    db.add(content_list)
    await db.flush()
    await db.refresh(content_list)

    # Add to sidebar_order (appends to end of items)
    await add_list_to_sidebar(db, user_id, content_list.id)

    return content_list


async def ensure_default_lists(db: AsyncSession, user_id: UUID) -> None:
    """Ensure default content lists exist for a user."""
    default_definitions = [
        {"name": "All Bookmarks", "content_types": ["bookmark"]},
        {"name": "All Notes", "content_types": ["note"]},
        {"name": "All Prompts", "content_types": ["prompt"]},
    ]
    default_names = [definition["name"] for definition in default_definitions]

    existing_query = select(ContentList.name).where(
        ContentList.user_id == user_id,
        ContentList.name.in_(default_names),
    )
    existing_result = await db.execute(existing_query)
    existing_names = set(existing_result.scalars().all())

    for definition in default_definitions:
        if definition["name"] in existing_names:
            continue
        await create_list(
            db,
            user_id,
            ContentListCreate(
                name=definition["name"],
                content_types=definition["content_types"],
                filter_expression=FilterExpression(),
                default_sort_by="last_used_at",
                default_sort_ascending=False,
            ),
        )


async def get_lists(db: AsyncSession, user_id: UUID) -> list[ContentList]:
    """Get all content lists for a user, ordered by creation date."""
    query = (
        select(ContentList)
        .where(ContentList.user_id == user_id)
        .order_by(ContentList.created_at)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_list(
    db: AsyncSession,
    user_id: UUID,
    list_id: UUID,
) -> ContentList | None:
    """Get a single content list by ID, scoped to user."""
    query = select(ContentList).where(
        ContentList.id == list_id,
        ContentList.user_id == user_id,
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def update_list(
    db: AsyncSession,
    user_id: UUID,
    list_id: UUID,
    data: ContentListUpdate,
) -> ContentList | None:
    """Update a content list. Returns None if not found."""
    content_list = await get_list(db, user_id, list_id)
    if content_list is None:
        return None

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(content_list, field, value)

    # Explicitly update timestamp since TimestampMixin doesn't auto-update
    content_list.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(content_list)
    return content_list


async def delete_list(
    db: AsyncSession,
    user_id: UUID,
    list_id: UUID,
) -> bool:
    """
    Delete a content list and remove it from sidebar_order.

    Returns True if deleted, False if not found.
    """
    content_list = await get_list(db, user_id, list_id)
    if content_list is None:
        return False

    # Remove from sidebar_order
    await remove_list_from_sidebar(db, user_id, list_id)

    await db.delete(content_list)
    await db.flush()
    return True
