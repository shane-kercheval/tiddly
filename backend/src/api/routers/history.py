"""History API endpoints for viewing content version history."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user
from models.content_history import EntityType
from models.user import User
from schemas.history import ContentAtVersionResponse, HistoryListResponse, HistoryResponse
from services.history_service import history_service

router = APIRouter(prefix="/history", tags=["history"])


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
