"""User settings endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user_auth0_only
from models.user import User
from schemas.sidebar import SidebarOrder, SidebarOrderComputed
from services import content_filter_service, sidebar_service
from services.exceptions import SidebarValidationError

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/sidebar", response_model=SidebarOrderComputed)
async def get_sidebar(
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
) -> SidebarOrderComputed:
    """
    Get the computed sidebar structure with resolved filter names.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**

    Returns the sidebar structure with:
    - Built-in items (All, Archived, Trash) with display names
    - Filter items with names and content_types resolved from database
    - Collections with their child items resolved

    Filters that exist in the database but are not in the sidebar structure
    (orphaned filters) are prepended to the root level.

    Filters referenced in the sidebar but deleted from the database are
    automatically filtered out.
    """
    filters = await content_filter_service.get_filters(db, current_user.id)
    return await sidebar_service.get_computed_sidebar(db, current_user.id, filters)


@router.put("/sidebar", response_model=SidebarOrderComputed)
async def update_sidebar(
    sidebar: SidebarOrder,
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
) -> SidebarOrderComputed:
    """
    Update the sidebar structure.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**

    Validates the structure:
    - All filter IDs must exist and belong to the user
    - No duplicate items (same filter, builtin, or collection ID twice)
    - Collections cannot be nested

    Returns the computed sidebar after update.
    """
    # Get user's filter IDs for validation
    filters = await content_filter_service.get_filters(db, current_user.id)
    user_filter_ids = {f.id for f in filters}

    # Update and validate
    try:
        await sidebar_service.update_sidebar_order(
            db, current_user.id, sidebar, user_filter_ids,
        )
    except SidebarValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

    # Return computed sidebar
    return await sidebar_service.get_computed_sidebar(db, current_user.id, filters)
