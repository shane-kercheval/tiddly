"""Notes CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Response as FastAPIResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_user,
)
from core.http_cache import check_not_modified, format_http_date
from models.user import User
from schemas.content_search import ContentSearchMatch, ContentSearchResponse
from schemas.note import (
    NoteCreate,
    NoteListItem,
    NoteListResponse,
    NoteResponse,
    NoteUpdate,
)
from services import content_filter_service
from services.content_search_service import SearchMatch, search_in_content
from services.exceptions import InvalidStateError
from services.note_service import NoteService

router = APIRouter(prefix="/notes", tags=["notes"])

note_service = NoteService()


@router.post("/", response_model=NoteResponse, status_code=201)
async def create_note(
    data: NoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """Create a new note."""
    note = await note_service.create(db, current_user.id, data)
    return NoteResponse.model_validate(note)


@router.get("/", response_model=NoteListResponse)
async def list_notes(
    q: str | None = Query(default=None, description="Search query (matches title, description, content)"),  # noqa: E501
    tags: list[str] = Query(default=[], description="Filter by tags"),
    tag_match: Literal["all", "any"] = Query(default="all", description="Tag matching mode: 'all' (AND) or 'any' (OR)"),  # noqa: E501
    sort_by: Literal["created_at", "updated_at", "last_used_at", "title", "archived_at", "deleted_at"] = Query(default="created_at", description="Sort field"),  # noqa: E501
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort order"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=50, ge=1, le=100, description="Pagination limit"),
    view: Literal["active", "archived", "deleted"] = Query(default="active", description="Which notes to show: active (default), archived, or deleted"),  # noqa: E501
    filter_id: UUID | None = Query(default=None, description="Filter by content filter ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteListResponse:
    """
    List notes for the current user with search, filtering, and sorting.

    - **q**: Text search across title, description, and content (case-insensitive)
    - **tags**: Filter by one or more tags (normalized to lowercase)
    - **tag_match**: 'all' requires note to have ALL specified tags, 'any' requires ANY tag
    - **sort_by**: Sort by created_at (default), updated_at, last_used_at, title, etc.
    - **sort_order**: Sort ascending or descending (default: desc)
    - **view**: Which notes to show - 'active' (not deleted/archived), 'archived', or 'deleted'
    - **filter_id**: Filter by content filter (can be combined with tags for additional filtering)
    """
    # If filter_id provided, fetch the filter and use its filter expression
    filter_expression = None
    if filter_id is not None:
        content_filter = await content_filter_service.get_filter(db, current_user.id, filter_id)
        if content_filter is None:
            raise HTTPException(status_code=404, detail="Filter not found")
        filter_expression = content_filter.filter_expression

    try:
        notes, total = await note_service.search(
            db=db,
            user_id=current_user.id,
            query=q,
            tags=tags if tags else None,
            tag_match=tag_match,
            sort_by=sort_by,
            sort_order=sort_order,
            offset=offset,
            limit=limit,
            view=view,
            filter_expression=filter_expression,
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """Get a single note by ID (includes archived and deleted notes)."""
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
    return NoteResponse.model_validate(note)


def _convert_search_matches(matches: list[SearchMatch]) -> list[ContentSearchMatch]:
    """Convert internal SearchMatch objects to API response schema."""
    return [
        ContentSearchMatch(field=m.field, line=m.line, context=m.context)
        for m in matches
    ]


@router.get("/{note_id}/search", response_model=ContentSearchResponse)
async def search_in_note(
    note_id: UUID,
    q: str = Query(description="Text to search for (literal match)"),
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
        matches=_convert_search_matches(matches),
        total_matches=len(matches),
    )


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: UUID,
    data: NoteUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """Update a note."""
    note = await note_service.update(
        db, current_user.id, note_id, data,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    note_id: UUID,
    permanent: bool = Query(default=False, description="Permanently delete from DB if true"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Delete a note.

    By default, performs a soft delete (sets deleted_at timestamp).
    Use ?permanent=true from the trash view to permanently remove from database.
    """
    deleted = await note_service.delete(
        db, current_user.id, note_id, permanent=permanent,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")


@router.post("/{note_id}/restore", response_model=NoteResponse)
async def restore_note(
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """
    Restore a soft-deleted note to active state.

    Clears both deleted_at and archived_at timestamps, returning the note
    to active state (not archived).
    """
    try:
        note = await note_service.restore(
            db, current_user.id, note_id,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.post("/{note_id}/archive", response_model=NoteResponse)
async def archive_note(
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """
    Archive a note.

    Sets archived_at timestamp. This operation is idempotent - archiving an
    already-archived note returns success with the current state.
    """
    note = await note_service.archive(
        db, current_user.id, note_id,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.post("/{note_id}/unarchive", response_model=NoteResponse)
async def unarchive_note(
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> NoteResponse:
    """
    Unarchive a note.

    Clears archived_at timestamp, returning the note to active state.
    """
    try:
        note = await note_service.unarchive(
            db, current_user.id, note_id,
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
