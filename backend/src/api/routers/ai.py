"""AI feature endpoints."""
import logging
import time
from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from litellm.exceptions import AuthenticationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_limits_ai, get_current_user_ai
from core.rate_limit_config import OperationType, RateLimitExceededError
from core.rate_limiter import check_rate_limit, get_ai_rate_limit_status
from core.tier_limits import TierLimits, get_tier_safely
from db.session import get_async_session
from models.user import User
from schemas.ai import (
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
# Dependencies
# ---------------------------------------------------------------------------


def get_llm_api_key(request: Request) -> str | None:
    """Extract optional BYOK API key from request header."""
    return request.headers.get("X-LLM-Api-Key")


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
    body: ValidateKeyRequest = ValidateKeyRequest(),
    _current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit_byok),
) -> dict:
    """Validate a BYOK API key by making a minimal provider call."""
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


# ---------------------------------------------------------------------------
# Suggestion endpoints (consume AI rate limit)
# ---------------------------------------------------------------------------


@router.post("/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_tags_endpoint(
    data: SuggestTagsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
    db: AsyncSession = Depends(get_async_session),
) -> SuggestTagsResponse:
    """Suggest tags for an item based on its metadata and the user's tag vocabulary."""
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


@router.post("/suggest-metadata", response_model=SuggestMetadataResponse)
async def suggest_metadata_endpoint(
    data: SuggestMetadataRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
) -> SuggestMetadataResponse:
    """
    Suggest title and/or description for an item.

    The `fields` parameter controls which fields are generated.
    Existing values for non-requested fields are used as context.
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


@router.post("/suggest-relationships", response_model=SuggestRelationshipsResponse)
async def suggest_relationships_endpoint(
    data: SuggestRelationshipsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
    db: AsyncSession = Depends(get_async_session),
) -> SuggestRelationshipsResponse:
    """Suggest related items by searching for candidates and asking the LLM to judge relevance."""
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


@router.post("/suggest-arguments", response_model=SuggestArgumentsResponse)
async def suggest_arguments_endpoint(
    data: SuggestArgumentsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
) -> SuggestArgumentsResponse:
    """Suggest prompt arguments based on template content."""
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


