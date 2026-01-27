"""Service layer for MCP context endpoints."""
from collections.abc import Callable, Coroutine
from datetime import datetime, UTC
from typing import Any
from uuid import UUID

from sqlalchemy import func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.bookmark import Bookmark
from models.content_filter import ContentFilter
from models.note import Note
from models.prompt import Prompt
from schemas.content_filter import FilterExpression
from schemas.mcp_context import (
    ContentContextCounts,
    ContentContextFilter,
    ContentContextResponse,
    ContextItem,
    ContextPrompt,
    ContextTag,
    EntityCounts,
    PromptContextFilter,
    PromptContextResponse,
    SidebarCollectionContext,
    SidebarCollectionFilter,
)
from schemas.prompt import PromptArgument
from services.base_entity_service import CONTENT_PREVIEW_LENGTH
from services.content_filter_service import get_filters
from services.content_service import _get_tags_for_items, search_all_content
from services.sidebar_service import get_computed_sidebar
from services.tag_service import get_user_tags_with_counts


async def get_content_context(
    session_factory: async_sessionmaker,
    user_id: UUID,
    tag_limit: int = 50,
    recent_limit: int = 10,
    filter_limit: int = 5,
    filter_item_limit: int = 5,
) -> ContentContextResponse:
    """Build the content context response for bookmarks and notes."""
    content_types = ["bookmark", "note"]

    async def _query(fn: Callable[..., Coroutine], *args: Any) -> Any:
        async with session_factory() as db:
            return await fn(db, *args)

    # Phase 1: fetch counts, tags, filters, and recent items
    counts = await _query(_get_content_counts, user_id)
    tags = await _query(get_user_tags_with_counts, user_id, False, content_types)
    filters_and_sidebar = await _query(_get_filters_in_sidebar_order, user_id, content_types)
    recent_items = await _query(_get_recent_content_items, user_id, recent_limit)

    # Apply tag limit
    top_tags = [
        ContextTag(name=t.name, content_count=t.content_count, filter_count=t.filter_count)
        for t in tags[:tag_limit]
    ]

    # Unpack filters and sidebar collections
    ordered_filters, sidebar_collections = filters_and_sidebar
    ordered_filters = ordered_filters[:filter_limit]

    # Phase 2: fetch top items per filter
    filter_items_list = [
        await _query(
            _get_filter_items_content,
            user_id,
            f,
            content_types,
            filter_item_limit,
        )
        for f in ordered_filters
    ]

    # Build filter responses
    context_filters = []
    for f, items in zip(ordered_filters, filter_items_list):
        context_filters.append(ContentContextFilter(
            id=f.id,
            name=f.name,
            content_types=f.content_types,
            filter_expression=FilterExpression(**f.filter_expression),
            items=items,
        ))

    recently_used, recently_created, recently_modified = recent_items

    return ContentContextResponse(
        generated_at=datetime.now(UTC),
        counts=counts,
        top_tags=top_tags,
        filters=context_filters,
        sidebar_collections=sidebar_collections,
        recently_used=recently_used,
        recently_created=recently_created,
        recently_modified=recently_modified,
    )


async def get_prompt_context(
    session_factory: async_sessionmaker,
    user_id: UUID,
    tag_limit: int = 50,
    recent_limit: int = 10,
    filter_limit: int = 5,
    filter_item_limit: int = 5,
) -> PromptContextResponse:
    """Build the prompt context response."""
    content_types = ["prompt"]

    async def _query(fn: Callable[..., Coroutine], *args: Any) -> Any:
        async with session_factory() as db:
            return await fn(db, *args)

    # Phase 1: fetch counts, tags, filters, and recent items
    counts = await _query(_get_prompt_counts, user_id)
    tags = await _query(get_user_tags_with_counts, user_id, False, content_types)
    filters_and_sidebar = await _query(_get_filters_in_sidebar_order, user_id, content_types)
    recent_items = await _query(_get_recent_prompt_items, user_id, recent_limit)

    top_tags = [
        ContextTag(name=t.name, content_count=t.content_count, filter_count=t.filter_count)
        for t in tags[:tag_limit]
    ]

    ordered_filters, sidebar_collections = filters_and_sidebar
    ordered_filters = ordered_filters[:filter_limit]

    # Phase 2: fetch top items per filter
    filter_items_list = [
        await _query(
            _get_filter_items_prompts,
            user_id,
            f,
            filter_item_limit,
        )
        for f in ordered_filters
    ]

    context_filters = []
    for f, items in zip(ordered_filters, filter_items_list):
        context_filters.append(PromptContextFilter(
            id=f.id,
            name=f.name,
            content_types=f.content_types,
            filter_expression=FilterExpression(**f.filter_expression),
            items=items,
        ))

    recently_used, recently_created, recently_modified = recent_items

    return PromptContextResponse(
        generated_at=datetime.now(UTC),
        counts=counts,
        top_tags=top_tags,
        filters=context_filters,
        sidebar_collections=sidebar_collections,
        recently_used=recently_used,
        recently_created=recently_created,
        recently_modified=recently_modified,
    )


# =============================================================================
# Internal helpers
# =============================================================================


async def _get_content_counts(
    db: AsyncSession,
    user_id: UUID,
) -> ContentContextCounts:
    """Get bookmark and note counts grouped by status."""
    bookmark_active = await _count_entities(db, Bookmark, user_id, active=True)
    bookmark_archived = await _count_entities(db, Bookmark, user_id, active=False)
    note_active = await _count_entities(db, Note, user_id, active=True)
    note_archived = await _count_entities(db, Note, user_id, active=False)

    return ContentContextCounts(
        bookmarks=EntityCounts(active=bookmark_active, archived=bookmark_archived),
        notes=EntityCounts(active=note_active, archived=note_archived),
    )


async def _get_prompt_counts(
    db: AsyncSession,
    user_id: UUID,
) -> EntityCounts:
    """Get prompt counts grouped by status."""
    active = await _count_entities(db, Prompt, user_id, active=True)
    archived = await _count_entities(db, Prompt, user_id, active=False)
    return EntityCounts(active=active, archived=archived)


async def _count_entities(
    db: AsyncSession,
    model: type,
    user_id: UUID,
    active: bool,
) -> int:
    """Count active or archived entities (excludes deleted)."""
    query = (
        select(func.count())
        .select_from(model)
        .where(
            model.user_id == user_id,
            model.deleted_at.is_(None),
        )
    )
    query = query.where(~model.is_archived) if active else query.where(model.is_archived)

    result = await db.execute(query)
    return result.scalar() or 0


async def _get_filters_in_sidebar_order(
    db: AsyncSession,
    user_id: UUID,
    endpoint_content_types: list[str],
) -> tuple[list[ContentFilter], list[SidebarCollectionContext]]:
    """
    Get filters in sidebar order, excluding builtins and filters without tag rules.

    Returns:
        Tuple of (ordered filters, sidebar collections containing tag-based filters).
    """
    all_filters = await get_filters(db, user_id)
    sidebar = await get_computed_sidebar(db, user_id, all_filters)

    # Build filter map for lookup
    filter_map = {f.id: f for f in all_filters}

    # Walk sidebar to extract ordered filter IDs and collections
    ordered_filter_ids: list[UUID] = []
    collections: list[SidebarCollectionContext] = []

    for item in sidebar.items:
        if item.type == "filter":
            filt = filter_map.get(item.id)
            if filt and _is_relevant_filter(filt, endpoint_content_types):
                ordered_filter_ids.append(item.id)
        elif item.type == "collection":
            # Collect tag-based filters in this collection
            collection_filters = []
            for child in item.items:
                if child.type == "filter":
                    filt = filter_map.get(child.id)
                    if filt and _is_relevant_filter(filt, endpoint_content_types):
                        if child.id not in ordered_filter_ids:
                            ordered_filter_ids.append(child.id)
                        collection_filters.append(
                            SidebarCollectionFilter(id=child.id, name=child.name),
                        )
            if collection_filters:
                collections.append(SidebarCollectionContext(
                    name=item.name,
                    filters=collection_filters,
                ))

    # Build ordered filter list
    ordered_filters = [filter_map[fid] for fid in ordered_filter_ids if fid in filter_map]

    return ordered_filters, collections


def _is_relevant_filter(
    content_filter: ContentFilter,
    endpoint_content_types: list[str],
) -> bool:
    """
    Check if a filter is relevant for the context endpoint.

    Excludes filters with no tag-based rules (empty filter expression)
    and filters whose content_types don't overlap with the endpoint's types.
    """
    # Exclude filters without tag rules (e.g. "All Notes" which is just a content_type shortcut)
    expr = content_filter.filter_expression
    groups = expr.get("groups", [])
    has_tag_rules = any(g.get("tags", []) for g in groups)
    if not has_tag_rules:
        return False

    # Check content type overlap
    return any(ct in endpoint_content_types for ct in content_filter.content_types)


async def _get_filter_items_content(
    db: AsyncSession,
    user_id: UUID,
    content_filter: ContentFilter,
    endpoint_content_types: list[str],
    limit: int,
) -> list[ContextItem]:
    """Get top items for a filter, scoped to the endpoint's content types."""
    # Intersect filter's content_types with endpoint's allowed types
    effective_types = [ct for ct in endpoint_content_types if ct in content_filter.content_types]
    if not effective_types:
        return []

    items, _total = await search_all_content(
        db=db,
        user_id=user_id,
        filter_expression=content_filter.filter_expression,
        content_types=effective_types,
        sort_by=content_filter.default_sort_by or "created_at",
        sort_order="asc" if content_filter.default_sort_ascending else "desc",
        limit=limit,
    )

    return [
        ContextItem(
            type=item.type,
            id=item.id,
            title=item.title,
            description=item.description,
            content_preview=item.content_preview,
            tags=item.tags,
            last_used_at=item.last_used_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


async def _get_filter_items_prompts(
    db: AsyncSession,
    user_id: UUID,
    content_filter: ContentFilter,
    limit: int,
) -> list[ContextPrompt]:
    """Get top prompt items for a filter."""
    effective_types = [ct for ct in ["prompt"] if ct in content_filter.content_types]
    if not effective_types:
        return []

    items, _total = await search_all_content(
        db=db,
        user_id=user_id,
        filter_expression=content_filter.filter_expression,
        content_types=effective_types,
        sort_by=content_filter.default_sort_by or "created_at",
        sort_order="asc" if content_filter.default_sort_ascending else "desc",
        limit=limit,
    )

    return [
        ContextPrompt(
            id=item.id,
            name=item.name or "",
            title=item.title,
            description=item.description,
            content_preview=item.content_preview,
            arguments=[
                PromptArgument(**arg) for arg in (item.arguments or [])
            ],
            tags=item.tags,
            last_used_at=item.last_used_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


async def _get_recent_content_items(
    db: AsyncSession,
    user_id: UUID,
    limit: int,
) -> tuple[list[ContextItem], list[ContextItem], list[ContextItem]]:
    """
    Get recently used, created, and modified content items using a UNION ALL query.

    Returns three lists: (recently_used, recently_created, recently_modified).
    """
    def _build_subquery(model, type_label, sort_col, bucket_label):  # noqa: ANN001, ANN202
        query = (
            select(
                literal(bucket_label).label("bucket"),
                literal(type_label).label("type"),
                model.id.label("id"),
                model.title.label("title"),
                model.description.label("description"),
                func.left(model.content, CONTENT_PREVIEW_LENGTH).label("content_preview"),
                model.last_used_at.label("last_used_at"),
                model.created_at.label("created_at"),
                model.updated_at.label("updated_at"),
            )
            .where(
                model.user_id == user_id,
                model.deleted_at.is_(None),
                ~model.is_archived,
            )
        )
        if bucket_label == "recently_used":
            query = query.order_by(sort_col.desc().nullslast())
        else:
            query = query.order_by(sort_col.desc())
        return query.limit(limit)

    subqueries = []
    for bucket, sort_field in [
        ("recently_used", "last_used_at"),
        ("recently_created", "created_at"),
        ("recently_modified", "updated_at"),
    ]:
        for model, type_label in [
            (Bookmark, "bookmark"),
            (Note, "note"),
        ]:
            sort_col = getattr(model, sort_field)
            subqueries.append(_build_subquery(model, type_label, sort_col, bucket))

    combined = union_all(*subqueries).subquery()
    result = await db.execute(select(combined))
    rows = result.all()

    # Collect all IDs for batch tag fetching
    bookmark_ids = list({r.id for r in rows if r.type == "bookmark"})
    note_ids = list({r.id for r in rows if r.type == "note"})
    tags_map = await _get_tags_for_items(db, user_id, bookmark_ids, note_ids)

    # Split by bucket
    buckets: dict[str, list[ContextItem]] = {
        "recently_used": [],
        "recently_created": [],
        "recently_modified": [],
    }

    for row in rows:
        item = ContextItem(
            type=row.type,
            id=row.id,
            title=row.title,
            description=row.description,
            content_preview=row.content_preview,
            tags=tags_map.get((row.type, row.id), []),
            last_used_at=row.last_used_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        buckets[row.bucket].append(item)

    # Sort each bucket (UNION ALL doesn't preserve inner ORDER BY)
    buckets["recently_used"].sort(
        key=lambda x: (x.last_used_at is None, x.last_used_at),
        reverse=True,
    )
    # Fix: for recently_used, None should sort last (not first)
    buckets["recently_used"].sort(
        key=lambda x: x.last_used_at or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    buckets["recently_created"].sort(key=lambda x: x.created_at, reverse=True)
    buckets["recently_modified"].sort(key=lambda x: x.updated_at, reverse=True)

    # Trim to limit (UNION gives limit per type per bucket, so total may exceed limit)
    return (
        buckets["recently_used"][:limit],
        buckets["recently_created"][:limit],
        buckets["recently_modified"][:limit],
    )


async def _get_recent_prompt_items(
    db: AsyncSession,
    user_id: UUID,
    limit: int,
) -> tuple[list[ContextPrompt], list[ContextPrompt], list[ContextPrompt]]:
    """Get recently used, created, and modified prompts using a UNION ALL query."""
    subqueries = []
    for bucket, sort_field in [
        ("recently_used", "last_used_at"),
        ("recently_created", "created_at"),
        ("recently_modified", "updated_at"),
    ]:
        sort_col = getattr(Prompt, sort_field)
        query = (
            select(
                literal(bucket).label("bucket"),
                Prompt.id.label("id"),
                Prompt.name.label("name"),
                Prompt.title.label("title"),
                Prompt.description.label("description"),
                func.left(Prompt.content, CONTENT_PREVIEW_LENGTH).label("content_preview"),
                Prompt.arguments.label("arguments"),
                Prompt.last_used_at.label("last_used_at"),
                Prompt.created_at.label("created_at"),
                Prompt.updated_at.label("updated_at"),
            )
            .where(
                Prompt.user_id == user_id,
                Prompt.deleted_at.is_(None),
                ~Prompt.is_archived,
            )
        )
        if bucket == "recently_used":
            query = query.order_by(sort_col.desc().nullslast())
        else:
            query = query.order_by(sort_col.desc())
        subqueries.append(query.limit(limit))

    combined = union_all(*subqueries).subquery()
    result = await db.execute(select(combined))
    rows = result.all()

    # Batch fetch tags for all prompt IDs
    prompt_ids = list({r.id for r in rows})
    tags_map = await _get_tags_for_items(db, user_id, [], [], prompt_ids)

    buckets: dict[str, list[ContextPrompt]] = {
        "recently_used": [],
        "recently_created": [],
        "recently_modified": [],
    }

    for row in rows:
        item = ContextPrompt(
            id=row.id,
            name=row.name,
            title=row.title,
            description=row.description,
            content_preview=row.content_preview,
            arguments=[PromptArgument(**arg) for arg in (row.arguments or [])],
            tags=tags_map.get(("prompt", row.id), []),
            last_used_at=row.last_used_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        buckets[row.bucket].append(item)

    # Sort each bucket
    buckets["recently_used"].sort(
        key=lambda x: x.last_used_at or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    buckets["recently_created"].sort(key=lambda x: x.created_at, reverse=True)
    buckets["recently_modified"].sort(key=lambda x: x.updated_at, reverse=True)

    return (
        buckets["recently_used"][:limit],
        buckets["recently_created"][:limit],
        buckets["recently_modified"][:limit],
    )
