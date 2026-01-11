"""Content filter CRUD endpoints."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user
from models.user import User
from schemas.content_filter import (
    ContentFilterCreate,
    ContentFilterResponse,
    ContentFilterUpdate,
)
from services import content_filter_service

router = APIRouter(prefix="/filters", tags=["filters"])


@router.post("/", response_model=ContentFilterResponse, status_code=201)
async def create_filter(
    data: ContentFilterCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentFilterResponse:
    """
    Create a new content filter.

    The filter will be automatically added to the beginning of your sidebar.
    """
    content_filter = await content_filter_service.create_filter(db, current_user.id, data)
    return ContentFilterResponse.model_validate(content_filter)


@router.get("/", response_model=list[ContentFilterResponse])
async def get_filters(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[ContentFilterResponse]:
    """Get all content filters for the current user."""
    filters = await content_filter_service.get_filters(db, current_user.id)
    return [ContentFilterResponse.model_validate(f) for f in filters]


@router.get("/{filter_id}", response_model=ContentFilterResponse)
async def get_filter(
    filter_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentFilterResponse:
    """Get a specific content filter by ID."""
    content_filter = await content_filter_service.get_filter(db, current_user.id, filter_id)
    if content_filter is None:
        raise HTTPException(status_code=404, detail="Filter not found")
    return ContentFilterResponse.model_validate(content_filter)


@router.patch("/{filter_id}", response_model=ContentFilterResponse)
async def update_filter(
    filter_id: UUID,
    data: ContentFilterUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentFilterResponse:
    """Update a content filter."""
    content_filter = await content_filter_service.update_filter(
        db, current_user.id, filter_id, data,
    )
    if content_filter is None:
        raise HTTPException(status_code=404, detail="Filter not found")
    return ContentFilterResponse.model_validate(content_filter)


@router.delete("/{filter_id}", status_code=204)
async def delete_filter(
    filter_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Delete a content filter.

    The filter will be automatically removed from your sidebar.
    """
    deleted = await content_filter_service.delete_filter(db, current_user.id, filter_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Filter not found")
