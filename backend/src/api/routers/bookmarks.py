"""Bookmark CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Response as FastAPIResponse
from pydantic import HttpUrl
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_limits,
    get_current_user,
    get_current_user_auth0_only,
)
from api.helpers import check_optimistic_lock, resolve_filter_and_sorting
from core.auth import get_request_context
from core.http_cache import check_not_modified, format_http_date
from core.tier_limits import TierLimits
from models.user import User
from services.exceptions import FieldLimitExceededError
from schemas.bookmark import (
    BookmarkCreate,
    BookmarkListItem,
    BookmarkListResponse,
    BookmarkResponse,
    BookmarkUpdate,
    MetadataPreviewResponse,
)
from schemas.history import HistoryListResponse, HistoryResponse
from schemas.content_search import ContentSearchMatch, ContentSearchResponse
from schemas.errors import (
    ContentEmptyError,
    MinimalEntityData,
    StrReplaceMultipleMatchesError,
    StrReplaceNoMatchError,
    StrReplaceRequest,
    StrReplaceSuccess,
    StrReplaceSuccessMinimal,
)
from services.bookmark_service import (
    ArchivedUrlExistsError,
    BookmarkService,
    DuplicateUrlError,
)
from services.history_service import history_service
from models.content_history import ActionType, EntityType
from services.content_edit_service import (
    MultipleMatchesError,
    NoMatchError,
    str_replace,
)
from services.content_lines import apply_partial_read
from services.content_search_service import search_in_content
from services.exceptions import InvalidStateError
from services.relationship_service import embed_relationships
from services.url_scraper import scrape_url

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])

bookmark_service = BookmarkService()


@router.get("/fetch-metadata", response_model=MetadataPreviewResponse)
async def fetch_metadata(
    url: HttpUrl = Query(..., description="URL to fetch metadata from"),
    include_content: bool = Query(default=False, description="Also extract page content"),
    _current_user: User = Depends(get_current_user_auth0_only),
) -> MetadataPreviewResponse:
    """
    Fetch metadata from a URL without saving a bookmark.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**

    Use this endpoint to preview title and description before creating a bookmark.
    The frontend can call this when the user enters a URL, then populate the form
    with the extracted values.

    Set include_content=true to also extract the main page content (useful for
    previewing before save).

    Rate limited: 30 requests per minute (Auth0), 250 per day (sensitive operation).
    """
    url_str = str(url)
    scraped = await scrape_url(url_str)

    if scraped.error:
        return MetadataPreviewResponse(
            url=url_str,
            final_url=scraped.final_url or url_str,
            title=None,
            description=None,
            error=scraped.error,
        )

    return MetadataPreviewResponse(
        url=url_str,
        final_url=scraped.final_url or url_str,
        title=scraped.metadata.title if scraped.metadata else None,
        description=scraped.metadata.description if scraped.metadata else None,
        content=scraped.text if include_content else None,
    )


@router.post("/", response_model=BookmarkResponse, status_code=201)
async def create_bookmark(
    request: Request,
    data: BookmarkCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> BookmarkResponse:
    """Create a new bookmark."""
    context = get_request_context(request)
    try:
        bookmark = await bookmark_service.create(db, current_user.id, data, limits, context)
    except ArchivedUrlExistsError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(e),
                "error_code": "ARCHIVED_URL_EXISTS",
                "existing_bookmark_id": str(e.existing_bookmark_id),
            },
        )
    except DuplicateUrlError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(e),
                "error_code": "ACTIVE_URL_EXISTS",
            },
        )
    return BookmarkResponse.model_validate(bookmark)


@router.get("/", response_model=BookmarkListResponse)
async def list_bookmarks(
    q: str | None = Query(
        default=None,
        description="Search query (matches title, description, url, summary, content)",
    ),
    tags: list[str] = Query(default=[], description="Filter by tags"),
    tag_match: Literal["all", "any"] = Query(default="all", description="Tag matching mode: 'all' (AND) or 'any' (OR)"),  # noqa: E501
    sort_by: Literal["created_at", "updated_at", "last_used_at", "title", "archived_at", "deleted_at"] | None = \
        Query(  # noqa: E501
            default=None,
            description="Sort field. Takes precedence over filter_id's default.",
        ),
    sort_order: Literal["asc", "desc"] | None = Query(
        default=None,
        description="Sort direction. Takes precedence over filter_id's default.",
    ),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=50, ge=1, le=100, description="Pagination limit"),
    view: Literal["active", "archived", "deleted"] = Query(default="active", description="Which bookmarks to show: active (default), archived, or deleted"),  # noqa: E501
    filter_id: UUID | None = Query(default=None, description="Filter by content filter ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> BookmarkListResponse:
    """
    List bookmarks for the current user with search, filtering, and sorting.

    - **q**: Text search across title, description, url, summary, and content (case-insensitive)
    - **tags**: Filter by one or more tags (normalized to lowercase)
    - **tag_match**: 'all' requires bookmark to have ALL specified tags, 'any' requires ANY tag
    - **sort_by**: Sort field. Takes precedence over filter_id's default.
    - **sort_order**: Sort direction. Takes precedence over filter_id's default.
    - **view**: Which bookmarks to show - 'active' (not deleted/archived), 'archived', or 'deleted'
    - **filter_id**: Filter by content filter (can be combined with tags for additional filtering)
    """
    resolved = await resolve_filter_and_sorting(
        db, current_user.id, filter_id, sort_by, sort_order,
    )

    try:
        bookmarks, total = await bookmark_service.search(
            db=db,
            user_id=current_user.id,
            query=q,
            tags=tags if tags else None,
            tag_match=tag_match,
            sort_by=resolved.sort_by,
            sort_order=resolved.sort_order,
            offset=offset,
            limit=limit,
            view=view,
            filter_expression=resolved.filter_expression,
        )
    except ValueError as e:
        # Tag validation errors from validate_and_normalize_tags
        raise HTTPException(status_code=422, detail=str(e))
    items = [BookmarkListItem.model_validate(b) for b in bookmarks]
    has_more = offset + len(items) < total
    return BookmarkListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_more=has_more,
    )


@router.get("/{bookmark_id}", response_model=BookmarkResponse)
async def get_bookmark(
    bookmark_id: UUID,
    request: Request,
    response: FastAPIResponse,
    start_line: int | None = Query(
        default=None,
        ge=1,
        description="Start line for partial read (1-indexed). Defaults to 1 if end_line provided.",
    ),
    end_line: int | None = Query(
        default=None,
        ge=1,
        description="End line for partial read (1-indexed, inclusive). "
        "Defaults to total_lines if start_line provided.",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> BookmarkResponse:
    """
    Get a single bookmark by ID (includes archived and deleted bookmarks).

    Supports partial reads via start_line and end_line parameters.
    When line params are provided, only the specified line range is returned
    in the content field, with content_metadata indicating the range and total lines.
    """
    # Quick check: can we return 304?
    updated_at = await bookmark_service.get_updated_at(
        db, current_user.id, bookmark_id, include_deleted=True,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Full fetch
    bookmark = await bookmark_service.get(
        db, current_user.id, bookmark_id, include_archived=True, include_deleted=True,
    )
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    response_data = BookmarkResponse.model_validate(bookmark)
    apply_partial_read(response_data, start_line, end_line)

    # Embed relationships
    response_data.relationships = await embed_relationships(
        db, current_user.id, 'bookmark', bookmark_id,
    )

    return response_data


@router.get("/{bookmark_id}/metadata", response_model=BookmarkListItem)
async def get_bookmark_metadata(
    bookmark_id: UUID,
    request: Request,
    response: FastAPIResponse,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> BookmarkListItem:
    """
    Get bookmark metadata without loading full content.

    Returns content_length (character count) and content_preview (first 500 chars)
    for size assessment before fetching full content via GET /bookmarks/{id}.

    This endpoint is useful for:
    - Checking content size before deciding to load full content
    - Getting quick context via the preview without full content transfer
    - Lightweight status checks
    """
    if "start_line" in request.query_params or "end_line" in request.query_params:
        raise HTTPException(
            status_code=400,
            detail="start_line/end_line parameters are not valid on metadata endpoints. "
            "Use GET /bookmarks/{id} for partial content reads.",
        )
    # Quick check: can we return 304?
    updated_at = await bookmark_service.get_updated_at(
        db, current_user.id, bookmark_id, include_deleted=True,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Fetch metadata only (no full content)
    bookmark = await bookmark_service.get_metadata(
        db, current_user.id, bookmark_id, include_archived=True, include_deleted=True,
    )
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    return BookmarkListItem.model_validate(bookmark)


@router.get("/{bookmark_id}/search", response_model=ContentSearchResponse)
async def search_in_bookmark(
    bookmark_id: UUID,
    q: str = Query(min_length=1, description="Text to search for (literal match)"),
    fields: str = Query(
        default="content",
        description="Comma-separated fields to search: 'content', 'title', 'description'",
    ),
    case_sensitive: bool = Query(default=False, description="Case-sensitive search"),
    context_lines: int = Query(
        default=2,
        ge=0,
        le=10,
        description="Lines of context before/after match (content field only)",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentSearchResponse:
    """
    Search within a bookmark's text fields to find matches with line numbers and context.

    This endpoint serves several purposes for AI agents:

    1. **Pre-edit validation** - Confirm how many matches exist before attempting
       str_replace (avoid "multiple matches" errors)
    2. **Context building** - Get surrounding lines to construct a unique `old_str`
       for editing
    3. **Content discovery** - Find where specific text appears in a document without
       reading the entire content into context
    4. **General search** - Non-editing use cases where agents need to locate
       information within content

    Returns:
        - `matches`: List of matches found. Empty array if no matches (success, not error).
        - `total_matches`: Count of matches found.

    For the `content` field, matches include line numbers (1-indexed) and surrounding
    context lines. For `title` and `description` fields, the full field value is
    returned as context with `line: null`.
    """
    # Fetch the bookmark
    bookmark = await bookmark_service.get(
        db, current_user.id, bookmark_id, include_archived=True, include_deleted=True,
    )
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    # Parse and validate fields
    field_list = [f.strip().lower() for f in fields.split(",")]
    valid_fields = {"content", "title", "description"}
    invalid_fields = set(field_list) - valid_fields
    if invalid_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid fields: {', '.join(invalid_fields)}. "
            "Valid fields: content, title, description",
        )

    # Perform search
    matches = search_in_content(
        content=bookmark.content,
        title=bookmark.title,
        description=bookmark.description,
        query=q,
        fields=field_list,
        case_sensitive=case_sensitive,
        context_lines=context_lines,
    )

    return ContentSearchResponse(
        matches=matches,
        total_matches=len(matches),
    )


@router.patch("/{bookmark_id}", response_model=BookmarkResponse)
async def update_bookmark(
    bookmark_id: UUID,
    request: Request,
    data: BookmarkUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> BookmarkResponse:
    """Update a bookmark."""
    context = get_request_context(request)
    # Check for conflicts before updating
    await check_optimistic_lock(
        db, bookmark_service, current_user.id, bookmark_id,
        data.expected_updated_at, BookmarkResponse,
    )
    try:
        bookmark = await bookmark_service.update(
            db, current_user.id, bookmark_id, data, limits, context,
        )
    except DuplicateUrlError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(e),
                "error_code": "ACTIVE_URL_EXISTS",
            },
        )
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return BookmarkResponse.model_validate(bookmark)


@router.patch(
    "/{bookmark_id}/str-replace",
    response_model=StrReplaceSuccess[BookmarkResponse] | StrReplaceSuccessMinimal,
)
async def str_replace_bookmark(
    bookmark_id: UUID,
    request: Request,
    data: StrReplaceRequest,
    include_updated_entity: bool = Query(
        default=False,
        description="If true, include full updated entity in response. "
        "Default (false) returns only id and updated_at.",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> StrReplaceSuccess[BookmarkResponse] | StrReplaceSuccessMinimal:
    r"""
    Replace text in a bookmark's content using string matching.

    The `old_str` must match exactly one location in the content. If it matches
    zero or multiple locations, the operation fails with an appropriate error.

    **Response format:**
    By default, returns minimal data (id and updated_at) to reduce bandwidth.
    Use `include_updated_entity=true` to get the full updated entity.

    **Matching strategy (progressive fallback):**
    1. **Exact match** - Character-for-character match
    2. **Whitespace normalized** - Normalizes line endings (\\r\\n → \\n) and strips
       trailing whitespace from each line before matching

    **Tips for successful edits:**
    - Include 3-5 lines of surrounding context in `old_str` to ensure uniqueness
    - Use the search endpoint (`GET /bookmarks/{id}/search`) first to check matches
    - For deletion, use empty string as `new_str`

    **Error responses:**
    - 400 with `error: "no_match"` if text not found
    - 400 with `error: "multiple_matches"` if text found in multiple locations
      (includes match locations with context to help construct unique match)
    """
    context = get_request_context(request)
    # Check for conflicts before modifying
    await check_optimistic_lock(
        db, bookmark_service, current_user.id, bookmark_id,
        data.expected_updated_at, BookmarkResponse,
    )

    # Fetch the bookmark (include archived, exclude deleted)
    bookmark = await bookmark_service.get(db, current_user.id, bookmark_id, include_archived=True)
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    # Check if content exists
    if bookmark.content is None:
        raise HTTPException(
            status_code=400,
            detail=ContentEmptyError(
                message="Bookmark has no content to edit",
            ).model_dump(),
        )

    # Capture previous content for history
    previous_content = bookmark.content

    # Perform str_replace
    try:
        result = str_replace(bookmark.content, data.old_str, data.new_str)
    except NoMatchError:
        raise HTTPException(
            status_code=400,
            detail=StrReplaceNoMatchError().model_dump(),
        )
    except MultipleMatchesError as e:
        raise HTTPException(
            status_code=400,
            detail=StrReplaceMultipleMatchesError(
                matches=[
                    ContentSearchMatch(field="content", line=line, context=ctx)
                    for line, ctx in e.matches
                ],
            ).model_dump(),
        )

    # Check for no-op (content unchanged after replacement)
    if result.new_content == previous_content:
        if include_updated_entity:
            await db.refresh(bookmark, attribute_names=["tag_objects"])
            return StrReplaceSuccess(
                match_type=result.match_type,
                line=result.line,
                data=BookmarkResponse.model_validate(bookmark),
            )
        return StrReplaceSuccessMinimal(
            match_type=result.match_type,
            line=result.line,
            data=MinimalEntityData(id=bookmark.id, updated_at=bookmark.updated_at),
        )

    # Validate new content length against tier limits
    if len(result.new_content) > limits.max_bookmark_content_length:
        raise FieldLimitExceededError(
            "content", len(result.new_content), limits.max_bookmark_content_length,
        )

    # Update the bookmark with new content
    bookmark.content = result.new_content
    bookmark.updated_at = func.clock_timestamp()
    await db.flush()
    await db.refresh(bookmark)

    # Record history for str-replace (content changed)
    await db.refresh(bookmark, attribute_names=["tag_objects"])
    metadata = bookmark_service._get_metadata_snapshot(bookmark)
    await history_service.record_action(
        db=db,
        user_id=current_user.id,
        entity_type=EntityType.BOOKMARK,
        entity_id=bookmark.id,
        action=ActionType.UPDATE,
        current_content=bookmark.content,
        previous_content=previous_content,
        metadata=metadata,
        context=context,
        limits=limits,
    )

    if include_updated_entity:
        return StrReplaceSuccess(
            match_type=result.match_type,
            line=result.line,
            data=BookmarkResponse.model_validate(bookmark),
        )

    return StrReplaceSuccessMinimal(
        match_type=result.match_type,
        line=result.line,
        data=MinimalEntityData(id=bookmark.id, updated_at=bookmark.updated_at),
    )


@router.delete("/{bookmark_id}", status_code=204)
async def delete_bookmark(
    bookmark_id: UUID,
    request: Request,
    permanent: bool = Query(default=False, description="If true, permanently delete. If false, soft delete."),  # noqa: E501
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> None:
    """
    Delete a bookmark.

    By default, performs a soft delete (sets deleted_at timestamp).
    Use ?permanent=true from the trash view to permanently remove from database.
    """
    context = get_request_context(request)
    deleted = await bookmark_service.delete(
        db, current_user.id, bookmark_id, permanent=permanent, context=context, limits=limits,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Bookmark not found")


@router.post("/{bookmark_id}/restore", response_model=BookmarkResponse)
async def restore_bookmark(
    bookmark_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> BookmarkResponse:
    """
    Restore a soft-deleted bookmark to active state.

    Clears both deleted_at and archived_at timestamps, returning the bookmark
    to active state (not archived).
    """
    context = get_request_context(request)
    try:
        bookmark = await bookmark_service.restore(
            db, current_user.id, bookmark_id, context, limits=limits,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DuplicateUrlError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return BookmarkResponse.model_validate(bookmark)


@router.post("/{bookmark_id}/archive", response_model=BookmarkResponse)
async def archive_bookmark(
    bookmark_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> BookmarkResponse:
    """
    Archive a bookmark.

    Sets archived_at timestamp. This operation is idempotent - archiving an
    already-archived bookmark returns success with the current state.
    """
    context = get_request_context(request)
    bookmark = await bookmark_service.archive(
        db, current_user.id, bookmark_id, context, limits=limits,
    )
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return BookmarkResponse.model_validate(bookmark)


@router.post("/{bookmark_id}/unarchive", response_model=BookmarkResponse)
async def unarchive_bookmark(
    bookmark_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> BookmarkResponse:
    """
    Unarchive a bookmark.

    Clears archived_at timestamp, returning the bookmark to active state.
    """
    context = get_request_context(request)
    try:
        bookmark = await bookmark_service.unarchive(
            db, current_user.id, bookmark_id, context, limits=limits,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if bookmark is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return BookmarkResponse.model_validate(bookmark)


@router.post("/{bookmark_id}/track-usage", status_code=204)
async def track_bookmark_usage(
    bookmark_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Track bookmark usage by updating last_used_at timestamp.

    This is a fire-and-forget endpoint for the frontend to call when a user
    clicks a bookmark link. Works on active, archived, and deleted bookmarks.
    """
    updated = await bookmark_service.track_usage(
        db, current_user.id, bookmark_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Bookmark not found")


@router.get("/{bookmark_id}/history", response_model=HistoryListResponse)
async def get_bookmark_history(
    bookmark_id: UUID,
    limit: int = Query(default=50, ge=1, le=100, description="Number of records to return"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> HistoryListResponse:
    """
    Get history for a specific bookmark.

    Returns paginated history records for this bookmark,
    sorted by version descending (most recent first).

    Returns empty list (not 404) if:
    - Bookmark was hard-deleted (history cascade-deleted)
    - No history exists for this bookmark_id
    """
    items, total = await history_service.get_entity_history(
        db, current_user.id, EntityType.BOOKMARK, bookmark_id, limit, offset,
    )
    return HistoryListResponse(
        items=[HistoryResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )
