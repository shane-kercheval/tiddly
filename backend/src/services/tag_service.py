"""Service layer for tag operations."""
from uuid import UUID

from sqlalchemy import cast, func, literal, select, type_coerce
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TEXT as PG_TEXT
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.bookmark import Bookmark
from models.content_filter import ContentFilter
from models.filter_group import FilterGroup
from models.note import Note
from models.prompt import Prompt
from models.tag import Tag, bookmark_tags, filter_group_tags, note_tags, prompt_tags
from schemas.tag import TagCount
from schemas.validators import validate_and_normalize_tags


class TagNotFoundError(Exception):
    """Raised when a tag is not found."""

    def __init__(self, tag_name: str) -> None:
        self.tag_name = tag_name
        super().__init__(f"Tag '{tag_name}' not found")


class TagAlreadyExistsError(Exception):
    """Raised when trying to rename a tag to a name that already exists."""

    def __init__(self, tag_name: str) -> None:
        self.tag_name = tag_name
        super().__init__(f"Tag '{tag_name}' already exists")


class TagInUseByFiltersError(Exception):
    """Raised when trying to delete a tag that is used in filters."""

    def __init__(self, tag_name: str, filters: list[dict[str, str]]) -> None:
        self.tag_name = tag_name
        self.filters = filters  # List of {"id": ..., "name": ...}
        filter_names = [f["name"] for f in filters]
        filters_str = ", ".join(filter_names)
        super().__init__(
            f"Tag '{tag_name}' is used in {len(filters)} filter(s): {filters_str}",
        )


async def get_or_create_tags(
    db: AsyncSession,
    user_id: UUID,
    tag_names: list[str],
) -> list[Tag]:
    """
    Get existing tags or create new ones.

    Args:
        db: Database session.
        user_id: User ID to scope tags.
        tag_names: List of tag names to get or create.

    Returns:
        List of Tag objects (existing or newly created).
    """
    if not tag_names:
        return []

    normalized = validate_and_normalize_tags(tag_names)
    if not normalized:
        return []

    # Fetch existing tags
    result = await db.execute(
        select(Tag).where(
            Tag.user_id == user_id,
            Tag.name.in_(normalized),
        ),
    )
    existing_tags = {tag.name: tag for tag in result.scalars()}

    # Create missing tags
    tags = []
    for name in normalized:
        if name in existing_tags:
            tags.append(existing_tags[name])
        else:
            new_tag = Tag(user_id=user_id, name=name)
            db.add(new_tag)
            tags.append(new_tag)

    await db.flush()
    return tags


async def get_user_tags_with_counts(
    db: AsyncSession,
    user_id: UUID,
    include_inactive: bool = False,
    content_types: list[str] | None = None,
) -> list[TagCount]:
    """
    Get all tags for a user with their usage counts.

    By default, only returns tags with at least one active content item or filter.
    content_count includes active bookmarks, notes, and prompts (not deleted or archived).
    filter_count includes filters using this tag.
    Future-scheduled items (archived_at in future) count as active.

    Args:
        db: Database session.
        user_id: User ID to scope tags.
        include_inactive: If True, include tags with no active content or filters.
            Useful for tag management UI. Defaults to False.
        content_types: If provided, only count items of these types for content_count.
            Valid values: "bookmark", "note", "prompt". None means all types.

    Returns:
        List of TagCount objects sorted by filter_count desc, content_count desc,
        then name asc.
    """
    include_bookmarks = content_types is None or "bookmark" in content_types
    include_notes = content_types is None or "note" in content_types
    include_prompts = content_types is None or "prompt" in content_types

    # Build content_count from included types
    count_parts = []

    if include_bookmarks:
        # Subquery for counting active bookmarks per tag
        bookmark_count_subq = (
            select(func.count(bookmark_tags.c.bookmark_id))
            .select_from(bookmark_tags)
            .join(Bookmark, bookmark_tags.c.bookmark_id == Bookmark.id)
            .where(
                bookmark_tags.c.tag_id == Tag.id,
                Bookmark.deleted_at.is_(None),
                ~Bookmark.is_archived,
            )
            .correlate(Tag)
            .scalar_subquery()
        )
        count_parts.append(func.coalesce(bookmark_count_subq, 0))

    if include_notes:
        # Subquery for counting active notes per tag
        note_count_subq = (
            select(func.count(note_tags.c.note_id))
            .select_from(note_tags)
            .join(Note, note_tags.c.note_id == Note.id)
            .where(
                note_tags.c.tag_id == Tag.id,
                Note.deleted_at.is_(None),
                ~Note.is_archived,
            )
            .correlate(Tag)
            .scalar_subquery()
        )
        count_parts.append(func.coalesce(note_count_subq, 0))

    if include_prompts:
        # Subquery for counting active prompts per tag
        prompt_count_subq = (
            select(func.count(prompt_tags.c.prompt_id))
            .select_from(prompt_tags)
            .join(Prompt, prompt_tags.c.prompt_id == Prompt.id)
            .where(
                prompt_tags.c.tag_id == Tag.id,
                Prompt.deleted_at.is_(None),
                ~Prompt.is_archived,
            )
            .correlate(Tag)
            .scalar_subquery()
        )
        count_parts.append(func.coalesce(prompt_count_subq, 0))

    # Combined count from included types (fallback to 0 if no types included)
    if count_parts:
        content_count_expr = count_parts[0]
        for part in count_parts[1:]:
            content_count_expr = content_count_expr + part
    else:
        content_count_expr = literal(0)
    content_count = content_count_expr.label("content_count")

    # Subquery for counting filters using this tag.
    # When content_types is specified, only count filters whose content_types
    # overlap with the requested types (e.g. prompt context only counts
    # prompt-relevant filters, not bookmark-only filters).
    filter_where = [
        filter_group_tags.c.tag_id == Tag.id,
        ContentFilter.user_id == user_id,
    ]
    if content_types is not None:
        # PostgreSQL JSONB ?| operator: check if JSONB array contains
        # any of the requested content types
        filter_where.append(
            type_coerce(ContentFilter.content_types, JSONB).has_any(
                cast(content_types, ARRAY(PG_TEXT)),
            ),
        )
    filter_count_subq = (
        select(func.count(func.distinct(ContentFilter.id)))
        .select_from(filter_group_tags)
        .join(FilterGroup, filter_group_tags.c.group_id == FilterGroup.id)
        .join(ContentFilter, FilterGroup.filter_id == ContentFilter.id)
        .where(*filter_where)
        .correlate(Tag)
        .scalar_subquery()
    )
    filter_count = func.coalesce(filter_count_subq, 0).label("filter_count")

    query = (
        select(Tag.name, content_count, filter_count)
        .where(Tag.user_id == user_id)
        .group_by(Tag.id, Tag.name)
        .order_by(filter_count.desc(), content_count.desc(), Tag.name.asc())
    )

    if not include_inactive:
        # Include tags with content_count > 0 OR filter_count > 0
        query = query.having((content_count > 0) | (filter_count > 0))

    result = await db.execute(query)
    return [
        TagCount(name=row.name, content_count=row.content_count, filter_count=row.filter_count)
        for row in result
    ]


async def get_tag_by_name(
    db: AsyncSession,
    user_id: UUID,
    tag_name: str,
) -> Tag | None:
    """
    Get a tag by name for a user.

    Args:
        db: Database session.
        user_id: User ID to scope the tag.
        tag_name: Name of the tag to find.

    Returns:
        The Tag if found, None otherwise.
    """
    normalized = tag_name.lower().strip()
    result = await db.execute(
        select(Tag).where(
            Tag.user_id == user_id,
            Tag.name == normalized,
        ),
    )
    return result.scalar_one_or_none()


async def rename_tag(
    db: AsyncSession,
    user_id: UUID,
    old_name: str,
    new_name: str,
) -> Tag:
    """
    Rename a tag.

    Args:
        db: Database session.
        user_id: User ID to scope the tag.
        old_name: Current name of the tag.
        new_name: New name for the tag.

    Returns:
        The updated Tag object.

    Raises:
        TagNotFoundError: If the tag doesn't exist.
        TagAlreadyExistsError: If a tag with the new name already exists.
    """
    # Normalize names
    old_normalized = old_name.lower().strip()
    new_normalized = new_name.lower().strip()

    # Find the existing tag
    tag = await get_tag_by_name(db, user_id, old_normalized)
    if tag is None:
        raise TagNotFoundError(old_normalized)

    # If same name (case-insensitive), no-op
    if old_normalized == new_normalized:
        return tag

    # Check if new name already exists (early check for better error message)
    existing = await get_tag_by_name(db, user_id, new_normalized)
    if existing is not None:
        raise TagAlreadyExistsError(new_normalized)

    # Rename the tag
    tag.name = new_normalized
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        # Handle race condition: another request created the tag between check and flush
        if "uq_tags_user_id_name" in str(e):
            raise TagAlreadyExistsError(new_normalized) from e
        raise
    await db.refresh(tag)
    return tag


async def get_filters_using_tag(
    db: AsyncSession,
    user_id: UUID,
    tag_id: UUID,
) -> list[dict[str, str]]:
    """
    Get filters that use a specific tag.

    Args:
        db: Database session.
        user_id: User ID to scope the filters.
        tag_id: ID of the tag to check.

    Returns:
        List of filter dicts with 'id' and 'name', ordered by name.
    """
    result = await db.execute(
        select(ContentFilter.id, ContentFilter.name)
        .join(FilterGroup, ContentFilter.id == FilterGroup.filter_id)
        .join(filter_group_tags, FilterGroup.id == filter_group_tags.c.group_id)
        .where(
            ContentFilter.user_id == user_id,
            filter_group_tags.c.tag_id == tag_id,
        )
        .distinct()
        .order_by(ContentFilter.name.asc()),
    )
    return [{"id": str(row.id), "name": row.name} for row in result]


async def delete_tag(
    db: AsyncSession,
    user_id: UUID,
    tag_name: str,
) -> None:
    """
    Delete a tag. Junction table entries cascade automatically.

    Args:
        db: Database session.
        user_id: User ID to scope the tag.
        tag_name: Name of the tag to delete.

    Raises:
        TagNotFoundError: If the tag doesn't exist.
        TagInUseByFiltersError: If the tag is used in any filters.
    """
    normalized = tag_name.lower().strip()
    tag = await get_tag_by_name(db, user_id, normalized)
    if tag is None:
        raise TagNotFoundError(normalized)

    # Check if tag is used in any filters
    filters = await get_filters_using_tag(db, user_id, tag.id)
    if filters:
        raise TagInUseByFiltersError(tag.name, filters)

    # Delete the tag. The try/except handles a race condition where another
    # request adds the tag to a filter between our check and the delete.
    # The DB RESTRICT constraint will raise IntegrityError in that case.
    try:
        await db.delete(tag)
        await db.flush()
    except IntegrityError:
        # Rollback the failed transaction before re-querying
        await db.rollback()
        # Re-fetch to get current filter names for the error message
        filters = await get_filters_using_tag(db, user_id, tag.id)
        raise TagInUseByFiltersError(tag.name, filters) from None


async def update_entity_tags(
    db: AsyncSession,
    entity: Bookmark | Note | Prompt,
    tag_names: list[str],
) -> None:
    """
    Update an entity's tags using the junction table.

    Clears existing tags and sets new ones. Works with Bookmarks, Notes, and Prompts.

    Args:
        db: Database session.
        entity: The bookmark, note, or prompt to update.
        tag_names: New list of tag names.
    """
    # Get or create the tag objects
    if tag_names:
        tag_objects = await get_or_create_tags(db, entity.user_id, tag_names)
    else:
        tag_objects = []

    # Update the relationship
    entity.tag_objects = tag_objects
    await db.flush()


# Type-specific aliases for clarity
async def update_bookmark_tags(
    db: AsyncSession,
    bookmark: Bookmark,
    tag_names: list[str],
) -> None:
    """Update a bookmark's tags. Alias for update_entity_tags."""
    await update_entity_tags(db, bookmark, tag_names)


async def update_note_tags(
    db: AsyncSession,
    note: Note,
    tag_names: list[str],
) -> None:
    """Update a note's tags. Alias for update_entity_tags."""
    await update_entity_tags(db, note, tag_names)


async def update_prompt_tags(
    db: AsyncSession,
    prompt: Prompt,
    tag_names: list[str],
) -> None:
    """Update a prompt's tags. Alias for update_entity_tags."""
    await update_entity_tags(db, prompt, tag_names)
