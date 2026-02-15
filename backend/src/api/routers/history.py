"""History API endpoints for viewing content version history."""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_limits, get_current_user
from core.auth import get_request_context
from core.tier_limits import TierLimits
from models.content_history import ActionType, EntityType
from models.user import User
from schemas.bookmark import BookmarkUpdate
from schemas.history import (
    ContentAtVersionResponse,
    HistoryListResponse,
    HistoryResponse,
    RestoreResponse,
    VersionDiffResponse,
)
from schemas.note import NoteUpdate
from schemas.prompt import PromptArgument, PromptUpdate
from schemas.relationship import RelationshipInput
from services.bookmark_service import BookmarkService, DuplicateUrlError
from services.history_service import HistoryService, history_service
from services.note_service import NoteService
from services.prompt_service import NameConflictError, PromptService
from services.tag_service import resolve_tag_ids_to_names

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


async def _resolve_tags_from_snapshot(
    db: AsyncSession,
    user_id: UUID,
    tags_snapshot: list,
) -> list[str]:
    """
    Resolve tags from a metadata snapshot to current tag names.

    Handles both formats:
    - New format: [{"id": "uuid", "name": "python"}, ...] — resolve by ID,
      fall back to snapshot name if tag was deleted.
    - Old format: ["python", ...] — use names directly.

    Args:
        db: Database session.
        user_id: User ID to scope tags.
        tags_snapshot: Tags from the metadata snapshot.

    Returns:
        List of tag name strings for the update schema.
    """
    if not tags_snapshot:
        return []

    # Detect format: old (list of strings) vs new (list of dicts with id+name)
    if isinstance(tags_snapshot[0], str):
        return tags_snapshot

    # New format: resolve IDs to current names
    tag_ids = [UUID(t["id"]) for t in tags_snapshot if "id" in t]
    id_to_name = await resolve_tag_ids_to_names(db, user_id, tag_ids)

    resolved: list[str] = []
    for t in tags_snapshot:
        tag_id = UUID(t["id"]) if "id" in t else None
        if tag_id and tag_id in id_to_name:
            # Tag still exists — use its current name (follows renames)
            resolved.append(id_to_name[tag_id])
        else:
            # Tag was deleted — fall back to snapshot name
            resolved.append(t["name"])
    return resolved


async def _build_update_from_history(
    db: AsyncSession,
    user_id: UUID,
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

    Tags are resolved by ID to follow renames. Falls back to snapshot name
    for deleted tags or old-format snapshots (plain strings).

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
        common_fields["tags"] = await _resolve_tags_from_snapshot(
            db, user_id, metadata["tags"],
        )

    # Restore relationships if present in snapshot (absent in older snapshots = skip).
    # Strip snapshot-only fields (e.g. target_title) that aren't on RelationshipInput.
    if "relationships" in metadata:
        rel_fields = {"target_type", "target_id", "relationship_type", "description"}
        common_fields["relationships"] = [
            RelationshipInput(**{k: v for k, v in rel.items() if k in rel_fields})
            for rel in metadata["relationships"]
        ]

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
    content_type: list[EntityType] | None = Query(
        default=None,
        description="Filter by content types. Multiple values use OR logic.",
    ),
    action: list[ActionType] | None = Query(
        default=None,
        description="Filter by action types. Multiple values use OR logic.",
    ),
    source: list[str] | None = Query(
        default=None,
        description="Filter by source (e.g. web, api, mcp-content, mcp-prompt).",
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
    - content_type: Filter by content types (OR logic within)
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
        entity_types=content_type,
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


@router.get("/{content_type}/{content_id}", response_model=HistoryListResponse)
async def get_entity_history(
    content_type: EntityType,
    content_id: UUID,
    limit: int = Query(default=50, ge=1, le=100, description="Number of records to return"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> HistoryListResponse:
    """
    Get history for a specific content item.

    Returns paginated history records for the specified content item,
    sorted by created_at descending (most recent first).

    Returns empty list (not 404) if:
    - Content was hard-deleted (history cascade-deleted)
    - Content never existed
    - No history exists for this content_id
    """
    items, total = await history_service.get_entity_history(
        db, current_user.id, content_type, content_id, limit, offset,
    )
    return HistoryListResponse(
        items=[HistoryResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )


@router.get(
    "/{content_type}/{content_id}/version/{version}/diff",
    response_model=VersionDiffResponse,
)
async def get_version_diff(
    content_type: EntityType,
    content_id: UUID,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> VersionDiffResponse:
    """
    Get diff between a version and its predecessor.

    Returns before/after content and metadata for the specified version.
    For version 1 (CREATE), before fields are null.
    For metadata-only changes, content fields are both null.

    Returns:
    - 200 with diff data
    - 404 if version doesn't exist or content was hard-deleted
    """
    result = await history_service.get_version_diff(
        db, current_user.id, content_type, content_id, version,
    )
    if not result.found:
        raise HTTPException(status_code=404, detail="Version not found")

    return VersionDiffResponse(
        content_id=content_id,
        version=version,
        before_content=result.before_content,
        after_content=result.after_content,
        before_metadata=result.before_metadata,
        after_metadata=result.after_metadata,
        warnings=result.warnings,
    )


@router.get(
    "/{content_type}/{content_id}/version/{version}",
    response_model=ContentAtVersionResponse,
)
async def get_content_at_version(
    content_type: EntityType,
    content_id: UUID,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentAtVersionResponse:
    """
    Reconstruct content at a specific version.

    Uses the content item's current content as anchor and applies reverse diffs
    to reconstruct the content at the specified version.

    Returns:
    - 200 with content if version exists
    - 404 if version doesn't exist or content was hard-deleted

    The response includes any reconstruction warnings if diff application
    encountered issues (partial patch failures).
    """
    result = await history_service.reconstruct_content_at_version(
        db, current_user.id, content_type, content_id, version,
    )
    if not result.found:
        raise HTTPException(status_code=404, detail="Version not found")

    # Get metadata from that version's history record
    history = await history_service.get_history_at_version(
        db, current_user.id, content_type, content_id, version,
    )

    return ContentAtVersionResponse(
        content_id=content_id,
        version=version,
        content=result.content,  # May be None for DELETE actions - that's valid
        metadata=history.metadata_snapshot if history else None,
        warnings=result.warnings,
    )


@router.post(
    "/{content_type}/{content_id}/restore/{version}",
    response_model=RestoreResponse,
)
async def restore_to_version(
    request: Request,
    content_type: EntityType,
    content_id: UUID,
    version: int = Path(..., ge=1, description="Version to restore to (must be >= 1)"),
    current_user: User = Depends(get_current_user),
    limits: TierLimits = Depends(get_current_limits),
    db: AsyncSession = Depends(get_async_session),
) -> RestoreResponse:
    """
    Restore content item to a previous version.

    Restores content and metadata from the specified version by creating a new
    RESTORE history entry. Delegates to the content-specific service for
    validation (URL/name uniqueness, field limits, etc.).

    Soft-deleted content must be undeleted first via the restore (undelete) endpoint.
    Audit versions (delete/undelete/archive/unarchive) cannot be restored to.

    Returns:
    - 200 with restore confirmation and any warnings
    - 400 if trying to restore to current version or to an audit version
    - 404 if content not found, soft-deleted, or version doesn't exist
    - 409 if restored URL/name conflicts with another content item
    """
    context = get_request_context(request)
    service = _get_service_for_entity_type(content_type)

    # Check if trying to restore to current version (no-op, return error)
    latest_version = await history_service.get_latest_version(
        db, current_user.id, content_type, content_id,
    )
    if latest_version is not None and version == latest_version:
        raise HTTPException(
            status_code=400,
            detail="Cannot restore to current version",
        )

    # Check if content exists and is not soft-deleted
    entity = await service.get(
        db, current_user.id, content_id, include_deleted=True, include_archived=True,
    )
    if entity is None:
        raise HTTPException(status_code=404, detail="Content not found")
    if entity.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Content not found")

    # Get the target version's history record
    history = await history_service.get_history_at_version(
        db, current_user.id, content_type, content_id, version,
    )
    if history is None:
        raise HTTPException(status_code=404, detail="Version not found")

    # Block restoring to audit versions (lifecycle state transitions, not content versions)
    if history.action in HistoryService.AUDIT_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail="Cannot restore to an audit version (delete/undelete/archive/unarchive). "
                   "These are state transitions, not content versions.",
        )

    # Reconstruct content at the specified version
    result = await history_service.reconstruct_content_at_version(
        db, current_user.id, content_type, content_id, version,
    )
    if not result.found:
        raise HTTPException(status_code=404, detail="Version not found")

    # Update content with restored data and metadata
    # Records a RESTORE action in history
    # Service handles validation (URL/name uniqueness, etc.)
    update_data = await _build_update_from_history(
        db, current_user.id, content_type, result.content,
        history.metadata_snapshot or {},
    )
    try:
        await service.update(
            db, current_user.id, content_id, update_data, limits, context,
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
