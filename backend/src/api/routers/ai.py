"""AI feature endpoints."""
import logging
import time
from typing import NoReturn
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
    get_llm_service,
)
from services.suggestion_service import (
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
        "description": "Missing or invalid Auth0 JWT / Personal Access Token.",
    },
    451: {
        "model": AIErrorResponse,
        "description": (
            "User has not accepted current privacy policy / terms of service. "
            "Direct the user to accept via the web UI before retrying."
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
            "Invalid request. Common causes: payload field exceeds max length "
            "(`FIELD_LIMIT_EXCEEDED`), LLM provider rejected the request shape "
            "(`llm_bad_request`), or the supplied `model` is not in the supported list."
        ),
    },
    422: {
        "model": AIErrorResponse,
        "description": (
            "Request validation failed (Pydantic / FastAPI), *or* the BYOK key in "
            "`X-LLM-Api-Key` was rejected by the provider (`llm_auth_failed`). "
            "For BYOK auth failures the response includes `error_code: llm_auth_failed`."
        ),
    },
    429: {
        "model": AIErrorResponse,
        "description": (
            "Tiddly per-tier AI rate limit exceeded *or* the upstream LLM provider "
            "returned a rate-limit error (`llm_rate_limited`). Respect the "
            "`Retry-After` response header. Only PRO tier has non-zero AI quota today — "
            "FREE and STANDARD callers always hit this."
        ),
    },
    502: {
        "model": AIErrorResponse,
        "description": (
            "LLM returned an unparseable response (prompt structured-output check "
            "failed) or the provider connection failed (`llm_connection_error`). "
            "Safe to retry, ideally with a different model."
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

# Suggestion + validate-key endpoints surface all error classes.
AI_SUGGESTION_RESPONSES: dict[int | str, dict] = {
    **_BASE_AI_ERROR_RESPONSES,
    **_LLM_CALL_ERROR_RESPONSES,
}

# Config endpoints only surface auth + consent errors.
AI_CONFIG_RESPONSES: dict[int | str, dict] = _BASE_AI_ERROR_RESPONSES


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def get_llm_api_key(
    x_llm_api_key: str | None = Header(
        None,
        alias="X-LLM-Api-Key",
        description=(
            "Optional Bring-Your-Own-Key (BYOK) header. When supplied, the AI endpoint "
            "uses this key against the matching provider instead of the platform key. "
            "BYOK calls consume the `AI_BYOK` rate-limit bucket (separate from "
            "`AI_PLATFORM`) and allow selection of any supported `model` from "
            "`GET /ai/models`. Platform calls (header omitted) are locked to the "
            "use-case default model. The key is held in request memory only — never "
            "logged, stored, or returned in error responses."
        ),
    ),
) -> str | None:
    """Extract optional BYOK API key from request header."""
    return x_llm_api_key


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
    Return whether AI features are available for the caller, plus remaining daily
    quota in the bucket that the supplied `X-LLM-Api-Key` header selects (present
    → `AI_BYOK`, absent → `AI_PLATFORM`).

    Does **not** consume AI rate-limit quota — safe to poll before each call to
    update quota-remaining UI. Subject to the normal per-user read rate limit.

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
    return AIHealthResponse(
        available=limits.rate_ai_per_day > 0 or (has_byok and limits.rate_ai_byok_per_day > 0),
        byok=has_byok,
        remaining_daily=quota.remaining,
        limit_daily=quota.limit,
    )


@router.post(
    "/validate-key",
    response_model=ValidateKeyResponse,
    responses=AI_SUGGESTION_RESPONSES,
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

    **Authentication:** requires a Tiddly token *and* an `X-LLM-Api-Key` header.
    Returns 400 if the BYOK header is missing.

    **Rate limit:** consumes the `AI_BYOK` bucket. Platform callers cannot use
    this endpoint — there's nothing to validate without a user-supplied key.

    **Response semantics:**

    - `200 {"valid": true}` — provider accepted the key.
    - `200 {"valid": false, "error": "API key rejected by provider"}` — provider
      returned an authentication error. The 200 status reflects that the
      validation *request* succeeded; the key itself is simply invalid.
    - Non-200 responses (see **Responses**) indicate a failure of the
      validation process itself, not of the key.
    """
    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No API key provided via X-LLM-Api-Key header")

    llm_service = get_llm_service()
    try:
        config = llm_service.resolve_config(
            AIUseCase.SUGGESTIONS,
            user_api_key=llm_api_key,
            user_model=body.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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

    Does **not** consume AI rate-limit quota. Subject to the normal per-user
    read rate limit.
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

    **How it works.** The server loads the caller's top ~100 most-used tags
    (with their usage counts) and passes them to the LLM as preferred-vocabulary
    context. The LLM is then prompted with the entity's `title`, `url`,
    `description`, and `content_snippet` and asked to return a small set of tags
    — preferring existing vocabulary over novel ones. Tags already in
    `current_tags` are excluded from the response.

    **Authentication.** Auth0 JWT or Personal Access Token. Optionally supply
    `X-LLM-Api-Key` to use your own provider key (BYOK).

    **Rate limit.** Consumes the `AI_PLATFORM` bucket if no BYOK key is
    supplied, otherwise `AI_BYOK`. Both buckets are zero on FREE and STANDARD
    tiers; only PRO has non-zero AI quota. Check `GET /ai/health` for remaining
    quota; respect the `X-RateLimit-*` response headers on successful calls
    and the `Retry-After` header on 429 responses.

    **Model selection.** BYOK callers may pass `model` (any ID from
    `GET /ai/models`). Platform callers have `model` silently ignored and are
    locked to the `suggestions` default model.

    **Errors.** See the Responses section for the full list — typed error
    codes include `llm_auth_failed` (invalid BYOK key), `llm_rate_limited`
    (provider throttle), `llm_timeout`, `llm_connection_error`, `llm_bad_request`,
    `llm_unavailable`, `FIELD_LIMIT_EXCEEDED`.
    """
    llm_service = get_llm_service()
    config = llm_service.resolve_config(
        AIUseCase.SUGGESTIONS, user_api_key=llm_api_key, user_model=data.model,
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

    **Authentication.** Auth0 JWT or PAT, with optional `X-LLM-Api-Key` for BYOK.

    **Rate limit.** Consumes `AI_PLATFORM` or `AI_BYOK` (PRO-tier only today).

    **Model selection.** BYOK callers may pass `model`; platform callers are
    locked to the `suggestions` use-case default (silently ignored if supplied).
    """
    llm_service = get_llm_service()
    config = llm_service.resolve_config(
        AIUseCase.SUGGESTIONS, user_api_key=llm_api_key, user_model=data.model,
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
    across the caller's bookmarks, notes, and prompts to gather candidates.
    Then the candidates + the source entity's metadata are sent to the LLM,
    which judges which candidates are actually relevant.

    **Early returns (no quota consumed):**

    - If all of `title`, `description`, and `current_tags` are empty → returns
      `{"candidates": []}` without calling the LLM.
    - If the candidate search returns no matches → returns `{"candidates": []}`
      without calling the LLM.

    Use `source_id` (when the source already exists in the DB) to exclude the
    source from its own candidate pool. Use `existing_relationship_ids` to
    exclude items already linked so the response only surfaces *new* potential
    relationships.

    **Authentication.** Auth0 JWT or PAT, with optional `X-LLM-Api-Key` for BYOK.

    **Rate limit.** Consumes `AI_PLATFORM` or `AI_BYOK` *only* when the LLM is
    actually called (not in the early-return cases above).

    **Model selection.** BYOK callers may pass `model`; platform callers are
    locked to the `suggestions` default.
    """
    if not data.title and not data.description and not data.current_tags:
        return SuggestRelationshipsResponse(candidates=[])

    candidates = await _search_relationship_candidates(db, current_user.id, data)

    if not candidates:
        return SuggestRelationshipsResponse(candidates=[])

    llm_service = get_llm_service()
    config = llm_service.resolve_config(
        AIUseCase.SUGGESTIONS, user_api_key=llm_api_key, user_model=data.model,
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

    Two modes:

    **Generate-all mode** (`target_index: null`) — the server parses
    `prompt_content` for Jinja2 placeholders, skips any already declared in
    `arguments`, and returns a list of new `{name, description, required}`
    entries for the remaining placeholders.

    **Individual mode** (`target_index: N`) — refines the entry at
    `arguments[N]`. The server inspects that entry and picks which field to
    suggest based on which is missing: if `name` is empty, a name is generated
    from the description; if `description` is empty (or both are empty), a
    description is generated from the name (or placeholder). Returns a
    single-element list.

    A `ValueError` from the service (e.g. `target_index` out of range,
    `prompt_content` missing when required, malformed template) maps to a
    400 response with the validation message in `detail`.

    **Authentication.** Auth0 JWT or PAT, with optional `X-LLM-Api-Key` for BYOK.

    **Rate limit.** Consumes `AI_PLATFORM` or `AI_BYOK` (PRO-tier only today).

    **Model selection.** BYOK callers may pass `model`; platform callers are
    locked to the `suggestions` default.
    """
    llm_service = get_llm_service()
    config = llm_service.resolve_config(
        AIUseCase.SUGGESTIONS, user_api_key=llm_api_key, user_model=data.model,
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
    """Track cost from failed LLM parse and raise HTTP 502."""
    latency_ms = int((time.monotonic() - start) * 1000)
    try:
        await track_cost(
            user_id=user_id, use_case=AIUseCase.SUGGESTIONS,
            model=config.model, key_source=config.key_source,
            cost=exc.cost, latency_ms=latency_ms,
        )
    except Exception:
        logger.warning("track_cost_failed_on_parse_error")
    raise HTTPException(
        status_code=502,
        detail="LLM returned an invalid response. Try again or use a different model.",
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


