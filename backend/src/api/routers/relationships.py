"""Relationship CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user
from models.bookmark import Bookmark
from models.content_relationship import ContentRelationship
from models.note import Note
from models.prompt import Prompt
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
        items = await _enrich_with_content_info(db, current_user.id, rels)

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


# Column tuples for batch resolution queries — only fetch what's needed.
_BOOKMARK_COLS = (
    Bookmark.id, Bookmark.title, Bookmark.url, Bookmark.deleted_at, Bookmark.archived_at,
)
_NOTE_COLS = (Note.id, Note.title, Note.deleted_at, Note.archived_at)
_PROMPT_COLS = (Prompt.id, Prompt.title, Prompt.deleted_at, Prompt.archived_at)


async def _enrich_with_content_info(
    db: AsyncSession,
    user_id: UUID,
    rels: list[ContentRelationship],
) -> list[RelationshipWithContentResponse]:
    """
    Batch-resolve content metadata for relationship endpoints.

    Collects all distinct IDs per content type, issues one query per type
    (at most 3 queries), then maps results into response objects.
    """
    # Collect IDs per content type from both source and target sides
    ids_by_type: dict[str, set[UUID]] = {'bookmark': set(), 'note': set(), 'prompt': set()}
    for rel in rels:
        if rel.source_type in ids_by_type:
            ids_by_type[rel.source_type].add(rel.source_id)
        if rel.target_type in ids_by_type:
            ids_by_type[rel.target_type].add(rel.target_id)

    # Batch query per type — one query each, only if IDs exist
    # Lookup: (type, id) -> {title, url, deleted, archived}
    info: dict[tuple[str, UUID], dict[str, str | bool | None]] = {}

    if ids_by_type['bookmark']:
        stmt = (
            select(*_BOOKMARK_COLS)
            .where(Bookmark.user_id == user_id, Bookmark.id.in_(ids_by_type['bookmark']))
        )
        for row in (await db.execute(stmt)).all():
            info[('bookmark', row.id)] = {
                'title': row.title,
                'url': str(row.url) if row.url else None,
                'deleted': row.deleted_at is not None,
                'archived': row.archived_at is not None,
            }

    if ids_by_type['note']:
        stmt = (
            select(*_NOTE_COLS)
            .where(Note.user_id == user_id, Note.id.in_(ids_by_type['note']))
        )
        for row in (await db.execute(stmt)).all():
            info[('note', row.id)] = {
                'title': row.title,
                'url': None,
                'deleted': row.deleted_at is not None,
                'archived': row.archived_at is not None,
            }

    if ids_by_type['prompt']:
        stmt = (
            select(*_PROMPT_COLS)
            .where(Prompt.user_id == user_id, Prompt.id.in_(ids_by_type['prompt']))
        )
        for row in (await db.execute(stmt)).all():
            info[('prompt', row.id)] = {
                'title': row.title,
                'url': None,
                'deleted': row.deleted_at is not None,
                'archived': row.archived_at is not None,
            }

    # Build enriched response objects
    items: list[RelationshipWithContentResponse] = []
    for rel in rels:
        source_info = info.get((rel.source_type, rel.source_id))
        target_info = info.get((rel.target_type, rel.target_id))

        items.append(RelationshipWithContentResponse(
            id=rel.id,
            source_type=rel.source_type,
            source_id=rel.source_id,
            target_type=rel.target_type,
            target_id=rel.target_id,
            relationship_type=rel.relationship_type,
            description=rel.description,
            created_at=rel.created_at,
            updated_at=rel.updated_at,
            source_title=source_info['title'] if source_info else None,
            source_url=source_info['url'] if source_info else None,
            source_deleted=source_info['deleted'] if source_info else True,
            source_archived=source_info['archived'] if source_info else False,
            target_title=target_info['title'] if target_info else None,
            target_url=target_info['url'] if target_info else None,
            target_deleted=target_info['deleted'] if target_info else True,
            target_archived=target_info['archived'] if target_info else False,
        ))

    return items
