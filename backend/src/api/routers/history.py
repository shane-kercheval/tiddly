"""History API endpoints for viewing content version history."""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_limits, get_current_user
from core.auth import get_request_context
from core.request_context import RequestSource
from core.tier_limits import TierLimits
from models.content_history import ActionType, DiffType, EntityType
from models.user import User
from schemas.bookmark import BookmarkUpdate
from schemas.history import (
    ContentAtVersionResponse,
    HistoryListResponse,
    HistoryResponse,
    RestoreResponse,
)
from schemas.note import NoteUpdate
from schemas.prompt import PromptArgument, PromptUpdate
from services.bookmark_service import BookmarkService, DuplicateUrlError
from services.history_service import history_service
from services.note_service import NoteService
from services.prompt_service import NameConflictError, PromptService

router = APIRouter(prefix="/history", tags=["history"])

# Service instances for restore operations
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
    entity_type: list[EntityType] | None = Query(
        default=None,
        description="Filter by entity types. Multiple values use OR logic.",
    ),
    action: list[ActionType] | None = Query(
        default=None,
        description="Filter by action types. Multiple values use OR logic.",
    ),
    source: list[RequestSource] | None = Query(
        default=None,
        description="Filter by source (web, api, mcp-content, mcp-prompt, unknown).",
    ),
    start_date: datetime | None = Query(
        default=None,
        description="Filter records on or after this datetime (ISO 8601 UTC).",
    ),
    end_date: datetime | None = Query(
        default=None,
        description="Filter records on or before this datetime (ISO 8601 UTC).",
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

    Filters:
    - entity_type: Filter by content types (OR logic within)
    - action: Filter by action types (OR logic within)
    - source: Filter by request source (OR logic within)
    - start_date/end_date: Filter by date range (inclusive)

    All filters combine with AND logic between categories.
    """
    # Validate date range - require timezone-aware datetimes
    if start_date and start_date.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="start_date must be timezone-aware (e.g., 2024-01-15T00:00:00Z)",
        )
    if end_date and end_date.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="end_date must be timezone-aware (e.g., 2024-01-15T00:00:00Z)",
        )
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="start_date must be before or equal to end_date",
        )

    items, total = await history_service.get_user_history(
        db,
        current_user.id,
        entity_types=entity_type,
        actions=action,
        sources=source,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
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
    "/{entity_type}/{entity_id}/restore/{version}",
    response_model=RestoreResponse,
)
async def restore_to_version(
    request: Request,
    entity_type: EntityType,
    entity_id: UUID,
    version: int = Path(..., ge=1, description="Version to restore to (must be >= 1)"),
    current_user: User = Depends(get_current_user),
    limits: TierLimits = Depends(get_current_limits),
    db: AsyncSession = Depends(get_async_session),
) -> RestoreResponse:
    """
    Restore entity to a previous version.

    Restores content and metadata from the specified version by creating a new
    RESTORE history entry. Delegates to the entity-specific service for
    validation (URL/name uniqueness, field limits, etc.).

    Soft-deleted entities must be undeleted first via the restore (undelete) endpoint.
    Audit versions (delete/undelete/archive/unarchive) cannot be restored to.

    Returns:
    - 200 with restore confirmation and any warnings
    - 400 if trying to restore to current version or to an audit version
    - 404 if entity not found, soft-deleted, or version doesn't exist
    - 409 if restored URL/name conflicts with another entity
    """
    context = get_request_context(request)
    service = _get_service_for_entity_type(entity_type)

    # Check if trying to restore to current version (no-op, return error)
    latest_version = await history_service.get_latest_version(
        db, current_user.id, entity_type, entity_id,
    )
    if latest_version is not None and version == latest_version:
        raise HTTPException(
            status_code=400,
            detail="Cannot restore to current version",
        )

    # Check if entity exists and is not soft-deleted
    entity = await service.get(
        db, current_user.id, entity_id, include_deleted=True, include_archived=True,
    )
    if entity is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    if entity.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Entity not found")

    # Get the target version's history record
    history = await history_service.get_history_at_version(
        db, current_user.id, entity_type, entity_id, version,
    )
    if history is None:
        raise HTTPException(status_code=404, detail="Version not found")

    # Block restoring to audit versions (lifecycle state transitions, not content versions)
    if history.diff_type == DiffType.AUDIT.value:
        raise HTTPException(
            status_code=400,
            detail="Cannot restore to an audit version (delete/undelete/archive/unarchive). "
                   "These are state transitions, not content versions.",
        )

    # Reconstruct content at the specified version
    result = await history_service.reconstruct_content_at_version(
        db, current_user.id, entity_type, entity_id, version,
    )
    if not result.found:
        raise HTTPException(status_code=404, detail="Version not found")

    # Update entity with restored content and metadata
    # Records a RESTORE action in history
    # Service handles validation (URL/name uniqueness, etc.)
    update_data = _build_update_from_history(
        entity_type, result.content, history.metadata_snapshot or {},
    )
    try:
        await service.update(
            db, current_user.id, entity_id, update_data, limits, context,
            action=ActionType.RESTORE,
        )
    except DuplicateUrlError:
        raise HTTPException(
            status_code=409,
            detail="Cannot restore: URL already exists on another bookmark",
        )
    except NameConflictError:
        raise HTTPException(
            status_code=409,
            detail="Cannot restore: name already exists on another prompt",
        )
    except IntegrityError as e:
        await db.rollback()
        error_str = str(e)
        if "uq_bookmark_user_url_active" in error_str:
            raise HTTPException(
                status_code=409,
                detail="Cannot restore: URL already exists on another bookmark",
            )
        if "uq_prompt_user_name_active" in error_str:
            raise HTTPException(
                status_code=409,
                detail="Cannot restore: name already exists on another prompt",
            )
        raise

    return RestoreResponse(
        message="Restored successfully",
        version=version,
        warnings=result.warnings,
    )
