"""Relationship CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_limits, get_current_user
from core.auth import get_request_context
from core.tier_limits import TierLimits
from models.content_history import ActionType, EntityType
from models.user import User
from schemas.relationship import (
    RelationshipCreate,
    RelationshipListResponse,
    RelationshipResponse,
    RelationshipUpdate,
    RelationshipWithContentResponse,
)
from services.bookmark_service import BookmarkService
from services.exceptions import (
    ContentNotFoundError,
    DuplicateRelationshipError,
    InvalidRelationshipError,
)
from services.history_service import history_service
from services.note_service import NoteService
from services.prompt_service import PromptService
from services import relationship_service

router = APIRouter(prefix="/relationships", tags=["relationships"])

# Service instances for history recording
_entity_services = {
    EntityType.BOOKMARK: BookmarkService(),
    EntityType.NOTE: NoteService(),
    EntityType.PROMPT: PromptService(),
}


async def _record_relationship_history(
    db: AsyncSession,
    user_id: UUID,
    entity_type: str,
    entity_id: UUID,
    limits: TierLimits,
    request: Request,
) -> None:
    """Record a metadata-only history entry for a relationship change on an entity."""
    et = EntityType(entity_type)
    service = _entity_services[et]
    entity = await service.get(db, user_id, entity_id, include_archived=True)
    if entity is None:
        return
    context = get_request_context(request)
    current_metadata = await service.get_metadata_snapshot(db, user_id, entity)
    await history_service.record_action(
        db=db,
        user_id=user_id,
        entity_type=et,
        entity_id=entity_id,
        action=ActionType.UPDATE,
        current_content=entity.content,
        previous_content=entity.content,  # No content change
        metadata=current_metadata,
        context=context,
        limits=limits,
        changed_fields=["relationships"],
    )


@router.post("/", response_model=RelationshipResponse, status_code=201)
async def create_relationship(
    request: Request,
    data: RelationshipCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> RelationshipResponse:
    """Create a new relationship between content items."""
    try:
        rel = await relationship_service.create_relationship(
            db,
            current_user.id,
            data.source_type,
            data.source_id,
            data.target_type,
            data.target_id,
            data.relationship_type,
            data.description,
            max_per_entity=limits.max_relationships_per_entity,
        )
    except ContentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DuplicateRelationshipError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(e),
                "error_code": "DUPLICATE_RELATIONSHIP",
            },
        )
    except InvalidRelationshipError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Record history on the source entity as specified by the caller
    await _record_relationship_history(
        db, current_user.id, data.source_type, data.source_id, limits, request,
    )

    return RelationshipResponse.model_validate(rel)


# Fixed-prefix route declared before wildcard /{relationship_id} routes
# to prevent path parameter matching conflicts.
@router.get(
    "/content/{content_type}/{content_id}",
    response_model=RelationshipListResponse,
)
async def get_content_relationships(
    content_type: Literal['bookmark', 'note', 'prompt'],
    content_id: UUID,
    relationship_type: str | None = Query(
        default=None, description="Filter by relationship type",
    ),
    include_content_info: bool = Query(
        default=True, description="Include titles and status flags",
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipListResponse:
    """Get all relationships for a content item."""
    rels, total = await relationship_service.get_relationships_for_content(
        db, current_user.id, content_type, content_id,
        relationship_type=relationship_type,
        offset=offset,
        limit=limit,
    )

    if not include_content_info or not rels:
        items = [
            RelationshipWithContentResponse.model_validate(r) for r in rels
        ]
    else:
        items = await relationship_service.enrich_with_content_info(
            db, current_user.id, rels,
        )

    has_more = offset + len(items) < total
    return RelationshipListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_more=has_more,
    )


@router.get("/{relationship_id}", response_model=RelationshipResponse)
async def get_relationship(
    relationship_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipResponse:
    """Get a relationship by ID."""
    rel = await relationship_service.get_relationship(db, current_user.id, relationship_id)
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    return RelationshipResponse.model_validate(rel)


@router.patch("/{relationship_id}", response_model=RelationshipResponse)
async def update_relationship(
    request: Request,
    relationship_id: UUID,
    data: RelationshipUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> RelationshipResponse:
    """Update relationship metadata."""
    # Use exclude_unset to distinguish "not provided" from "set to null"
    updates = data.model_dump(exclude_unset=True)
    kwargs: dict[str, str | None] = {}
    if 'description' in updates:
        kwargs['description'] = updates['description']

    rel = await relationship_service.update_relationship(
        db, current_user.id, relationship_id, **kwargs,
    )
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")

    # Record history on the source entity
    await _record_relationship_history(
        db, current_user.id, rel.source_type, rel.source_id, limits, request,
    )

    return RelationshipResponse.model_validate(rel)


@router.delete("/{relationship_id}", status_code=204)
async def delete_relationship(
    request: Request,
    relationship_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> None:
    """Delete a relationship."""
    # Fetch the relationship before deleting to know which entity to record history on
    rel = await relationship_service.get_relationship(db, current_user.id, relationship_id)
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")

    # Capture source info before deletion for history recording
    source_type = rel.source_type
    source_id = rel.source_id

    # Delete directly — we already have the object, no need to re-fetch
    await db.delete(rel)
    await db.flush()

    # Record history on the source entity
    await _record_relationship_history(
        db, current_user.id, source_type, source_id, limits, request,
    )
