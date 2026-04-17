"""
Redis-based rate limiting enforcement.

This module contains the enforcement logic - the "how" of rate limiting.
For configuration (limits, sensitive endpoints), see rate_limit_config.py.
"""
import logging
import time
import uuid
from dataclasses import dataclass

from core.rate_limit_config import (
    OperationType,
    RateLimitConfig,
    RateLimitResult,
)
from core.redis import get_redis_client
from core.tier_limits import Tier, get_tier_limits


@dataclass
class AIRateLimitStatus:
    """
    Combined per-minute and per-day view of an AI rate-limit bucket.

    Returned by `get_ai_rate_limit_status` — read-only, does not consume quota.
    """

    limit_per_minute: int
    remaining_per_minute: int
    limit_per_day: int
    remaining_per_day: int

    @property
    def allowed(self) -> bool:
        """True when both per-minute and per-day quotas have headroom."""
        return self.remaining_per_minute > 0 and self.remaining_per_day > 0

logger = logging.getLogger(__name__)

# Maps operation types to their daily Redis key pool name.
# Shared between check_rate_limit and get_ai_rate_limit_status.
_DAILY_POOL_MAP: dict[OperationType, str] = {
    OperationType.READ: "general",
    OperationType.WRITE: "general",
    OperationType.SENSITIVE: "sensitive",
    OperationType.AI_PLATFORM: "ai_platform",
    OperationType.AI_BYOK: "ai_byok",
}


async def check_rate_limit(
    user_id: int,
    operation_type: OperationType,
    tier: Tier,
) -> RateLimitResult:
    """
    Check if request is allowed and return full rate limit info.

    Limits are tier-based. All auth types (PAT, Auth0) share the same
    rate limit bucket per user.

    Returns RateLimitResult with allowed status and header values.
    Falls back to allowing requests if Redis is unavailable.
    """
    limits = get_tier_limits(tier)

    if operation_type == OperationType.READ:
        config = RateLimitConfig(limits.rate_read_per_minute, limits.rate_read_per_day)
    elif operation_type == OperationType.WRITE:
        config = RateLimitConfig(limits.rate_write_per_minute, limits.rate_write_per_day)
    elif operation_type == OperationType.SENSITIVE:
        config = RateLimitConfig(limits.rate_sensitive_per_minute, limits.rate_sensitive_per_day)
    elif operation_type == OperationType.AI_PLATFORM:
        config = RateLimitConfig(limits.rate_ai_per_minute, limits.rate_ai_per_day)
    elif operation_type == OperationType.AI_BYOK:
        config = RateLimitConfig(limits.rate_ai_byok_per_minute, limits.rate_ai_byok_per_day)
    else:
        raise ValueError(f"Unknown operation type: {operation_type}")

    # Short-circuit for zero limits (e.g. FREE/STANDARD AI) — no Redis needed
    if config.requests_per_minute == 0 or config.requests_per_day == 0:
        return RateLimitResult(
            allowed=False,
            limit=0,
            remaining=0,
            reset=0,
            retry_after=0,
        )

    redis_client = get_redis_client()
    if redis_client is None or not redis_client.is_connected:
        logger.warning("redis_unavailable", extra={"operation": "rate_limit"})
        return RateLimitResult(
            allowed=True,
            limit=config.requests_per_minute,
            remaining=config.requests_per_minute,
            reset=0,
            retry_after=0,
        )

    now = int(time.time())

    # Check minute limit (sliding window for precision)
    minute_key = f"rate:{user_id}:{operation_type.value}:min"
    minute_result = await _check_sliding_window(
        minute_key, config.requests_per_minute, 60, now,
    )
    if not minute_result.allowed:
        logger.warning(
            "rate_limit_exceeded",
            extra={
                "user_id": user_id,
                "operation": operation_type.value,
                "tier": tier.value,
                "limit_type": "per_minute",
            },
        )
        return minute_result

    # Check daily limit (fixed window - simpler, lower memory)
    daily_pool = _DAILY_POOL_MAP[operation_type]
    day_key = f"rate:{user_id}:daily:{daily_pool}"
    day_result = await _check_fixed_window(
        day_key, config.requests_per_day, 86400, now,
    )
    if not day_result.allowed:
        logger.warning(
            "rate_limit_exceeded",
            extra={
                "user_id": user_id,
                "operation": operation_type.value,
                "tier": tier.value,
                "limit_type": "daily",
            },
        )
        return day_result

    # Both passed - return the per-minute result (more relevant for headers)
    return minute_result


async def get_ai_rate_limit_status(
    user_id: int,
    operation_type: OperationType,
    tier: Tier,
) -> AIRateLimitStatus:
    """
    Read current per-minute and daily AI rate limit status without consuming quota.

    Returns both windows for AI_PLATFORM or AI_BYOK, used by /ai/health so the
    client can surface both short-term and daily headroom. Does not mutate the
    underlying Redis structures — the minute window is peeked via ZCOUNT and
    the daily counter via GET.
    """
    limits = get_tier_limits(tier)

    if operation_type == OperationType.AI_PLATFORM:
        minute_limit = limits.rate_ai_per_minute
        daily_limit = limits.rate_ai_per_day
    elif operation_type == OperationType.AI_BYOK:
        minute_limit = limits.rate_ai_byok_per_minute
        daily_limit = limits.rate_ai_byok_per_day
    else:
        raise ValueError(
            f"get_ai_rate_limit_status only supports AI operation types, got: {operation_type}",
        )

    redis_client = get_redis_client()
    if redis_client is None or not redis_client.is_connected:
        # Fail-open: pretend full quota is available
        return AIRateLimitStatus(
            limit_per_minute=minute_limit,
            remaining_per_minute=minute_limit,
            limit_per_day=daily_limit,
            remaining_per_day=daily_limit,
        )

    # Daily — fixed-window counter; read without incrementing
    day_key = f"rate:{user_id}:daily:{_DAILY_POOL_MAP[operation_type]}"
    count_str = await redis_client.get(day_key)
    daily_used = int(count_str) if count_str else 0
    remaining_day = max(0, daily_limit - daily_used)

    # Per-minute — sliding window (sorted set of timestamps). ZCOUNT entries
    # whose score is within the last 60 seconds gives the used count without
    # mutating the set.
    now = int(time.time())
    minute_key = f"rate:{user_id}:{operation_type.value}:min"
    used_minute = await redis_client.zcount(minute_key, now - 60, float("inf"))
    if used_minute is None:
        # Redis hiccup — fail open for this window only
        used_minute = 0
    remaining_minute = max(0, minute_limit - used_minute)

    return AIRateLimitStatus(
        limit_per_minute=minute_limit,
        remaining_per_minute=remaining_minute,
        limit_per_day=daily_limit,
        remaining_per_day=remaining_day,
    )


async def _check_sliding_window(
    key: str, max_requests: int, window_seconds: int, now: int,
) -> RateLimitResult:
    """
    Sliding window check using Redis sorted set.

    More accurate than fixed window - prevents gaming at window boundaries.
    Used for per-minute limits where precision matters.
    """
    redis_client = get_redis_client()
    if redis_client is None:
        # Redis unavailable - fail open
        return RateLimitResult(
            allowed=True,
            limit=max_requests,
            remaining=max_requests,
            reset=0,
            retry_after=0,
        )

    result = await redis_client.eval_sliding_window(
        key=key,
        now=now,
        window_seconds=window_seconds,
        max_requests=max_requests,
        request_id=str(uuid.uuid4()),
    )

    if result is None:
        # Redis unavailable - fail open
        return RateLimitResult(
            allowed=True,
            limit=max_requests,
            remaining=max_requests,
            reset=0,
            retry_after=0,
        )

    allowed, remaining, retry_after = result
    return RateLimitResult(
        allowed=bool(allowed),
        limit=max_requests,
        remaining=max(0, remaining),
        reset=now + window_seconds,
        retry_after=max(0, retry_after) if not allowed else 0,
    )


async def _check_fixed_window(
    key: str, max_requests: int, window_seconds: int, now: int,
) -> RateLimitResult:
    """
    Fixed window check using Lua script for atomicity.

    Simpler and lower memory than sliding window.
    Used for daily limits where slight boundary imprecision is acceptable.
    """
    redis_client = get_redis_client()
    if redis_client is None:
        # Redis unavailable - fail open
        return RateLimitResult(
            allowed=True,
            limit=max_requests,
            remaining=max_requests,
            reset=0,
            retry_after=0,
        )

    result = await redis_client.eval_fixed_window(
        key=key,
        max_requests=max_requests,
        window_seconds=window_seconds,
    )

    if result is None:
        # Redis unavailable - fail open
        return RateLimitResult(
            allowed=True,
            limit=max_requests,
            remaining=max_requests,
            reset=0,
            retry_after=0,
        )

    allowed, remaining, ttl, retry_after = result
    return RateLimitResult(
        allowed=bool(allowed),
        limit=max_requests,
        remaining=max(0, remaining),
        reset=now + ttl if ttl > 0 else now + window_seconds,
        retry_after=max(0, retry_after) if not allowed else 0,
    )
