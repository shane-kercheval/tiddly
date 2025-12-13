"""Service layer for bookmark CRUD operations."""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.bookmark import Bookmark
from schemas.bookmark import BookmarkCreate, BookmarkUpdate
from services.url_scraper import extract_content, extract_metadata, fetch_url

logger = logging.getLogger(__name__)


async def create_bookmark(
    db: AsyncSession,
    user_id: int,
    data: BookmarkCreate,
) -> Bookmark:
    """
    Create a new bookmark for a user with automatic URL scraping.

    Flow:
    1. Fetch URL for metadata unless user provided both title AND description
    2. Extract title/description from HTML (user values take precedence)
    3. If user didn't provide content, extract it from HTML
    4. Store content only if store_content=True
    5. Return the created bookmark

    Scraping is best-effort - failures don't block bookmark creation.

    Note: Does not commit. Caller (session generator) handles commit at request end.
    """
    url_str = str(data.url)
    title = data.title
    description = data.description
    content = data.content

    # Determine if we need to fetch for metadata
    needs_metadata = title is None or description is None
    needs_content = content is None

    # Only fetch if we need metadata or content
    if needs_metadata or needs_content:
        fetch_result = await fetch_url(url_str)

        if fetch_result.html is not None:
            # Extract metadata if needed
            if needs_metadata:
                metadata = extract_metadata(fetch_result.html)
                if title is None:
                    title = metadata.title
                if description is None:
                    description = metadata.description

            # Extract content if user didn't provide it
            if needs_content:
                extracted_content = extract_content(fetch_result.html)
                if data.store_content:
                    content = extracted_content
        elif fetch_result.error:
            logger.warning(
                "Failed to fetch URL %s: %s",
                url_str,
                fetch_result.error,
            )

    bookmark = Bookmark(
        user_id=user_id,
        url=url_str,
        title=title,
        description=description,
        content=content,
        tags=data.tags,
    )
    db.add(bookmark)
    await db.flush()
    await db.refresh(bookmark)
    return bookmark


async def get_bookmark(
    db: AsyncSession,
    user_id: int,
    bookmark_id: int,
) -> Bookmark | None:
    """Get a bookmark by ID, scoped to user. Returns None if not found or wrong user."""
    result = await db.execute(
        select(Bookmark).where(
            Bookmark.id == bookmark_id,
            Bookmark.user_id == user_id,
        ),
    )
    return result.scalar_one_or_none()


async def get_bookmarks(
    db: AsyncSession,
    user_id: int,
    offset: int = 0,
    limit: int = 50,
) -> list[Bookmark]:
    """Get all bookmarks for a user with pagination."""
    result = await db.execute(
        select(Bookmark)
        .where(Bookmark.user_id == user_id)
        .order_by(Bookmark.created_at.desc())
        .offset(offset)
        .limit(limit),
    )
    return list(result.scalars().all())


async def update_bookmark(
    db: AsyncSession,
    user_id: int,
    bookmark_id: int,
    data: BookmarkUpdate,
) -> Bookmark | None:
    """
    Update a bookmark. Returns None if not found or wrong user.

    Note: Does not commit. Caller (session generator) handles commit at request end.
    """
    bookmark = await get_bookmark(db, user_id, bookmark_id)
    if bookmark is None:
        return None

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(bookmark, field, value)

    await db.flush()
    await db.refresh(bookmark)
    return bookmark


async def delete_bookmark(
    db: AsyncSession,
    user_id: int,
    bookmark_id: int,
) -> bool:
    """
    Delete a bookmark. Returns True if deleted, False if not found.

    Note: Does not commit. Caller (session generator) handles commit at request end.
    """
    bookmark = await get_bookmark(db, user_id, bookmark_id)
    if bookmark is None:
        return False

    await db.delete(bookmark)
    return True
