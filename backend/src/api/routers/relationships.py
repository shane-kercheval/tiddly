"""Relationship CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user
from models.user import User
from schemas.relationship import (
    RelationshipCreate,
    RelationshipListResponse,
    RelationshipResponse,
    RelationshipUpdate,
    RelationshipWithContentResponse,
)
from services.exceptions import (
    ContentNotFoundError,
    DuplicateRelationshipError,
    InvalidRelationshipError,
)
from services import relationship_service

router = APIRouter(prefix="/relationships", tags=["relationships"])


@router.post("/", response_model=RelationshipResponse, status_code=201)
async def create_relationship(
    data: RelationshipCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
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
    relationship_id: UUID,
    data: RelationshipUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
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
    return RelationshipResponse.model_validate(rel)


@router.delete("/{relationship_id}", status_code=204)
async def delete_relationship(
    relationship_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """Delete a relationship."""
    deleted = await relationship_service.delete_relationship(
        db, current_user.id, relationship_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Relationship not found")
