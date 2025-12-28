"""User settings endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user_auth0_only
from models.user import User
from schemas.sidebar import SidebarOrder, SidebarOrderComputed
from services import content_list_service, sidebar_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/sidebar", response_model=SidebarOrderComputed)
async def get_sidebar(
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
) -> SidebarOrderComputed:
    """
    Get the computed sidebar structure with resolved list names.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**

    Returns the sidebar structure with:
    - Built-in items (All, Archived, Trash) with display names
    - List items with names and content_types resolved from database
    - Groups with their child items resolved

    Lists that exist in the database but are not in the sidebar structure
    (orphaned lists) are appended to the root level.

    Lists referenced in the sidebar but deleted from the database are
    automatically filtered out.
    """
    lists = await content_list_service.get_lists(db, current_user.id)
    return await sidebar_service.get_computed_sidebar(db, current_user.id, lists)


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
    - All list IDs must exist and belong to the user
    - No duplicate items (same list, builtin, or group ID twice)
    - Groups cannot be nested

    Returns the computed sidebar after update.
    """
    # Get user's list IDs for validation
    lists = await content_list_service.get_lists(db, current_user.id)
    user_list_ids = {lst.id for lst in lists}

    # Update and validate
    await sidebar_service.update_sidebar_order(
        db, current_user.id, sidebar, user_list_ids,
    )

    # Return computed sidebar
    return await sidebar_service.get_computed_sidebar(db, current_user.id, lists)
