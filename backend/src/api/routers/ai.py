"""AI feature endpoints."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from litellm.exceptions import AuthenticationError

from api.dependencies import get_current_limits_ai, get_current_user_ai
from core.rate_limit_config import OperationType, RateLimitExceededError
from core.rate_limiter import check_rate_limit, get_ai_rate_limit_status
from core.tier_limits import TierLimits, get_tier_safely
from models.user import User
from schemas.cached_user import CachedUser
from services.llm_service import (
    AIUseCase,
    get_llm_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def get_llm_api_key(request: Request) -> str | None:
    """Extract optional BYOK API key from request header."""
    return request.headers.get("X-LLM-Api-Key")


async def apply_ai_rate_limit(
    request: Request,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> None:
    """
    Enforce AI rate limiting for BYOK calls.

    Returns early if no BYOK key is present (no quota consumed).
    Stores result in request.state for rate limit headers middleware.
    Note: platform AI rate limiting is added in Milestone 2 when
    platform AI endpoints (suggest-tags, etc.) are introduced.
    """
    if not llm_api_key:
        return
    op_type = OperationType.AI_BYOK
    tier = get_tier_safely(current_user.tier)
    result = await check_rate_limit(current_user.id, op_type, tier)
    request.state.rate_limit_info = {
        "limit": result.limit,
        "remaining": result.remaining,
        "reset": result.reset,
    }
    if not result.allowed:
        raise RateLimitExceededError(result)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/health")
async def ai_health(
    current_user: User | CachedUser = Depends(get_current_user_ai),
    limits: TierLimits = Depends(get_current_limits_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> dict:
    """Check if AI features are available for this user. No AI rate limit consumed."""
    has_byok = llm_api_key is not None
    ai_bucket = OperationType.AI_BYOK if has_byok else OperationType.AI_PLATFORM
    quota = await get_ai_rate_limit_status(
        current_user.id, ai_bucket, get_tier_safely(current_user.tier),
    )
    return {
        "available": limits.rate_ai_per_day > 0 or (has_byok and limits.rate_ai_byok_per_day > 0),
        "byok": has_byok,
        "remaining_daily": quota.remaining,
        "limit_daily": quota.limit,
    }


@router.post("/validate-key")
async def validate_key(
    _current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
) -> dict:
    """Validate a BYOK API key by making a minimal provider call."""
    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No API key provided via X-LLM-Api-Key header")

    llm_service = get_llm_service()
    config = llm_service.resolve_config(AIUseCase.SUGGESTIONS, user_api_key=llm_api_key)
    try:
        await llm_service.complete(
            messages=[{"role": "user", "content": "This is a test. Respond with 'ok'."}],
            config=config,
            max_tokens=5,
            temperature=0,
        )
        return {"valid": True}
    except AuthenticationError:
        return {"valid": False, "error": "API key rejected by provider"}


@router.get("/models")
async def ai_models(
    _current_user: User | CachedUser = Depends(get_current_user_ai),
) -> dict:
    """
    Return curated list of supported models and per-use-case defaults.

    No AI rate limit consumed — this is a configuration endpoint, not an LLM call.
    """
    llm_service = get_llm_service()
    return {
        "models": llm_service.supported_models,
        "defaults": {
            uc.value: llm_service.get_model_for_use_case(uc)
            for uc in AIUseCase
        },
    }
