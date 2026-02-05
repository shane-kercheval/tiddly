"""Notes CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Response as FastAPIResponse
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_limits,
    get_current_user,
)
from api.helpers import check_optimistic_lock, resolve_filter_and_sorting
from core.auth import get_request_context
from core.http_cache import check_not_modified, format_http_date
from core.tier_limits import TierLimits
from models.user import User
from services.exceptions import FieldLimitExceededError
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
from schemas.history import HistoryListResponse, HistoryResponse
from schemas.note import (
    NoteCreate,
    NoteListItem,
    NoteListResponse,
    NoteResponse,
    NoteUpdate,
)
from services.content_edit_service import (
    MultipleMatchesError,
    NoMatchError,
    str_replace,
)
from services.content_lines import apply_partial_read
from services.content_search_service import search_in_content
from services.exceptions import InvalidStateError
from services.history_service import history_service
from services.note_service import NoteService
from models.content_history import ActionType, EntityType

router = APIRouter(prefix="/notes", tags=["notes"])

note_service = NoteService()


@router.post("/", response_model=NoteResponse, status_code=201)
async def create_note(
    request: Request,
    data: NoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> NoteResponse:
    """Create a new note."""
    context = get_request_context(request)
    note = await note_service.create(db, current_user.id, data, limits, context)
    return NoteResponse.model_validate(note)


@router.get("/", response_model=NoteListResponse)
async def list_notes(
    q: str | None = Query(
        default=None,
        description="Search query (matches title, description, content)",
    ),
    tags: list[str] = Query(default=[], description="Filter by tags"),
    tag_match: Literal["all", "any"] = Query(
        default="all",
        description="Tag matching mode: 'all' (AND) or 'any' (OR)",
    ),
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
    view: Literal["active", "archived", "deleted"] = Query(
        default="active",
        description="Which notes to show: active (default), archived, or deleted",
    ),
    filter_id: UUID | None = Query(default=None, description="Filter by content filter ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteListResponse:
    """
    List notes for the current user with search, filtering, and sorting.

    - **q**: Text search across title, description, and content (case-insensitive)
    - **tags**: Filter by one or more tags (normalized to lowercase)
    - **tag_match**: 'all' requires note to have ALL specified tags, 'any' requires ANY tag
    - **sort_by**: Sort field. Takes precedence over filter_id's default.
    - **sort_order**: Sort direction. Takes precedence over filter_id's default.
    - **view**: Which notes to show - 'active' (not deleted/archived), 'archived', or 'deleted'
    - **filter_id**: Filter by content filter (can be combined with tags for additional filtering)
    """
    resolved = await resolve_filter_and_sorting(
        db, current_user.id, filter_id, sort_by, sort_order,
    )

    try:
        notes, total = await note_service.search(
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
    items = [NoteListItem.model_validate(n) for n in notes]
    has_more = offset + len(items) < total
    return NoteListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_more=has_more,
    )


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: UUID,
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
) -> NoteResponse:
    """
    Get a single note by ID (includes archived and deleted notes).

    Supports partial reads via start_line and end_line parameters.
    When line params are provided, only the specified line range is returned
    in the content field, with content_metadata indicating the range and total lines.
    """
    # Quick check: can we return 304?
    updated_at = await note_service.get_updated_at(
        db, current_user.id, note_id, include_deleted=True,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Note not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Full fetch
    note = await note_service.get(
        db, current_user.id, note_id, include_archived=True, include_deleted=True,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    response_data = NoteResponse.model_validate(note)
    apply_partial_read(response_data, start_line, end_line)
    return response_data


@router.get("/{note_id}/metadata", response_model=NoteListItem)
async def get_note_metadata(
    note_id: UUID,
    request: Request,
    response: FastAPIResponse,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteListItem:
    """
    Get note metadata without loading full content.

    Returns content_length (character count) and content_preview (first 500 chars)
    for size assessment before fetching full content via GET /notes/{id}.

    This endpoint is useful for:
    - Checking content size before deciding to load full content
    - Getting quick context via the preview without full content transfer
    - Lightweight status checks
    """
    if "start_line" in request.query_params or "end_line" in request.query_params:
        raise HTTPException(
            status_code=400,
            detail="start_line/end_line parameters are not valid on metadata endpoints. "
            "Use GET /notes/{id} for partial content reads.",
        )
    # Quick check: can we return 304?
    updated_at = await note_service.get_updated_at(
        db, current_user.id, note_id, include_deleted=True,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Note not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Fetch metadata only (no full content)
    note = await note_service.get_metadata(
        db, current_user.id, note_id, include_archived=True, include_deleted=True,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    return NoteListItem.model_validate(note)


@router.get("/{note_id}/search", response_model=ContentSearchResponse)
async def search_in_note(
    note_id: UUID,
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
    Search within a note's text fields to find matches with line numbers and context.

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
    # Fetch the note
    note = await note_service.get(
        db, current_user.id, note_id, include_archived=True, include_deleted=True,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

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
        content=note.content,
        title=note.title,
        description=note.description,
        query=q,
        fields=field_list,
        case_sensitive=case_sensitive,
        context_lines=context_lines,
    )

    return ContentSearchResponse(
        matches=matches,
        total_matches=len(matches),
    )


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: UUID,
    request: Request,
    data: NoteUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> NoteResponse:
    """Update a note."""
    context = get_request_context(request)
    # Check for conflicts before updating
    await check_optimistic_lock(
        db, note_service, current_user.id, note_id,
        data.expected_updated_at, NoteResponse,
    )

    note = await note_service.update(
        db, current_user.id, note_id, data, limits, context,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.patch(
    "/{note_id}/str-replace",
    response_model=StrReplaceSuccess[NoteResponse] | StrReplaceSuccessMinimal,
)
async def str_replace_note(
    note_id: UUID,
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
) -> StrReplaceSuccess[NoteResponse] | StrReplaceSuccessMinimal:
    r"""
    Replace text in a note's content using string matching.

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
    - Use the search endpoint (`GET /notes/{id}/search`) first to check matches
    - For deletion, use empty string as `new_str`

    **Error responses:**
    - 400 with `error: "no_match"` if text not found
    - 400 with `error: "multiple_matches"` if text found in multiple locations
      (includes match locations with context to help construct unique match)
    """
    context = get_request_context(request)
    # Check for conflicts before modifying
    await check_optimistic_lock(
        db, note_service, current_user.id, note_id,
        data.expected_updated_at, NoteResponse,
    )

    # Fetch the note (include archived, exclude deleted)
    note = await note_service.get(db, current_user.id, note_id, include_archived=True)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    # Check if content exists
    if note.content is None:
        raise HTTPException(
            status_code=400,
            detail=ContentEmptyError(
                message="Note has no content to edit",
            ).model_dump(),
        )

    # Capture previous content for history
    previous_content = note.content

    # Perform str_replace
    try:
        result = str_replace(note.content, data.old_str, data.new_str)
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
            await db.refresh(note, attribute_names=["tag_objects"])
            return StrReplaceSuccess(
                match_type=result.match_type,
                line=result.line,
                data=NoteResponse.model_validate(note),
            )
        return StrReplaceSuccessMinimal(
            match_type=result.match_type,
            line=result.line,
            data=MinimalEntityData(id=note.id, updated_at=note.updated_at),
        )

    # Validate new content length against tier limits
    if len(result.new_content) > limits.max_note_content_length:
        raise FieldLimitExceededError(
            "content", len(result.new_content), limits.max_note_content_length,
        )

    # Update the note with new content
    note.content = result.new_content
    note.updated_at = func.clock_timestamp()
    await db.flush()
    await db.refresh(note)

    # Record history for str-replace (content changed)
    await db.refresh(note, attribute_names=["tag_objects"])
    metadata = note_service._get_metadata_snapshot(note)
    await history_service.record_action(
        db=db,
        user_id=current_user.id,
        entity_type=EntityType.NOTE,
        entity_id=note.id,
        action=ActionType.UPDATE,
        current_content=note.content,
        previous_content=previous_content,
        metadata=metadata,
        context=context,
    )

    if include_updated_entity:
        return StrReplaceSuccess(
            match_type=result.match_type,
            line=result.line,
            data=NoteResponse.model_validate(note),
        )
    return StrReplaceSuccessMinimal(
        match_type=result.match_type,
        line=result.line,
        data=MinimalEntityData(id=note.id, updated_at=note.updated_at),
    )


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    note_id: UUID,
    request: Request,
    permanent: bool = Query(default=False, description="Permanently delete from DB if true"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Delete a note.

    By default, performs a soft delete (sets deleted_at timestamp).
    Use ?permanent=true from the trash view to permanently remove from database.
    """
    context = get_request_context(request)
    deleted = await note_service.delete(
        db, current_user.id, note_id, permanent=permanent, context=context,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")


@router.post("/{note_id}/restore", response_model=NoteResponse)
async def restore_note(
    note_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """
    Restore a soft-deleted note to active state.

    Clears both deleted_at and archived_at timestamps, returning the note
    to active state (not archived).
    """
    context = get_request_context(request)
    try:
        note = await note_service.restore(
            db, current_user.id, note_id, context,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.post("/{note_id}/archive", response_model=NoteResponse)
async def archive_note(
    note_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """
    Archive a note.

    Sets archived_at timestamp. This operation is idempotent - archiving an
    already-archived note returns success with the current state.
    """
    context = get_request_context(request)
    note = await note_service.archive(
        db, current_user.id, note_id, context,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.post("/{note_id}/unarchive", response_model=NoteResponse)
async def unarchive_note(
    note_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """
    Unarchive a note.

    Clears archived_at timestamp, returning the note to active state.
    """
    context = get_request_context(request)
    try:
        note = await note_service.unarchive(
            db, current_user.id, note_id, context,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.post("/{note_id}/track-usage", status_code=204)
async def track_note_usage(
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Track note usage by updating last_used_at timestamp.

    This is a fire-and-forget endpoint for the frontend to call when a user
    views a note. Works on active, archived, and deleted notes.
    """
    updated = await note_service.track_usage(
        db, current_user.id, note_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Note not found")


@router.get("/{note_id}/history", response_model=HistoryListResponse)
async def get_note_history(
    note_id: UUID,
    limit: int = Query(default=50, ge=1, le=100, description="Number of records to return"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> HistoryListResponse:
    """
    Get history for a specific note.

    Returns paginated history records for this note,
    sorted by version descending (most recent first).

    Returns empty list (not 404) if:
    - Note was hard-deleted (history cascade-deleted)
    - No history exists for this note_id
    """
    items, total = await history_service.get_entity_history(
        db, current_user.id, EntityType.NOTE, note_id, limit, offset,
    )
    return HistoryListResponse(
        items=[HistoryResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )
