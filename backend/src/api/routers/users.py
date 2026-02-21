"""User endpoints for testing authentication."""
from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.dependencies import get_current_user, get_settings
from core.config import Settings
from core.tier_limits import Tier, get_tier_limits, get_tier_safely
from models.user import User
from schemas.user_limits import UserLimitsResponse


router = APIRouter(prefix="/users", tags=["users"])


class UserResponse(BaseModel):
    """Response model for user info."""

    id: UUID
    auth0_id: str
    email: str | None

    model_config = {"from_attributes": True}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> User:
    """Get the current authenticated user's info."""
    return current_user


@router.get("/me/limits", response_model=UserLimitsResponse)
async def get_my_limits(
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> UserLimitsResponse:
    """
    Get the current user's tier limits.

    Returns all limit values for the user's subscription tier.
    In dev mode, returns DEV tier limits regardless of stored tier.
    """
    tier = Tier.DEV if settings.dev_mode else get_tier_safely(current_user.tier)
    limits = get_tier_limits(tier)
    return UserLimitsResponse(
        tier=tier.value,
        **asdict(limits),
    )
