"""AI feature endpoints."""
import logging
import time
from typing import Any, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from litellm.exceptions import AuthenticationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_limits_ai, get_current_user_ai
from core.rate_limit_config import OperationType, RateLimitExceededError
from core.rate_limiter import check_rate_limit, get_ai_rate_limit_status
from core.tier_limits import TierLimits, get_tier_safely
from db.session import get_async_session
from models.user import User
from schemas.ai import (
    AIErrorResponse,
    AIHealthResponse,
    AIModelsResponse,
    ConsentRequiredResponse,
    RelationshipCandidateContext,
    SuggestArgumentsRequest,
    SuggestArgumentsResponse,
    SuggestMetadataRequest,
    SuggestMetadataResponse,
    SuggestRelationshipsRequest,
    SuggestRelationshipsResponse,
    SuggestTagsRequest,
    SuggestTagsResponse,
    TagVocabularyEntry,
    ValidateKeyRequest,
    ValidateKeyResponse,
)
from schemas.cached_user import CachedUser
from services.ai_cost_tracking import track_cost
from services.content_service import search_all_content
from services.llm_service import (
    AIUseCase,
    LLMConfig,
    UnsupportedModelError,
    get_llm_service,
)
from services.suggestion_service import (
    LLMParseFailedError,
    LLMResponseParseError,
    suggest_arguments,
    suggest_metadata,
    suggest_relationships,
    suggest_tags,
)
from services.tag_service import get_user_tags_with_counts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


# ---------------------------------------------------------------------------
# Shared error-response schemas (populate `responses=` on each endpoint)
# ---------------------------------------------------------------------------

# Errors that every AI endpoint (config or suggestion) may return.
_BASE_AI_ERROR_RESPONSES: dict[int | str, dict] = {
    401: {
        "model": AIErrorResponse,
        "description": "Missing or invalid Auth0 JWT (no `Authorization` header or bad token).",
    },
    403: {
        "model": AIErrorResponse,
        "description": (
            "Authenticated but not allowed. Most commonly: the caller supplied a "
            "Personal Access Token (`bm_*`). AI endpoints are Auth0-only — PATs "
            "are rejected as a defense-in-depth signal that these endpoints are "
            "not intended for automated / programmatic use."
        ),
    },
    422: {
        "description": (
            "FastAPI / Pydantic request validation failed (missing required "
            "field, oversized `content_snippet`, invalid `target_index`, etc.). "
            "Response follows FastAPI's standard validation-error shape: "
            "`{\"detail\": [{\"loc\": [...], \"msg\": \"...\", \"type\": \"...\"}]}`, "
            "**not** the `AIErrorResponse` envelope used for other 4xx/5xx errors."
        ),
    },
    451: {
        "model": ConsentRequiredResponse,
        "description": (
            "User has not accepted the current privacy policy / terms of "
            "service. `detail` is a structured object with `error`, `message`, "
            "`consent_url`, and `instructions` keys — direct the user through "
            "the consent flow before retrying."
        ),
    },
}

# Additional errors that only occur on endpoints that actually invoke an LLM
# (suggestion endpoints + validate-key). Config-only endpoints like /health and
# /models do not return these.
_LLM_CALL_ERROR_RESPONSES: dict[int | str, dict] = {
    400: {
        "model": AIErrorResponse,
        "description": (
            "Invalid request. Typed variants: `llm_bad_request` (LLM provider "
            "rejected the request shape). Also: the supplied `model` is not in "
            "the supported list (no `error_code`; message starts with "
            "\"Unsupported model\"), and `suggest-arguments` service "
            "validation failures (e.g. `target_index` out of range — no "
            "`error_code`, message in `detail`)."
        ),
    },
    429: {
        "model": AIErrorResponse,
        "description": (
            "Tiddly per-tier AI rate limit exceeded (no `error_code`; the "
            "bare rate-limiter message is returned), *or* the upstream LLM "
            "provider returned a rate-limit error (`error_code: llm_rate_limited`). "
            "Respect the `Retry-After` response header. Only PRO tier has "
            "non-zero AI quota today — FREE and STANDARD callers will always "
            "hit the Tiddly variant."
        ),
    },
    502: {
        "model": AIErrorResponse,
        "description": (
            "LLM-side failure with two typed variants: `llm_parse_failed` "
            "(the provider returned a response that didn't match the "
            "expected structured-output schema) and `llm_connection_error` "
            "(could not reach the provider). Both are safe to retry — a "
            "different `model` often helps for parse failures."
        ),
    },
    503: {
        "model": AIErrorResponse,
        "description": "Unclassified LLM provider failure (`llm_unavailable`). Safe to retry.",
    },
    504: {
        "model": AIErrorResponse,
        "description": "LLM request timed out (`llm_timeout`). Safe to retry.",
    },
}

# BYOK authentication failure shows up on endpoints that actually use the
# BYOK key (validate-key + all suggestion endpoints). 422 is also the shape
# for Pydantic request validation, so the description covers both.
_BYOK_AUTH_422: dict[int | str, dict] = {
    422: {
        "description": (
            "Two possible shapes share this status: (1) FastAPI request "
            "validation errors (standard `{\"detail\": [...]}` array shape), "
            "or (2) BYOK authentication failure with the upstream LLM "
            "provider — shape `{\"detail\": \"...\", \"error_code\": "
            "\"llm_auth_failed\"}`. Clients can distinguish by the type of "
            "`detail` (list vs. string) or by the presence of `error_code`."
        ),
    },
}

# Suggestion endpoints surface all error classes (auth, consent, validation,
# LLM-call failures, BYOK auth failure).
AI_SUGGESTION_RESPONSES: dict[int | str, dict] = {
    **_BASE_AI_ERROR_RESPONSES,
    **_LLM_CALL_ERROR_RESPONSES,
    **_BYOK_AUTH_422,
}

# Config endpoints (/health, /models) surface only the shared base set plus
# the standard Pydantic validation error for 422. They never invoke an LLM.
AI_CONFIG_RESPONSES: dict[int | str, dict] = _BASE_AI_ERROR_RESPONSES

# /validate-key is a special case: it DOES call the LLM, but only to probe
# auth. Provider auth failures are returned as 200 {"valid": false} rather
# than 422, so the 422 variant is pure Pydantic validation here.
AI_VALIDATE_KEY_RESPONSES: dict[int | str, dict] = {
    **_BASE_AI_ERROR_RESPONSES,
    400: _LLM_CALL_ERROR_RESPONSES[400],
    429: _LLM_CALL_ERROR_RESPONSES[429],
    502: _LLM_CALL_ERROR_RESPONSES[502],
    503: _LLM_CALL_ERROR_RESPONSES[503],
    504: _LLM_CALL_ERROR_RESPONSES[504],
}


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def get_llm_api_key(
    x_llm_api_key: str | None = Header(
        None,
        alias="X-LLM-Api-Key",
        description=(
            "Optional Bring-Your-Own-Key (BYOK) header. Supplying this "
            "routes the call to the `AI_BYOK` rate-limit bucket and unlocks "
            "`model` selection. See the `ai` tag description for full BYOK "
            "semantics (platform vs. BYOK, model resolution, secret hygiene)."
        ),
    ),
) -> str | None:
    """Extract optional BYOK API key from request header."""
    return x_llm_api_key


def _resolve_config_or_400(
    llm_service: Any,
    use_case: AIUseCase,
    user_api_key: str | None,
    user_model: str | None,
) -> LLMConfig:
    """
    Wrapper around `LLMService.resolve_config` that converts the service's
    typed `UnsupportedModelError` into a 400 `HTTPException` with the
    unsupported-model message surfaced in `detail`.

    Intentionally does NOT catch bare `ValueError`: any other `ValueError`
    leaking from `resolve_config` (or code beneath it) represents a bug
    rather than bad client input, and should surface as a generic 500 with
    no internal message leaked to the caller.
    """
    try:
        return llm_service.resolve_config(
            use_case,
            user_api_key=user_api_key,
            user_model=user_model,
        )
    except UnsupportedModelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def apply_ai_rate_limit_byok(
    request: Request,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> None:
    """
    Enforce AI rate limiting for BYOK-only endpoints (e.g. validate-key).

    Returns early if no BYOK key is present (no quota consumed).
    """
    if not llm_api_key:
        return
    tier = get_tier_safely(current_user.tier)
    result = await check_rate_limit(current_user.id, OperationType.AI_BYOK, tier)
    request.state.rate_limit_info = {
        "limit": result.limit,
        "remaining": result.remaining,
        "reset": result.reset,
    }
    if not result.allowed:
        raise RateLimitExceededError(result)


async def apply_ai_rate_limit(
    request: Request,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> None:
    """
    Enforce AI rate limiting for suggestion endpoints.

    Selects AI_BYOK or AI_PLATFORM bucket based on BYOK header.
    All suggestion endpoints use this — every call consumes quota.
    """
    op_type = OperationType.AI_BYOK if llm_api_key else OperationType.AI_PLATFORM
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
# Config endpoints (no AI rate limit consumed)
# ---------------------------------------------------------------------------


@router.get(
    "/health",
    response_model=AIHealthResponse,
    responses=AI_CONFIG_RESPONSES,
    summary="AI availability and remaining quota",
)
async def ai_health(
    current_user: User | CachedUser = Depends(get_current_user_ai),
    limits: TierLimits = Depends(get_current_limits_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
) -> AIHealthResponse:
    """
    Return whether AI features are available for the caller, plus remaining
    per-minute and daily quota in the bucket that the supplied `X-LLM-Api-Key`
    header selects (present → `AI_BYOK`, absent → `AI_PLATFORM`).

    Does **not** consume quota of any kind — this endpoint skips the global
    read/write rate limiter AND does not charge the AI buckets. Safe to poll
    before each call to refresh quota-remaining UI.

    Tier note: AI quota today is `0/0` for FREE and STANDARD tiers. Only PRO
    tier has non-zero `AI_PLATFORM` (30/min, 500/day) and `AI_BYOK` (120/min,
    2000/day) limits. Non-PRO callers will see `available: false` unless they
    supply a BYOK key *and* their tier has non-zero BYOK quota (none today).
    """
    has_byok = llm_api_key is not None
    ai_bucket = OperationType.AI_BYOK if has_byok else OperationType.AI_PLATFORM
    quota = await get_ai_rate_limit_status(
        current_user.id, ai_bucket, get_tier_safely(current_user.tier),
    )
    # `available` requires BOTH windows non-zero for whichever bucket applies.
    # A tier with daily>0 but per-minute=0 would otherwise report available=True
    # yet always 429 on the first call — a real trap.
    platform_ok = limits.rate_ai_per_minute > 0 and limits.rate_ai_per_day > 0
    byok_ok = (
        has_byok
        and limits.rate_ai_byok_per_minute > 0
        and limits.rate_ai_byok_per_day > 0
    )
    return AIHealthResponse(
        available=platform_ok or byok_ok,
        byok=has_byok,
        remaining_per_minute=quota.remaining_per_minute,
        limit_per_minute=quota.limit_per_minute,
        remaining_daily=quota.remaining_per_day,
        limit_daily=quota.limit_per_day,
    )


@router.post(
    "/validate-key",
    response_model=ValidateKeyResponse,
    responses=AI_VALIDATE_KEY_RESPONSES,
    summary="Probe a BYOK key against the selected provider",
)
async def validate_key(
    body: ValidateKeyRequest = ValidateKeyRequest(),
    _current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit_byok),
) -> ValidateKeyResponse:
    """
    Confirm that the BYOK API key supplied in `X-LLM-Api-Key` is accepted by
    the provider implied by the request's `model` (or the default if no model
    is specified). Performs a minimal 5-token completion call against the
    provider.

    Requires `X-LLM-Api-Key`; returns 400 if the header is missing **without
    consuming quota** (the rate-limit dependency short-circuits when no BYOK
    key is present).

    **Response semantics:**

    - `200 {"valid": true}` — provider accepted the key.
    - `200 {"valid": false, "error": "API key rejected by provider"}` —
      provider returned an authentication error. The 200 status reflects
      that the validation *request* succeeded; the key itself is simply
      invalid. Note this is **not** surfaced as 422 `llm_auth_failed` —
      that's the semantics on suggestion endpoints where the caller
      expects the key to work; here it's the endpoint's explicit purpose.
    - Non-200 responses (see **Responses**) indicate a failure of the
      validation process itself, not of the key.

    **Authentication, rate limits, BYOK, and error handling**: see the `ai`
    tag description at the top of this section.
    """
    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No API key provided via X-LLM-Api-Key header")

    llm_service = get_llm_service()
    config = _resolve_config_or_400(
        llm_service, AIUseCase.SUGGESTIONS, llm_api_key, body.model,
    )
    try:
        await llm_service.complete(
            messages=[{"role": "user", "content": "This is a test. Respond with 'ok'."}],
            config=config,
            max_tokens=5,
            temperature=0,
        )
        return ValidateKeyResponse(valid=True)
    except AuthenticationError:
        return ValidateKeyResponse(valid=False, error="API key rejected by provider")


@router.get(
    "/models",
    response_model=AIModelsResponse,
    responses=AI_CONFIG_RESPONSES,
    summary="List supported models and per-use-case defaults",
)
async def ai_models(
    _current_user: User | CachedUser = Depends(get_current_user_ai),
) -> AIModelsResponse:
    """
    Return the curated list of supported model IDs (for use as the `model` field
    on BYOK suggestion requests) plus the server's current per-use-case default
    model IDs.

    Only GA models appear here — preview/experimental models are excluded. The
    list changes with LiteLLM version bumps and operational decisions (e.g. the
    Gemini Flash / Pro entries are deliberately omitted due to chronic 503s
    from Google's API).

    Does **not** consume quota of any kind — this endpoint skips the global
    read/write rate limiter AND does not charge the AI buckets. Authentication
    and consent checks still apply.
    """
    llm_service = get_llm_service()
    return AIModelsResponse(
        models=llm_service.supported_models,
        defaults={
            uc.value: llm_service.get_model_for_use_case(uc)
            for uc in AIUseCase
        },
    )


# ---------------------------------------------------------------------------
# Suggestion endpoints (consume AI rate limit)
# ---------------------------------------------------------------------------


@router.post(
    "/suggest-tags",
    response_model=SuggestTagsResponse,
    responses=AI_SUGGESTION_RESPONSES,
    summary="Suggest tags for a bookmark, note, or prompt",
)
async def suggest_tags_endpoint(
    data: SuggestTagsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
    db: AsyncSession = Depends(get_async_session),
) -> SuggestTagsResponse:
    """
    Suggest tags for an item based on its metadata and the caller's tag
    vocabulary.

    The server loads the caller's top 100 most-used tags (with usage counts)
    and passes them to the LLM as preferred-vocabulary context. The LLM is
    then prompted with the entity's `title`, `url`, `description`, and
    `content_snippet` and asked to return a small set of tags — preferring
    existing vocabulary over novel ones. Tags already in `current_tags` are
    excluded from the response.

    **Authentication, rate limits, BYOK, and error handling**: see the `ai`
    tag description at the top of this section.
    """
    llm_service = get_llm_service()
    config = _resolve_config_or_400(
        llm_service, AIUseCase.SUGGESTIONS, llm_api_key, data.model,
    )

    # Load user's tag vocabulary sorted by frequency (up to 100 with counts)
    # NOTE: Eval test data mirrors this structure — update evals/ai_suggestions/
    # config_suggest_tags.yaml if you change the number of entries or fields fetched.
    tag_counts = await get_user_tags_with_counts(db, current_user.id)
    tag_vocabulary = [
        TagVocabularyEntry(name=tc.name, count=tc.content_count)
        for tc in tag_counts[:100]
    ]

    start = time.monotonic()
    try:
        tags, cost = await suggest_tags(
            title=data.title,
            url=data.url,
            description=data.description,
            content_snippet=data.content_snippet,
            content_type=data.content_type,
            current_tags=data.current_tags,
            tag_vocabulary=tag_vocabulary,
            llm_service=llm_service,
            config=config,
        )
    except LLMResponseParseError as exc:
        await _handle_parse_error(exc, start=start, user_id=current_user.id, config=config)
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id, use_case=AIUseCase.SUGGESTIONS,
        model=config.model, key_source=config.key_source,
        cost=cost, latency_ms=latency_ms,
    )

    return SuggestTagsResponse(tags=tags)


@router.post(
    "/suggest-metadata",
    response_model=SuggestMetadataResponse,
    responses=AI_SUGGESTION_RESPONSES,
    summary="Suggest title and/or description for an item",
)
async def suggest_metadata_endpoint(
    data: SuggestMetadataRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
) -> SuggestMetadataResponse:
    """
    Generate a title, description, or both — optionally using existing values
    as context.

    **`fields` semantics** (important).

    - `fields` lists the fields the caller wants the LLM to *generate*.
    - Any `title` / `description` values present in the request that are *not*
      in `fields` are used as **LLM context only** — they shape the output but
      are not returned in the response.
    - Fields omitted from `fields` are returned as `null`.

    Example: to regenerate only the description while keeping an existing title
    as grounding context, pass `fields: ["description"]` with the current
    `title` value. The response's `title` field will be `null`.

    **Authentication, rate limits, BYOK, and error handling**: see the `ai`
    tag description at the top of this section.
    """
    llm_service = get_llm_service()
    config = _resolve_config_or_400(
        llm_service, AIUseCase.SUGGESTIONS, llm_api_key, data.model,
    )

    start = time.monotonic()
    try:
        result, cost = await suggest_metadata(
            fields=data.fields,
            url=data.url,
            title=data.title,
            description=data.description,
            content_snippet=data.content_snippet,
            llm_service=llm_service,
            config=config,
        )
    except LLMResponseParseError as exc:
        await _handle_parse_error(exc, start=start, user_id=current_user.id, config=config)
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id, use_case=AIUseCase.SUGGESTIONS,
        model=config.model, key_source=config.key_source,
        cost=cost, latency_ms=latency_ms,
    )

    return SuggestMetadataResponse(title=result.title, description=result.description)


@router.post(
    "/suggest-relationships",
    response_model=SuggestRelationshipsResponse,
    responses=AI_SUGGESTION_RESPONSES,
    summary="Suggest related items for a source entity",
)
async def suggest_relationships_endpoint(
    data: SuggestRelationshipsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
    db: AsyncSession = Depends(get_async_session),
) -> SuggestRelationshipsResponse:
    """
    Find candidate items in the caller's library that are conceptually related
    to the source entity, then have the LLM filter to the most relevant subset.

    **Two-phase design.** First, a full-text / tag search runs server-side
    across the caller's bookmarks, notes, and prompts to gather candidates
    (see `_search_relationship_candidates` — FTS over title+description +
    recency-ranked tag match, deduplicated). Then the candidates + the
    source entity's metadata are sent to the LLM, which judges which
    candidates are actually relevant.

    **LLM-skip cases** (quota is still consumed — the rate limit runs as a
    FastAPI dependency *before* the handler body):

    - If all of `title`, `description`, and `current_tags` are empty → returns
      `{"candidates": []}` without calling the LLM.
    - If the candidate search returns no matches → returns `{"candidates": []}`
      without calling the LLM.

    In both cases, `X-RateLimit-Remaining` will decrement by one even though
    no provider cost is incurred. Use `GET /ai/health` to check quota before
    triggering batches.

    Use `source_id` (when the source already exists in the DB) to exclude the
    source from its own candidate pool. Use `existing_relationship_ids` to
    exclude items already linked so the response only surfaces *new* potential
    relationships.

    **Authentication, rate limits, BYOK, and error handling**: see the `ai`
    tag description at the top of this section.
    """
    if not data.title and not data.description and not data.current_tags:
        return SuggestRelationshipsResponse(candidates=[])

    candidates = await _search_relationship_candidates(db, current_user.id, data)

    if not candidates:
        return SuggestRelationshipsResponse(candidates=[])

    llm_service = get_llm_service()
    config = _resolve_config_or_400(
        llm_service, AIUseCase.SUGGESTIONS, llm_api_key, data.model,
    )

    start = time.monotonic()
    try:
        filtered, cost = await suggest_relationships(
            title=data.title,
            url=data.url,
            description=data.description,
            content_snippet=data.content_snippet,
            candidates=candidates,
            llm_service=llm_service,
            config=config,
        )
    except LLMResponseParseError as exc:
        await _handle_parse_error(exc, start=start, user_id=current_user.id, config=config)
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id, use_case=AIUseCase.SUGGESTIONS,
        model=config.model, key_source=config.key_source,
        cost=cost, latency_ms=latency_ms,
    )

    return SuggestRelationshipsResponse(candidates=filtered)


@router.post(
    "/suggest-arguments",
    response_model=SuggestArgumentsResponse,
    responses=AI_SUGGESTION_RESPONSES,
    summary="Suggest prompt template arguments (name/description)",
)
async def suggest_arguments_endpoint(
    data: SuggestArgumentsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
) -> SuggestArgumentsResponse:
    """
    Suggest argument definitions for a prompt template.

    **Generate-all mode** (`target_index: null`) — the server parses
    `prompt_content` for Jinja2 placeholders, skips any already declared in
    `arguments`, and returns a list of new `{name, description, required}`
    entries for the remaining placeholders. If `prompt_content` is empty or
    all placeholders are already declared, returns `[]` **without calling
    the LLM** (quota is still consumed — rate-limit runs before the handler).

    **Individual mode** (`target_index: N`) — refines the entry at
    `arguments[N]` based on which field is missing:

    - `name` empty, `description` present → LLM generates a name.
    - `description` empty, `name` present → LLM generates a description.
    - Both empty → returns `[]` **without calling the LLM** (quota still
      consumed). The LLM needs at least one field as grounding context.

    Service-layer `ValueError`s (e.g. `target_index` out of range) map to a
    400 response with the validation message in `detail`.

    **Authentication, rate limits, BYOK, and error handling**: see the `ai`
    tag description at the top of this section.
    """
    llm_service = get_llm_service()
    config = _resolve_config_or_400(
        llm_service, AIUseCase.SUGGESTIONS, llm_api_key, data.model,
    )

    start = time.monotonic()
    try:
        valid_args, cost = await suggest_arguments(
            prompt_content=data.prompt_content,
            arguments=data.arguments,
            target_index=data.target_index,
            llm_service=llm_service,
            config=config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMResponseParseError as exc:
        await _handle_parse_error(exc, start=start, user_id=current_user.id, config=config)
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id, use_case=AIUseCase.SUGGESTIONS,
        model=config.model, key_source=config.key_source,
        cost=cost, latency_ms=latency_ms,
    )

    return SuggestArgumentsResponse(arguments=valid_args)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _handle_parse_error(
    exc: LLMResponseParseError,
    *,
    start: float,
    user_id: UUID,
    config: LLMConfig,
) -> NoReturn:
    """Track cost from failed LLM parse and raise `LLMParseFailedError` → 502."""
    latency_ms = int((time.monotonic() - start) * 1000)
    try:
        await track_cost(
            user_id=user_id, use_case=AIUseCase.SUGGESTIONS,
            model=config.model, key_source=config.key_source,
            cost=exc.cost, latency_ms=latency_ms,
        )
    except Exception:
        logger.warning("track_cost_failed_on_parse_error")
    raise LLMParseFailedError(
        "LLM returned an invalid response. Try again or use a different model.",
    ) from exc


async def _search_relationship_candidates(
    db: AsyncSession,
    user_id: int,
    data: SuggestRelationshipsRequest,
) -> list[RelationshipCandidateContext]:
    """Search for relationship candidates by title+description and tags, deduped."""
    # Search by title+description (relevance-ranked) then tags (recency-ranked).
    search_results: list[tuple] = []
    query_parts = [p for p in (data.title, data.description) if p]
    if query_parts:
        query = " ".join(query_parts)
        search_results.append(await search_all_content(
            db=db, user_id=user_id, query=query,
            sort_by="relevance", limit=10,
        ))
    if data.current_tags:
        search_results.append(await search_all_content(
            db=db, user_id=user_id, tags=data.current_tags,
            tag_match="any", sort_by="updated_at", limit=10,
        ))

    # Dedup by ID, title results first (highest signal)
    exclude_ids = set(data.existing_relationship_ids)
    if data.source_id:
        exclude_ids.add(data.source_id)
    seen_ids: set[str] = set()
    candidates: list[RelationshipCandidateContext] = []
    for items, _total in search_results:
        for item in items:
            item_id = str(item.id)
            if item_id in exclude_ids or item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            candidates.append(RelationshipCandidateContext(
                entity_id=item_id,
                entity_type=item.type,
                title=item.title or "",
                description=item.description or "",
                content_preview=item.content_preview or "",
            ))
            if len(candidates) >= 10:
                break
        if len(candidates) >= 10:
            break
    return candidates


