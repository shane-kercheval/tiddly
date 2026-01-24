"""
Router for unified content endpoints.

Provides endpoints for searching across all content types (bookmarks, notes, prompts)
with unified pagination and sorting.
"""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user
from api.helpers import resolve_filter_and_sorting
from models.user import User
from schemas.content import ContentListResponse
from services.content_service import search_all_content

router = APIRouter(prefix="/content", tags=["content"])


@router.get("/", response_model=ContentListResponse)
async def list_all_content(
    q: str | None = Query(
        default=None, description="Search query for title, description, content",
    ),
    tags: list[str] | None = Query(default=None, description="Filter by tags"),
    tag_match: Literal["all", "any"] = Query(
        default="all",
        description="Tag matching mode: 'all' requires all tags, 'any' requires any tag",
    ),
    sort_by: Literal[
        "created_at", "updated_at", "last_used_at", "title", "archived_at", "deleted_at",
    ] | None = Query(
        default=None,
        description="Sort field. Takes precedence over filter_id's default.",
    ),
    sort_order: Literal["asc", "desc"] | None = Query(
        default=None,
        description="Sort direction. Takes precedence over filter_id's default.",
    ),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=50, ge=1, le=100, description="Pagination limit"),
    view: Literal["active", "archived", "deleted"] = Query(
        default="active",
        description="View: 'active' (not deleted/archived), 'archived', or 'deleted'",
    ),
    filter_id: UUID | None = Query(default=None, description="Filter by content filter ID"),
    content_types: list[Literal["bookmark", "note", "prompt"]] | None = Query(
        default=None,
        description="Filter by content types (bookmark, note, prompt). If not specified, all types are included.",  # noqa: E501
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentListResponse:
    """
    List all content (bookmarks, notes, and prompts) with unified pagination.

    Returns a unified list of content items sorted by the specified field.
    Each item includes a `type` field indicating whether it's a "bookmark", "note", or "prompt".

    Use this endpoint for:
    - Shared "All", "Archived", and "Trash" views (no filter_id)
    - Custom content filters with mixed types (with filter_id)

    When filter_id is provided:
    - The filter's filter_expression is applied
    - The filter's content_types act as the upper bound of entity types returned
    - If content_types query param is provided, results are filtered to the intersection
    - sort_by/sort_order take precedence over filter's sort defaults
    """
    resolved = await resolve_filter_and_sorting(
        db, current_user.id, filter_id, sort_by, sort_order,
    )

    # Compute effective content types: intersection of query param with filter's content_types
    if content_types is None:
        effective_content_types = resolved.content_types
    elif resolved.content_types is None:
        effective_content_types = content_types
    else:
        effective_content_types = [ct for ct in content_types if ct in resolved.content_types]

    items, total = await search_all_content(
        db=db,
        user_id=current_user.id,
        query=q,
        tags=tags,
        tag_match=tag_match,
        sort_by=resolved.sort_by,
        sort_order=resolved.sort_order,
        offset=offset,
        limit=limit,
        view=view,
        filter_expression=resolved.filter_expression,
        content_types=effective_content_types,
    )

    return ContentListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_more=(offset + len(items)) < total,
    )
