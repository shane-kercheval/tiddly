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
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_limits, get_current_user
from core.auth import get_request_context
from core.rate_limiter import check_ip_rate_limit
from core.request_utils import get_client_ip
from core.tier_limits import TierLimits
from models.user import User
from schemas.bookmark import BookmarkCreate, BookmarkResponse, PublicBookmarkResponse
from schemas.note import NoteCreate, NoteResponse, PublicNoteResponse
from schemas.prompt import PromptCreate, PromptResponse, PublicPromptResponse
from services import public_item_service
from services.bookmark_service import (
    ArchivedUrlExistsError,
    BookmarkService,
    DuplicateUrlError,
)
from services.content_lines import apply_partial_read
from services.note_service import NoteService
from services.prompt_service import NameConflictError, PromptService

router = APIRouter(prefix="/public", tags=["public"])

# Stateless service instances, mirroring the per-router pattern. The clone
# endpoints reuse the normal create() path so quota, tier field-limits, and
# uniqueness validation all apply automatically (and surface via the app-level
# QuotaExceededError/FieldLimitExceededError handlers).
bookmark_service = BookmarkService()
note_service = NoteService()
prompt_service = PromptService()


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


# --- Clone ("Save a copy") endpoints -----------------------------------------
#
# These are auth-required (Depends(get_current_user)) despite living under the
# /public prefix: they act on publicly-shared content identified by token, but
# write into the authenticated caller's account. Rate limiting is therefore
# per-USER (applied inside get_current_user), NOT the per-IP limit the GET reads
# use. POST requests are skipped by ETagMiddleware, so the public cache headers
# don't apply here.
#
# Each clone reuses the type's normal create() path, so quota, tier field-limits,
# and uniqueness validation all apply for free. The source is copied as a fresh,
# independent item: title/description/content (plus url for bookmarks, name and
# arguments for prompts). tags, relationships, and archived/shared state are
# deliberately NOT copied — the clone starts clean, active, and unshared.


@router.post("/bookmarks/{token}/save", response_model=BookmarkResponse, status_code=201)
async def clone_public_bookmark(
    token: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> BookmarkResponse:
    """
    Save a copy of a public bookmark into the authenticated user's account.

    404 if the token is unknown/unpublished/deleted. A URL the caller already
    has (active or archived) yields a descriptive 409, consistent with
    POST /bookmarks — not a redirect to the existing copy.
    """
    source = await public_item_service.get_public_bookmark(db, token)
    if source is None:
        raise HTTPException(status_code=404, detail="Not found")

    context = get_request_context(request)
    try:
        bookmark = await bookmark_service.create(
            db,
            current_user.id,
            BookmarkCreate(
                url=source.url,
                title=source.title,
                description=source.description,
                content=source.content,
            ),
            limits,
            context,
        )
    except ArchivedUrlExistsError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(e),
                "error_code": "ARCHIVED_URL_EXISTS",
                "existing_bookmark_id": str(e.existing_bookmark_id),
            },
        )
    except DuplicateUrlError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), "error_code": "ACTIVE_URL_EXISTS"},
        )
    return BookmarkResponse.model_validate(bookmark)


@router.post("/notes/{token}/save", response_model=NoteResponse, status_code=201)
async def clone_public_note(
    token: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> NoteResponse:
    """
    Save a copy of a public note into the authenticated user's account.

    404 if the token is unknown/unpublished/deleted. Notes have no per-user
    uniqueness constraint, so the copy always succeeds (subject to quota and
    field limits).
    """
    source = await public_item_service.get_public_note(db, token)
    if source is None:
        raise HTTPException(status_code=404, detail="Not found")

    context = get_request_context(request)
    note = await note_service.create(
        db,
        current_user.id,
        NoteCreate(
            title=source.title,
            description=source.description,
            content=source.content,
        ),
        limits,
        context,
    )
    return NoteResponse.model_validate(note)


@router.post("/prompts/{token}/save", response_model=PromptResponse, status_code=201)
async def clone_public_prompt(
    token: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """
    Save a copy of a public prompt into the authenticated user's account.

    404 if the token is unknown/unpublished/deleted. Prompt names are unique per
    user, so the name is resolved before the single create(): the original is
    used if free, else ``{name}-copy``. A residual collision — the fallback is
    also taken, or a concurrent create races us — surfaces as a descriptive 409.

    The name is resolved with a query rather than catching a first conflict and
    retrying, because create() issues a hard ``db.rollback()`` on the unique
    violation; continuing to use the session after that is fragile.

    Source prompts come straight from DB state, which has no DB-level guarantee
    that ``content``/``arguments`` satisfy the stricter ``PromptCreate`` schema
    (``Prompt.content`` is nullable; ``arguments`` is free-form JSON). A source
    that can't form a valid prompt yields a 422 ``SOURCE_PROMPT_UNCOPYABLE``
    rather than a 500. See architecture.md §16 (Prompt.content nullability).
    """
    source = await public_item_service.get_public_prompt(db, token)
    if source is None:
        raise HTTPException(status_code=404, detail="Not found")

    # Friendly, specific message for the most likely malformed-source case.
    if source.content is None:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "This shared prompt has no content and can't be copied.",
                "error_code": "SOURCE_PROMPT_UNCOPYABLE",
            },
        )

    context = get_request_context(request)
    name = source.name
    if await prompt_service.name_exists(db, current_user.id, name):
        name = f"{source.name}-copy"
    try:
        payload = PromptCreate(
            name=name,
            title=source.title,
            description=source.description,
            content=source.content,
            arguments=source.arguments,
        )
    except ValidationError:
        # Backstop for other malformed stored data (e.g. invalid argument JSON).
        raise HTTPException(
            status_code=422,
            detail={
                "message": "This shared prompt contains data that can't be copied.",
                "error_code": "SOURCE_PROMPT_UNCOPYABLE",
            },
        )
    try:
        prompt = await prompt_service.create(db, current_user.id, payload, limits, context)
    except NameConflictError:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    f"A prompt named '{name}' already exists in your account. "
                    "Rename it before saving this copy."
                ),
                "error_code": "NAME_CONFLICT",
            },
        )
    except ValueError as e:
        # Template validation — mirror POST /prompts (defensive; the source was
        # validated on creation, so this is effectively unreachable normally).
        raise HTTPException(status_code=400, detail=str(e))
    return PromptResponse.model_validate(prompt)
