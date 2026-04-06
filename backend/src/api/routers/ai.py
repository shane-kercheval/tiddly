"""AI feature endpoints."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from litellm.exceptions import AuthenticationError

from api.dependencies import get_current_user_auth0_only
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/health")
async def ai_health(
    current_user: CachedUser = Depends(get_current_user_auth0_only),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> dict:
    """Check if AI features are available for this user. No AI rate limit consumed.

    Simplified response for Milestone 1a — full quota-aware response added in 1b.
    """
    has_byok = llm_api_key is not None
    return {
        "available": True,
        "byok": has_byok,
    }


@router.post("/validate-key")
async def validate_key(
    current_user: CachedUser = Depends(get_current_user_auth0_only),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> dict:
    """Validate a BYOK API key by making a minimal provider call."""
    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No API key provided via X-LLM-Api-Key header")

    llm_service = get_llm_service()
    config = llm_service.resolve_config(AIUseCase.SUGGESTIONS, user_api_key=llm_api_key)
    try:
        await llm_service.complete(
            messages=[{"role": "user", "content": "Hi"}],
            config=config,
            max_tokens=5,
            temperature=0,
        )
        return {"valid": True}
    except AuthenticationError:
        return {"valid": False, "error": "API key rejected by provider"}


@router.get("/models")
async def ai_models(
    current_user: CachedUser = Depends(get_current_user_auth0_only),
) -> dict:
    """Return curated list of supported models and per-use-case defaults.

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
