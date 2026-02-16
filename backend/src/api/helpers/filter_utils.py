"""Filter resolution helpers for list endpoints."""
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from services import content_filter_service


@dataclass
class ResolvedFilter:
    """Result of resolving a filter_id with sort parameters."""

    filter_expression: dict | None
    sort_by: str
    sort_order: Literal["asc", "desc"]
    content_types: list[str] | None  # Only used by content router


async def resolve_filter_and_sorting(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID | None,
    sort_by: str | None,
    sort_order: Literal["asc", "desc"] | None,
    query: str | None = None,
) -> ResolvedFilter:
    """
    Resolve filter expression and sorting parameters.

    Priority order (highest to lowest):
      1. Explicit sort_by/sort_order params (always win if provided)
      2. Query present + no explicit sort → "relevance" (desc)
      3. Filter's default_sort_by/default_sort_ascending (when filter_id provided)
      4. Global defaults (created_at desc)

    This allows callers to use a filter's tag expression while overriding its
    sort settings with custom sorting.

    Args:
        db: Database session.
        user_id: Current user's ID.
        filter_id: Optional filter UUID.
        sort_by: Explicit sort field. Overrides filter default and query-based
            relevance default. If None and query is present, defaults to "relevance".
        sort_order: Explicit sort direction. Overrides filter's default_sort_ascending
            if provided.
        query: Search query string used to trigger relevance sort default.

    Returns:
        ResolvedFilter with filter_expression, sort_by, sort_order, content_types.

    Raises:
        HTTPException: 404 if filter_id provided but not found.
    """
    filter_expression = None
    content_types = None
    content_filter = None

    if filter_id is not None:
        content_filter = await content_filter_service.get_filter(db, user_id, filter_id)
        if content_filter is None:
            raise HTTPException(status_code=404, detail="Filter not found")

        filter_expression = content_filter.filter_expression
        content_types = content_filter.content_types

    # Relevance default: query present beats filter's default sort.
    # Both sort_by and sort_order are set together so a filter's
    # default_sort_ascending can't leak into relevance sorting.
    if sort_by is None and query:
        sort_by = "relevance"
        if sort_order is None:
            sort_order = "desc"

    # Use filter's sort defaults if not already resolved
    if filter_id is not None and content_filter is not None:
        if sort_by is None and content_filter.default_sort_by:
            sort_by = content_filter.default_sort_by
        if sort_order is None and content_filter.default_sort_ascending is not None:
            sort_order = "asc" if content_filter.default_sort_ascending else "desc"

    # Global fallbacks
    return ResolvedFilter(
        filter_expression=filter_expression,
        sort_by=sort_by or "created_at",
        sort_order=sort_order or "desc",
        content_types=content_types,
    )
