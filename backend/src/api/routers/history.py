"""History API endpoints for viewing content version history."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_limits, get_current_user
from core.auth import get_request_context
from core.tier_limits import TierLimits
from models.content_history import EntityType
from models.user import User
from schemas.bookmark import BookmarkUpdate
from schemas.history import (
    ContentAtVersionResponse,
    HistoryListResponse,
    HistoryResponse,
    RevertResponse,
)
from schemas.note import NoteUpdate
from schemas.prompt import PromptArgument, PromptUpdate
from services.bookmark_service import BookmarkService, DuplicateUrlError
from services.history_service import history_service
from services.note_service import NoteService
from services.prompt_service import NameConflictError, PromptService

router = APIRouter(prefix="/history", tags=["history"])

# Service instances for revert operations
_bookmark_service = BookmarkService()
_note_service = NoteService()
_prompt_service = PromptService()


def _get_service_for_entity_type(
    entity_type: EntityType,
) -> BookmarkService | NoteService | PromptService:
    """Get the appropriate service for an entity type."""
    services = {
        EntityType.BOOKMARK: _bookmark_service,
        EntityType.NOTE: _note_service,
        EntityType.PROMPT: _prompt_service,
    }
    return services[entity_type]


def _build_update_from_history(
    entity_type: EntityType,
    content: str | None,
    metadata: dict,
) -> BookmarkUpdate | NoteUpdate | PromptUpdate:
    """
    Build an update schema from history data.

    Handles schema evolution gracefully:
    - Unknown fields in metadata (from newer schema): ignored
    - Missing fields in metadata (from older schema): omitted from update,
      preserving the entity's current value for that field

    Tags are restored by name. The service layer creates missing tags
    automatically (existing behavior).

    IMPORTANT: Only include fields that actually exist in metadata. If we pass
    a field with value None, the service's model_dump(exclude_unset=True) will
    still include it (because it was explicitly set), causing current values
    to be overwritten with None.
    """
    # Build common fields conditionally - only include fields present in metadata
    common_fields: dict = {}

    # Content: only include if not None (None means reconstruction found no content)
    if content is not None:
        common_fields["content"] = content

    # Metadata fields: only include if key exists in metadata snapshot
    if "title" in metadata:
        common_fields["title"] = metadata["title"]
    if "description" in metadata:
        common_fields["description"] = metadata["description"]
    if "tags" in metadata:
        common_fields["tags"] = metadata["tags"]

    if entity_type == EntityType.BOOKMARK:
        if "url" in metadata:
            common_fields["url"] = metadata["url"]
        return BookmarkUpdate(**common_fields)

    if entity_type == EntityType.NOTE:
        return NoteUpdate(**common_fields)

    if entity_type == EntityType.PROMPT:
        if "name" in metadata:
            common_fields["name"] = metadata["name"]
        if "arguments" in metadata and metadata["arguments"] is not None:
            # Convert arguments from dicts to PromptArgument objects
            # If arguments is None (malformed snapshot), skip to preserve current value
            common_fields["arguments"] = [
                PromptArgument(**arg) for arg in metadata["arguments"]
            ]
        return PromptUpdate(**common_fields)

    raise ValueError(f"Unknown entity type: {entity_type}")


@router.get("/", response_model=HistoryListResponse)
async def get_user_history(
    entity_type: EntityType | None = Query(
        default=None,
        description="Filter by entity type (bookmark, note, prompt)",
    ),
    limit: int = Query(default=50, ge=1, le=100, description="Number of records to return"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> HistoryListResponse:
    """
    Get history of all user's content.

    Returns paginated history records across all bookmarks, notes, and prompts,
    sorted by created_at descending (most recent first).

    Optionally filter by entity_type to see history for only one content type.
    """
    items, total = await history_service.get_user_history(
        db, current_user.id, entity_type, limit, offset,
    )
    return HistoryListResponse(
        items=[HistoryResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )


@router.get("/{entity_type}/{entity_id}", response_model=HistoryListResponse)
async def get_entity_history(
    entity_type: EntityType,
    entity_id: UUID,
    limit: int = Query(default=50, ge=1, le=100, description="Number of records to return"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> HistoryListResponse:
    """
    Get history for a specific entity.

    Returns paginated history records for the specified entity,
    sorted by version descending (most recent first).

    Returns empty list (not 404) if:
    - Entity was hard-deleted (history cascade-deleted)
    - Entity never existed
    - No history exists for this entity_id
    """
    items, total = await history_service.get_entity_history(
        db, current_user.id, entity_type, entity_id, limit, offset,
    )
    return HistoryListResponse(
        items=[HistoryResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )


@router.get(
    "/{entity_type}/{entity_id}/version/{version}",
    response_model=ContentAtVersionResponse,
)
async def get_content_at_version(
    entity_type: EntityType,
    entity_id: UUID,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentAtVersionResponse:
    """
    Reconstruct content at a specific version.

    Uses the entity's current content as anchor and applies reverse diffs
    to reconstruct the content at the specified version.

    Returns:
    - 200 with content (may be None for DELETE actions) if version exists
    - 404 if version doesn't exist or entity was hard-deleted

    The response includes any reconstruction warnings if diff application
    encountered issues (partial patch failures).
    """
    result = await history_service.reconstruct_content_at_version(
        db, current_user.id, entity_type, entity_id, version,
    )
    if not result.found:
        raise HTTPException(status_code=404, detail="Version not found")

    # Get metadata from that version's history record
    history = await history_service.get_history_at_version(
        db, current_user.id, entity_type, entity_id, version,
    )

    return ContentAtVersionResponse(
        entity_id=entity_id,
        version=version,
        content=result.content,  # May be None for DELETE actions - that's valid
        metadata=history.metadata_snapshot if history else None,
        warnings=result.warnings,
    )


@router.post(
    "/{entity_type}/{entity_id}/revert/{version}",
    response_model=RevertResponse,
)
async def revert_to_version(
    request: Request,
    entity_type: EntityType,
    entity_id: UUID,
    version: int = Path(..., ge=1, description="Version to revert to (must be >= 1)"),
    current_user: User = Depends(get_current_user),
    limits: TierLimits = Depends(get_current_limits),
    db: AsyncSession = Depends(get_async_session),
) -> RevertResponse:
    """
    Revert entity to a previous version.

    Restores content and metadata from the specified version by creating a new
    UPDATE history entry. The revert operation delegates to the entity-specific
    service for validation (URL/name uniqueness, field limits, etc.).

    Note: To "undo create" (delete the entity), use the DELETE endpoint instead.
    Revert is specifically for restoring to a previous content state.

    Returns:
    - 200 with revert confirmation and any warnings
    - 400 if trying to revert to current version
    - 404 if entity not found or version doesn't exist
    - 409 if restored URL/name conflicts with another entity
    """
    context = get_request_context(request)
    service = _get_service_for_entity_type(entity_type)

    # Check if trying to revert to current version (no-op, return error)
    latest_version = await history_service.get_latest_version(
        db, current_user.id, entity_type, entity_id,
    )
    if latest_version is not None and version == latest_version:
        raise HTTPException(
            status_code=400,
            detail="Cannot revert to current version",
        )

    # Check if entity exists (may be soft-deleted)
    entity = await service.get(
        db, current_user.id, entity_id, include_deleted=True, include_archived=True,
    )
    if entity is None:
        # Entity was permanently deleted - cannot restore
        raise HTTPException(status_code=404, detail="Entity not found")

    # Reconstruct content at the specified version
    result = await history_service.reconstruct_content_at_version(
        db, current_user.id, entity_type, entity_id, version,
    )
    if not result.found:
        raise HTTPException(status_code=404, detail="Version not found")

    # Get metadata from that version
    history = await history_service.get_history_at_version(
        db, current_user.id, entity_type, entity_id, version,
    )
    if history is None:
        raise HTTPException(status_code=404, detail="Version not found")

    # If entity is soft-deleted, restore it first
    if entity.deleted_at is not None:
        await service.restore(db, current_user.id, entity_id, context=context, limits=limits)

    # Update entity with restored content and metadata
    # This will record a new UPDATE history entry
    # Service handles validation (URL/name uniqueness, etc.)
    update_data = _build_update_from_history(
        entity_type, result.content, history.metadata_snapshot or {},
    )
    try:
        await service.update(db, current_user.id, entity_id, update_data, limits, context)
    except DuplicateUrlError:
        raise HTTPException(
            status_code=409,
            detail="Cannot revert: URL already exists on another bookmark",
        )
    except NameConflictError:
        raise HTTPException(
            status_code=409,
            detail="Cannot revert: name already exists on another prompt",
        )
    except IntegrityError as e:
        # Handle cases where the service didn't catch the IntegrityError
        # (e.g., when flush happens during tag update before the service's try/except)
        await db.rollback()
        error_str = str(e)
        if "uq_bookmark_user_url_active" in error_str:
            raise HTTPException(
                status_code=409,
                detail="Cannot revert: URL already exists on another bookmark",
            )
        if "uq_prompt_user_name_active" in error_str:
            raise HTTPException(
                status_code=409,
                detail="Cannot revert: name already exists on another prompt",
            )
        raise

    # Include warnings in response so frontend can show confirmation if needed
    return RevertResponse(
        message="Reverted successfully",
        version=version,
        warnings=result.warnings,
    )
