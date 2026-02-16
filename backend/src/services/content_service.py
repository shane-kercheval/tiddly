"""Service layer for unified content operations across bookmarks, notes, and prompts."""
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import (
    Row, String, Table, and_, case, cast, exists, func, literal, or_, select, union_all,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from models.bookmark import Bookmark
from models.note import Note
from models.prompt import Prompt
from models.tag import Tag, bookmark_tags, note_tags, prompt_tags
from schemas.validators import validate_and_normalize_tags
from schemas.content import ContentListItem
from services.base_entity_service import CONTENT_PREVIEW_LENGTH
from services.utils import build_tag_filter_from_expression, escape_ilike


# Per-entity search field configuration — single source of truth for ILIKE filter + scoring.
# Weights align with the tsvector trigger weights in the migration
# (c07d5e217ca3_add_search_vector_columns_triggers_gin_.py):
# A = 0.8, B = 0.4, C = 0.1
BOOKMARK_SEARCH_FIELDS: list[tuple[InstrumentedAttribute, float]] = [
    (Bookmark.title, 0.8),        # weight A
    (Bookmark.description, 0.4),  # weight B
    (Bookmark.summary, 0.4),      # weight B
    (Bookmark.content, 0.1),      # weight C
]
# Bookmark.url is ILIKE-only (not in tsvector) — handled separately with weight 0.05

NOTE_SEARCH_FIELDS: list[tuple[InstrumentedAttribute, float]] = [
    (Note.title, 0.8),        # weight A
    (Note.description, 0.4),  # weight B
    (Note.content, 0.1),      # weight C
]

PROMPT_SEARCH_FIELDS: list[tuple[InstrumentedAttribute, float]] = [
    (Prompt.name, 0.8),         # weight A
    (Prompt.title, 0.8),        # weight A
    (Prompt.description, 0.4),  # weight B
    (Prompt.content, 0.1),      # weight C
]


def _build_tag_filter(
    tags: list[str],
    tag_match: Literal["all", "any"],
    user_id: UUID,
    junction_table: Table,
    entity_id_column: InstrumentedAttribute,
) -> list:
    """
    Build tag filter clauses for any entity type.

    Args:
        tags: List of tag names to filter by.
        tag_match: "all" requires all tags, "any" requires any tag.
        user_id: User ID for tag ownership.
        junction_table: The junction table (bookmark_tags or note_tags).
        entity_id_column: The entity ID column (Bookmark.id or Note.id).

    Returns:
        List of SQLAlchemy filter conditions.
    """
    if not tags:
        return []

    # Get the entity ID column name from junction table (e.g., bookmark_id, note_id)
    junction_columns = [c.name for c in junction_table.columns if c.name != "tag_id"]
    junction_entity_col = junction_table.c[junction_columns[0]]

    if tag_match == "all":
        # Must have ALL specified tags
        conditions = []
        for tag_name in tags:
            subq = (
                select(junction_entity_col)
                .join(Tag, junction_table.c.tag_id == Tag.id)
                .where(
                    junction_entity_col == entity_id_column,
                    Tag.name == tag_name,
                    Tag.user_id == user_id,
                )
            )
            conditions.append(exists(subq))
        return conditions

    # Must have ANY of the specified tags
    subq = (
        select(junction_entity_col)
        .join(Tag, junction_table.c.tag_id == Tag.id)
        .where(
            junction_entity_col == entity_id_column,
            Tag.name.in_(tags),
            Tag.user_id == user_id,
        )
    )
    return [exists(subq)]


async def get_tags_for_items(
    db: AsyncSession,
    user_id: UUID,
    bookmark_ids: list[UUID],
    note_ids: list[UUID],
    prompt_ids: list[UUID] | None = None,
) -> dict[tuple[str, UUID], list[str]]:
    """
    Fetch tags for a list of bookmarks, notes, and prompts.

    Returns a dict mapping (type, id) -> list of tag names.
    """
    result: dict[tuple[str, UUID], list[str]] = {}
    prompt_ids = prompt_ids or []

    # Initialize empty lists for all items
    for bid in bookmark_ids:
        result[("bookmark", bid)] = []
    for nid in note_ids:
        result[("note", nid)] = []
    for pid in prompt_ids:
        result[("prompt", pid)] = []

    if bookmark_ids:
        # Fetch bookmark tags
        query = (
            select(bookmark_tags.c.bookmark_id, Tag.name)
            .join(Tag, bookmark_tags.c.tag_id == Tag.id)
            .where(
                bookmark_tags.c.bookmark_id.in_(bookmark_ids),
                Tag.user_id == user_id,
            )
        )
        rows = await db.execute(query)
        for bookmark_id, tag_name in rows:
            result[("bookmark", bookmark_id)].append(tag_name)

    if note_ids:
        # Fetch note tags
        query = (
            select(note_tags.c.note_id, Tag.name)
            .join(Tag, note_tags.c.tag_id == Tag.id)
            .where(
                note_tags.c.note_id.in_(note_ids),
                Tag.user_id == user_id,
            )
        )
        rows = await db.execute(query)
        for note_id, tag_name in rows:
            result[("note", note_id)].append(tag_name)

    if prompt_ids:
        # Fetch prompt tags
        query = (
            select(prompt_tags.c.prompt_id, Tag.name)
            .join(Tag, prompt_tags.c.tag_id == Tag.id)
            .where(
                prompt_tags.c.prompt_id.in_(prompt_ids),
                Tag.user_id == user_id,
            )
        )
        rows = await db.execute(query)
        for prompt_id, tag_name in rows:
            result[("prompt", prompt_id)].append(tag_name)

    return result


def _row_to_content_item(row: Row, tags: list[str]) -> ContentListItem:
    """Convert a database row to a ContentListItem."""
    return ContentListItem(
        type=row.type,
        id=row.id,
        title=row.title,
        description=row.description,
        tags=tags,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_used_at=row.last_used_at,
        deleted_at=row.deleted_at,
        archived_at=row.archived_at,
        content_length=row.content_length,
        content_preview=row.content_preview,
        summary=row.summary if row.type == "bookmark" else None,
        url=row.url if row.type == "bookmark" else None,
        name=row.name if row.type == "prompt" else None,
        arguments=row.arguments if row.type == "prompt" else None,
    )


async def search_all_content(
    db: AsyncSession,
    user_id: UUID,
    query: str | None = None,
    tags: list[str] | None = None,
    tag_match: Literal["all", "any"] = "all",
    sort_by: Literal[
        "created_at", "updated_at", "last_used_at", "title",
        "archived_at", "deleted_at", "relevance",
    ] = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: int = 50,
    view: Literal["active", "archived", "deleted"] = "active",
    filter_expression: dict[str, Any] | None = None,
    content_types: list[str] | None = None,
) -> tuple[list[ContentListItem], int]:
    """
    Search all content (bookmarks, notes, and prompts) with unified pagination.

    Args:
        db: Database session.
        user_id: User ID to scope content.
        query: Text search across title, description, content. Uses combined FTS
            (stemming, ranked) and ILIKE (substring matching) in a single query.
        tags: Filter by tags (normalized to lowercase).
        tag_match: "all" (AND - must have all tags) or "any" (OR - has any tag).
        sort_by: Field to sort by. "relevance" sorts by combined FTS + ILIKE score
            (falls back to created_at when no query present).
        sort_order: Sort direction.
        offset: Pagination offset.
        limit: Pagination limit.
        view:
            Which content to show:
            - "active": Not deleted and not archived (default).
            - "archived": Archived but not deleted.
            - "deleted": Soft-deleted (includes deleted+archived).
        filter_expression: Optional filter expression from a content list.
        content_types: Optional list of content types to include ("bookmark", "note", "prompt").
            If None, includes all. Used by content lists to filter entity types.

    Returns:
        Tuple of (list of ContentListItems, total count).
    """
    # Normalize tags if provided
    normalized_tags = validate_and_normalize_tags(tags) if tags else None

    # Determine which content types to include
    include_bookmarks = content_types is None or "bookmark" in content_types
    include_notes = content_types is None or "note" in content_types
    include_prompts = content_types is None or "prompt" in content_types

    # If no content types to include, return empty
    if not include_bookmarks and not include_notes and not include_prompts:
        return [], 0

    # Empty tsquery guard: stop-word-only queries (e.g. "the", "and or") produce
    # an empty tsquery. Without this guard the ILIKE side of the OR would match
    # everything. Return zero results immediately for these queries.
    tsquery_is_non_empty = False
    search_pattern: str | None = None
    if query:
        tsquery_text = await db.scalar(select(func.cast(
            func.websearch_to_tsquery('english', query), String,
        )))
        tsquery_is_non_empty = bool(tsquery_text and tsquery_text.strip())
        if not tsquery_is_non_empty:
            return [], 0
        escaped_query = escape_ilike(query)
        search_pattern = f"%{escaped_query}%"

    # Resolve relevance sort: fall back to created_at when no query
    effective_sort_by = sort_by
    if sort_by == "relevance" and not query:
        effective_sort_by = "created_at"

    # Pre-compute tsquery expression for reuse across subqueries
    tsquery = func.websearch_to_tsquery('english', query) if query else None

    # Common search params for entity subquery builder
    search_ctx = {
        'view': view, 'query': query, 'search_pattern': search_pattern,
        'tsquery': tsquery, 'normalized_tags': normalized_tags,
        'tag_match': tag_match, 'user_id': user_id,
        'filter_expression': filter_expression,
    }

    subqueries: list[Any] = []
    count_subqueries: list[Any] = []

    if include_bookmarks:
        main, count = _build_entity_subquery(
            "bookmark", Bookmark, bookmark_tags,
            BOOKMARK_SEARCH_FIELDS, Bookmark.search_vector, Bookmark.url,
            entity_columns=[
                Bookmark.summary.label("summary"),
                Bookmark.url.label("url"),
                literal(None).label("name"),
                cast(literal(None), JSONB).label("arguments"),
            ],
            sort_title_expr=func.lower(
                func.coalesce(func.nullif(Bookmark.title, ''), Bookmark.url),
            ).label("sort_title"),
            **search_ctx,
        )
        subqueries.append(main)
        count_subqueries.append(count)

    if include_notes:
        main, count = _build_entity_subquery(
            "note", Note, note_tags,
            NOTE_SEARCH_FIELDS, Note.search_vector, None,
            entity_columns=[
                literal(None).label("summary"),
                literal(None).label("url"),
                literal(None).label("name"),
                cast(literal(None), JSONB).label("arguments"),
            ],
            sort_title_expr=func.lower(Note.title).label("sort_title"),
            **search_ctx,
        )
        subqueries.append(main)
        count_subqueries.append(count)

    if include_prompts:
        main, count = _build_entity_subquery(
            "prompt", Prompt, prompt_tags,
            PROMPT_SEARCH_FIELDS, Prompt.search_vector, None,
            entity_columns=[
                literal(None).label("summary"),
                literal(None).label("url"),
                Prompt.name.label("name"),
                Prompt.arguments.label("arguments"),
            ],
            sort_title_expr=func.lower(
                func.coalesce(func.nullif(Prompt.title, ''), Prompt.name),
            ).label("sort_title"),
            **search_ctx,
        )
        subqueries.append(main)
        count_subqueries.append(count)

    # Combine subqueries and get total count
    combined = _union_or_single(subqueries)
    count_combined = _union_or_single(count_subqueries)
    count_result = await db.execute(select(func.count()).select_from(count_combined))
    total = count_result.scalar() or 0

    # Build final query with sorting, tiebreakers, and pagination
    final_query = _build_sorted_query(
        combined, effective_sort_by, sort_order,
        is_single_type=len(subqueries) == 1,
        offset=offset, limit=limit,
    )

    result = await db.execute(final_query)
    rows = result.all()

    # Collect IDs for tag fetching
    bookmark_ids = [row.id for row in rows if row.type == "bookmark"]
    note_ids = [row.id for row in rows if row.type == "note"]
    prompt_ids = [row.id for row in rows if row.type == "prompt"]

    # Fetch tags for all items
    tags_map = await get_tags_for_items(db, user_id, bookmark_ids, note_ids, prompt_ids)

    # Convert rows to ContentListItems
    items = [
        _row_to_content_item(row, tags_map[(row.type, row.id)])
        for row in rows
    ]

    return items, total


def _build_search_rank(
    query: str | None,
    search_pattern: str | None,
    tsquery: Any | None,
    search_fields: list[tuple[InstrumentedAttribute, float]],
    search_vector_column: InstrumentedAttribute,
    url_column: InstrumentedAttribute | None = None,
) -> Any:
    """
    Build a combined FTS + ILIKE relevance score column.

    When a query is present, the score is ts_rank (FTS) + a synthetic ILIKE
    score based on which field matched (title > description > content). Items
    matching both FTS and ILIKE rank highest.

    Args:
        query: The search query string.
        search_pattern: The escaped ILIKE pattern (e.g., "%auth%").
        tsquery: The SQLAlchemy tsquery expression.
        search_fields: (field, weight) tuples for ILIKE scoring.
        search_vector_column: The tsvector column for ts_rank.
        url_column: Optional URL column for bookmark URL matching (weight 0.05).

    Returns:
        A labeled SQLAlchemy column expression for "search_rank".
    """
    if not query or tsquery is None or search_pattern is None:
        return literal(0).label("search_rank")

    # FTS score: COALESCE guards against NULL search_vector
    fts_score = func.coalesce(func.ts_rank(search_vector_column, tsquery), 0)

    # ILIKE score: short-circuit CASE assigns score of highest-priority matching field
    ilike_cases = [(field.ilike(search_pattern), weight) for field, weight in search_fields]
    if url_column is not None:
        ilike_cases.append((url_column.ilike(search_pattern), 0.05))
    ilike_score = case(*ilike_cases, else_=0)

    return (fts_score + ilike_score).label("search_rank")


def _build_entity_subquery(
    type_label: str,
    model: type,
    junction_table: Table,
    search_fields: list[tuple[InstrumentedAttribute, float]],
    search_vector_column: InstrumentedAttribute,
    url_column: InstrumentedAttribute | None,
    entity_columns: list[Any],
    sort_title_expr: Any,
    *,
    view: Literal["active", "archived", "deleted"],
    query: str | None,
    search_pattern: str | None,
    tsquery: Any | None,
    normalized_tags: list[str] | None,
    tag_match: Literal["all", "any"],
    user_id: UUID,
    filter_expression: dict[str, Any] | None,
) -> tuple[Any, Any]:
    """
    Build main and count subqueries for one entity type.

    Returns:
        Tuple of (main subquery with all columns, count-only subquery).
    """
    filters = _apply_entity_filters(
        filters=[model.user_id == user_id],
        model=model,
        junction_table=junction_table,
        search_fields=search_fields,
        search_vector_column=search_vector_column,
        url_column=url_column,
        view=view,
        query=query,
        search_pattern=search_pattern,
        tsquery=tsquery,
        normalized_tags=normalized_tags,
        tag_match=tag_match,
        user_id=user_id,
        filter_expression=filter_expression,
    )
    rank_col = _build_search_rank(
        query=query,
        search_pattern=search_pattern,
        tsquery=tsquery,
        search_fields=search_fields,
        search_vector_column=search_vector_column,
        url_column=url_column,
    )
    common_columns = [
        literal(type_label).label("type"),
        model.id.label("id"),
        model.title.label("title"),
        model.description.label("description"),
        model.created_at.label("created_at"),
        model.updated_at.label("updated_at"),
        model.last_used_at.label("last_used_at"),
        model.deleted_at.label("deleted_at"),
        model.archived_at.label("archived_at"),
        func.length(model.content).label("content_length"),
        func.left(model.content, CONTENT_PREVIEW_LENGTH).label("content_preview"),
    ]
    main_subq = (
        select(*common_columns, *entity_columns, sort_title_expr, rank_col)
        .where(and_(*filters))
    )
    count_subq = select(model.id).where(and_(*filters))
    return main_subq, count_subq


def _union_or_single(subqueries: list[Any]) -> Any:
    """Combine subqueries via UNION ALL, or return single subquery directly."""
    if len(subqueries) == 1:
        return subqueries[0].subquery()
    return union_all(*subqueries).subquery()


def _build_sorted_query(
    combined: Any,
    sort_by: str,
    sort_order: Literal["asc", "desc"],
    *,
    is_single_type: bool,
    offset: int,
    limit: int,
) -> Any:
    """Build final SELECT with sorting, tiebreakers, and pagination."""
    sort_column = _resolve_sort_column(combined, sort_by, sort_order)

    # Tiebreakers: multi-type includes type for deterministic grouping (direction
    # doesn't matter — it's just for stability); single-type omits it.
    created_at_tiebreak = (
        combined.c.created_at.desc() if sort_order == "desc"
        else combined.c.created_at.asc()
    )
    id_tiebreak = (
        combined.c.id.desc() if sort_order == "desc" else combined.c.id.asc()
    )
    tiebreakers = (
        [created_at_tiebreak, id_tiebreak] if is_single_type
        else [combined.c.type, created_at_tiebreak, id_tiebreak]
    )

    return (
        select(combined)
        .order_by(sort_column, *tiebreakers)
        .offset(offset)
        .limit(limit)
    )


def _resolve_sort_column(
    combined: Any,
    sort_by: str,
    sort_order: Literal["asc", "desc"],
) -> Any:
    """Resolve sort_by string to a SQLAlchemy order clause."""
    if sort_by == "relevance":
        return combined.c.search_rank.desc()
    col = combined.c.sort_title if sort_by == "title" else getattr(combined.c, sort_by)
    return col.desc() if sort_order == "desc" else col.asc()


def _apply_entity_filters(
    filters: list,
    model: type,
    junction_table: Table,
    search_fields: list[tuple[InstrumentedAttribute, float]],
    search_vector_column: InstrumentedAttribute,
    url_column: InstrumentedAttribute | None,
    view: Literal["active", "archived", "deleted"],
    query: str | None,
    search_pattern: str | None,
    tsquery: Any | None,
    normalized_tags: list[str] | None,
    tag_match: Literal["all", "any"],
    user_id: UUID,
    filter_expression: dict[str, Any] | None,
) -> list:
    """
    Apply view, search, tag, and filter expression filters for any entity type.

    Uses combined FTS + ILIKE: items matching either FTS (stemmed, ranked) or
    ILIKE (substring) are included. The empty tsquery guard is handled by the
    caller (search_all_content returns early for stop-word-only queries).

    Args:
        filters: Base filter list to extend.
        model: The SQLAlchemy model class (Bookmark, Note, or Prompt).
        junction_table: The tag junction table.
        search_fields: (field, weight) tuples for ILIKE filter (from *_SEARCH_FIELDS config).
        search_vector_column: The tsvector column for FTS matching.
        url_column: Optional URL column for bookmark URL ILIKE matching.
        view: Which entities to show (active/archived/deleted).
        query: Text search query.
        search_pattern: The escaped ILIKE pattern (e.g., "%auth%").
        tsquery: The SQLAlchemy tsquery expression.
        normalized_tags: List of normalized tag names to filter by.
        tag_match: Tag matching mode ("all" or "any").
        user_id: User ID for scoping.
        filter_expression: Optional filter expression from content list.

    Returns:
        Extended filter list.
    """
    # View filter
    if view == "active":
        filters.extend([model.deleted_at.is_(None), ~model.is_archived])
    elif view == "archived":
        filters.extend([model.deleted_at.is_(None), model.is_archived])
    elif view == "deleted":
        filters.append(model.deleted_at.is_not(None))

    # Combined FTS + ILIKE text search filter
    if query and tsquery is not None and search_pattern is not None:
        # FTS match on search_vector
        fts_filter = search_vector_column.op('@@')(tsquery)

        # ILIKE match on text fields
        # ILIKE uses the raw query intentionally — websearch operators (-, "...", OR)
        # become inert literal characters that rarely match via ILIKE. FTS handles
        # structured query syntax correctly. Do not strip operators from the ILIKE pattern.
        ilike_conditions = [field.ilike(search_pattern) for field, _ in search_fields]
        if url_column is not None:
            ilike_conditions.append(url_column.ilike(search_pattern))
        ilike_filter = or_(*ilike_conditions)

        # Combined: match if either FTS or ILIKE hits
        filters.append(or_(fts_filter, ilike_filter))

    # Tag filter from query params
    if normalized_tags:
        tag_filters = _build_tag_filter(
            normalized_tags, tag_match, user_id, junction_table, model.id,
        )
        filters.extend(tag_filters)

    # Filter expression from content list
    if filter_expression:
        expr_filters = build_tag_filter_from_expression(
            filter_expression, user_id, junction_table, model.id,
        )
        filters.extend(expr_filters)

    return filters
