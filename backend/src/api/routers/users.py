"""User endpoints for testing authentication."""
from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.dependencies import get_current_user
from core.tier_limits import Tier, get_tier_limits
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
) -> UserLimitsResponse:
    """
    Get the current user's tier limits.

    Returns all limit values for the user's subscription tier.
    """
    tier = Tier(current_user.tier)
    limits = get_tier_limits(tier)
    return UserLimitsResponse(
        tier=current_user.tier,
        **asdict(limits),
    )
