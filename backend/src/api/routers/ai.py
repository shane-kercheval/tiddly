"""AI feature endpoints."""
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from litellm.exceptions import AuthenticationError
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_limits_ai, get_current_user_ai
from core.rate_limit_config import OperationType, RateLimitExceededError
from core.rate_limiter import check_rate_limit, get_ai_rate_limit_status
from core.tier_limits import TierLimits, get_tier_safely
from db.session import get_async_session
from models.user import User
from schemas.ai import (
    SuggestArgumentsRequest,
    SuggestArgumentsResponse,
    SuggestMetadataRequest,
    SuggestMetadataResponse,
    SuggestRelationshipsRequest,
    SuggestRelationshipsResponse,
    SuggestTagsRequest,
    SuggestTagsResponse,
)
from schemas.cached_user import CachedUser
from schemas.validators import validate_argument_name
from services.ai_cost_tracking import track_cost
from services.content_service import search_all_content
from services.llm_prompts import (
    build_argument_suggestion_messages,
    build_metadata_suggestion_messages,
    build_relationship_suggestion_messages,
    build_tag_suggestion_messages,
    extract_template_placeholders,
)
from services.llm_service import (
    AIUseCase,
    get_llm_service,
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
    _current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit_byok),
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_llm_response(response: object, response_model: type) -> object:
    """
    Parse LLM response content as a Pydantic model.

    Raises HTTPException(502) if the LLM returned invalid JSON/schema,
    so the user gets a clear 'llm_invalid_response' error instead of a 500.
    """
    try:
        return response_model.model_validate_json(
            response.choices[0].message.content,
        )
    except ValidationError as exc:
        logger.warning(
            "llm_invalid_response",
            extra={
                "model": getattr(response, "model", "unknown"),
                "content_preview": (response.choices[0].message.content or "")[:200],
                "validation_errors": str(exc),
            },
        )
        raise HTTPException(
            status_code=502,
            detail="LLM returned an invalid response. Try again or use a different model.",
        ) from exc


# ---------------------------------------------------------------------------
# Suggestion endpoints (consume AI rate limit)
# ---------------------------------------------------------------------------


@router.post("/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_tags(
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

    # Load user's tag vocabulary sorted by frequency
    tag_counts = await get_user_tags_with_counts(db, current_user.id)
    tag_vocabulary = [tc.name for tc in tag_counts]

    # Load few-shot examples: items sharing current_tags, or recent items
    few_shot_examples = await _get_few_shot_examples(
        db, current_user.id, data.current_tags,
    )

    messages = build_tag_suggestion_messages(
        title=data.title,
        url=data.url,
        description=data.description,
        content_snippet=data.content_snippet,
        tag_vocabulary=tag_vocabulary,
        few_shot_examples=few_shot_examples,
    )

    start = time.monotonic()
    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestTagsResponse,
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id,
        use_case=AIUseCase.SUGGESTIONS,
        model=config.model,
        key_source=config.key_source,
        cost=cost,
        latency_ms=latency_ms,
    )

    parsed = _parse_llm_response(response, SuggestTagsResponse)

    # Server-side deduplication (case-insensitive)
    current_lower = {t.lower() for t in data.current_tags}
    filtered_tags = [t for t in parsed.tags if t.lower() not in current_lower]

    return SuggestTagsResponse(tags=filtered_tags)


@router.post("/suggest-metadata", response_model=SuggestMetadataResponse)
async def suggest_metadata(
    data: SuggestMetadataRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
) -> SuggestMetadataResponse:
    """Suggest title and description for an item."""
    llm_service = get_llm_service()
    config = llm_service.resolve_config(
        AIUseCase.SUGGESTIONS, user_api_key=llm_api_key, user_model=data.model,
    )

    messages = build_metadata_suggestion_messages(
        url=data.url,
        title=data.title,
        content_snippet=data.content_snippet,
    )

    start = time.monotonic()
    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestMetadataResponse,
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id,
        use_case=AIUseCase.SUGGESTIONS,
        model=config.model,
        key_source=config.key_source,
        cost=cost,
        latency_ms=latency_ms,
    )

    return _parse_llm_response(response, SuggestMetadataResponse)


@router.post("/suggest-relationships", response_model=SuggestRelationshipsResponse)
async def suggest_relationships(
    data: SuggestRelationshipsRequest,
    current_user: User | CachedUser = Depends(get_current_user_ai),
    llm_api_key: str | None = Depends(get_llm_api_key),
    _rate_limit: None = Depends(apply_ai_rate_limit),
    db: AsyncSession = Depends(get_async_session),
) -> SuggestRelationshipsResponse:
    """Suggest related items by searching for candidates and asking the LLM to judge relevance."""
    if not data.title and not data.current_tags:
        return SuggestRelationshipsResponse(candidates=[])

    # Search by title (relevance-ranked) then tags (recency-ranked), sequentially.
    # Two orthogonal signals: text similarity + topical grouping.
    search_results: list[tuple] = []
    if data.title:
        search_results.append(await search_all_content(
            db=db, user_id=current_user.id, query=data.title,
            sort_by="relevance", limit=10,
        ))
    if data.current_tags:
        search_results.append(await search_all_content(
            db=db, user_id=current_user.id, tags=data.current_tags,
            tag_match="any", sort_by="updated_at", limit=10,
        ))

    # Dedup by ID, title results first (highest signal)
    exclude_ids = set(data.existing_relationship_ids)
    if data.source_id:
        exclude_ids.add(data.source_id)
    seen_ids: set[str] = set()
    candidates = []
    for items, _total in search_results:
        for item in items:
            item_id = str(item.id)
            if item_id in exclude_ids or item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            candidates.append({
                "entity_id": item_id,
                "entity_type": item.type,
                "title": item.title or "",
                "description": (item.description or "")[:200],
                "content_preview": (item.content_preview or "")[:200],
            })
            if len(candidates) >= 10:
                break
        if len(candidates) >= 10:
            break

    if not candidates:
        return SuggestRelationshipsResponse(candidates=[])

    llm_service = get_llm_service()
    config = llm_service.resolve_config(
        AIUseCase.SUGGESTIONS, user_api_key=llm_api_key, user_model=data.model,
    )

    messages = build_relationship_suggestion_messages(
        source_title=data.title,
        source_url=data.url,
        source_description=data.description,
        source_content_snippet=data.content_snippet,
        candidates=candidates,
    )

    start = time.monotonic()
    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestRelationshipsResponse,
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id,
        use_case=AIUseCase.SUGGESTIONS,
        model=config.model,
        key_source=config.key_source,
        cost=cost,
        latency_ms=latency_ms,
    )

    parsed = _parse_llm_response(response, SuggestRelationshipsResponse)

    # Only return candidates that were in our search results
    valid_ids = {c["entity_id"] for c in candidates}
    filtered = [c for c in parsed.candidates if c.entity_id in valid_ids]

    return SuggestRelationshipsResponse(candidates=filtered)


@router.post("/suggest-arguments", response_model=SuggestArgumentsResponse)
async def suggest_arguments(
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

    existing_args = [
        {"name": a.name, "description": a.description}
        for a in data.arguments
    ]

    # For "generate all", extract placeholders deterministically from template
    placeholder_names = None
    if data.target is None and data.prompt_content:
        all_placeholders = extract_template_placeholders(data.prompt_content)
        existing_names = {
            (a["name"] or "").lower()
            for a in existing_args
            if a.get("name")
        }
        placeholder_names = [
            p for p in all_placeholders if p.lower() not in existing_names
        ]
        if not placeholder_names:
            return SuggestArgumentsResponse(arguments=[])

    messages = build_argument_suggestion_messages(
        prompt_content=data.prompt_content,
        existing_arguments=existing_args,
        target=data.target,
        placeholder_names=placeholder_names,
    )

    start = time.monotonic()
    response, cost = await llm_service.complete(
        messages=messages,
        config=config,
        response_format=SuggestArgumentsResponse,
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    await track_cost(
        user_id=current_user.id,
        use_case=AIUseCase.SUGGESTIONS,
        model=config.model,
        key_source=config.key_source,
        cost=cost,
        latency_ms=latency_ms,
    )

    parsed = _parse_llm_response(response, SuggestArgumentsResponse)

    # Filter out arguments with invalid names
    valid_args = []
    for arg in parsed.arguments:
        try:
            validated_name = validate_argument_name(arg.name)
            valid_args.append(
                type(arg).model_validate({
                    "name": validated_name,
                    "description": arg.description,
                }),
            )
        except ValueError:
            logger.debug("filtered_invalid_argument_name", extra={"name": arg.name})

    return SuggestArgumentsResponse(arguments=valid_args)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_few_shot_examples(
    db: AsyncSession,
    user_id: int,
    current_tags: list[str],
) -> list[dict]:
    """
    Get recent items for few-shot examples in tag suggestion prompts.

    If current_tags are provided, finds items sharing those tags.
    Otherwise falls back to the user's most recently updated items.
    """
    if current_tags:
        items, _total = await search_all_content(
            db=db,
            user_id=user_id,
            tags=current_tags,
            tag_match="any",
            sort_by="updated_at",
            sort_order="desc",
            limit=5,
        )
    else:
        items, _total = await search_all_content(
            db=db,
            user_id=user_id,
            sort_by="updated_at",
            sort_order="desc",
            limit=5,
        )

    return [
        {
            "title": item.title or "",
            "description": item.description or "",
            "tags": item.tags or [],
        }
        for item in items
    ]
