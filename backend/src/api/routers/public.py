"""
Unauthenticated, read-only endpoints for publicly shared items.

Items are served by share token (``public_token``) with no authentication. The
``Public*`` response schemas exclude all owner-only data (tags, relationships,
user identity, sharing/lifecycle internals). Soft-deleted items return 404;
archived items return 200 with ``is_archived = true``.

Caching is handled by ``ETagMiddleware``, which applies the public cache headers
to ``/public/*`` paths. Each read is rate-limited per client IP (these endpoints
have no user context for the tier-based limits).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session
from core.rate_limiter import check_ip_rate_limit
from core.request_utils import get_client_ip
from schemas.bookmark import PublicBookmarkResponse
from schemas.note import PublicNoteResponse
from schemas.prompt import PublicPromptResponse
from services import public_item_service
from services.content_lines import apply_partial_read

router = APIRouter(prefix="/public", tags=["public"])


# NOTE: this is attached per-GET-endpoint (via each route's `dependencies=[...]`),
# NOT hoisted to a router-level dependency. M4 adds authenticated POST
# `.../save` clone endpoints to this same router that must use per-USER rate
# limiting, not per-IP. Keep IP limiting scoped to the GET reads.
async def enforce_public_ip_rate_limit(request: Request) -> None:
    """Rate-limit an unauthenticated public request by client IP; 429 on exceed."""
    ip = get_client_ip(request) or "unknown"
    result = await check_ip_rate_limit(ip)
    if not result.allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please try again later.",
            headers={"Retry-After": str(result.retry_after)},
        )


@router.get(
    "/bookmarks/{token}",
    response_model=PublicBookmarkResponse,
    dependencies=[Depends(enforce_public_ip_rate_limit)],
)
async def read_public_bookmark(
    token: str,
    db: AsyncSession = Depends(get_async_session),
) -> PublicBookmarkResponse:
    """Return a published bookmark by share token (404 if not found/unpublished/deleted)."""
    bookmark = await public_item_service.get_public_bookmark(db, token)
    if bookmark is None:
        raise HTTPException(status_code=404, detail="Not found")
    response = PublicBookmarkResponse.model_validate(bookmark)
    apply_partial_read(response, None, None)
    return response


@router.get(
    "/notes/{token}",
    response_model=PublicNoteResponse,
    dependencies=[Depends(enforce_public_ip_rate_limit)],
)
async def read_public_note(
    token: str,
    db: AsyncSession = Depends(get_async_session),
) -> PublicNoteResponse:
    """Return a published note by share token (404 if not found/unpublished/deleted)."""
    note = await public_item_service.get_public_note(db, token)
    if note is None:
        raise HTTPException(status_code=404, detail="Not found")
    response = PublicNoteResponse.model_validate(note)
    apply_partial_read(response, None, None)
    return response


@router.get(
    "/prompts/{token}",
    response_model=PublicPromptResponse,
    dependencies=[Depends(enforce_public_ip_rate_limit)],
)
async def read_public_prompt(
    token: str,
    db: AsyncSession = Depends(get_async_session),
) -> PublicPromptResponse:
    """Return a published prompt by share token (404 if not found/unpublished/deleted)."""
    prompt = await public_item_service.get_public_prompt(db, token)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Not found")
    response = PublicPromptResponse.model_validate(prompt)
    apply_partial_read(response, None, None)
    return response
