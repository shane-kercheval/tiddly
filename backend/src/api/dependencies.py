"""FastAPI dependencies for injection."""
from fastapi import Depends

from core.auth import (
    get_current_user,
    get_current_user_auth0_only,
    get_current_user_auth0_only_without_consent,
    get_current_user_without_consent,
)
from core.config import get_settings
from core.tier_limits import TierLimits, get_tier_limits, get_tier_safely
from db.session import get_async_session
from schemas.cached_user import CachedUser


def get_current_limits(
    current_user: CachedUser = Depends(get_current_user),
) -> TierLimits:
    """
    Get the tier limits for the current user.

    This dependency safely converts the user's tier to limits, defaulting
    to FREE tier on unknown values to prevent 500 errors.

    Args:
        current_user: The authenticated user.

    Returns:
        TierLimits for the user's subscription tier.
    """
    tier = get_tier_safely(current_user.tier)
    return get_tier_limits(tier)


__all__ = [
    "get_async_session",
    "get_current_limits",
    "get_current_user",
    "get_current_user_auth0_only",
    "get_current_user_auth0_only_without_consent",
    "get_current_user_without_consent",
    "get_settings",
]
