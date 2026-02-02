"""
Redis-based rate limiting enforcement.

This module contains the enforcement logic - the "how" of rate limiting.
For configuration (limits, sensitive endpoints), see rate_limit_config.py.
"""
import logging
import time
import uuid

from core.rate_limit_config import (
    OperationType,
    RateLimitConfig,
    RateLimitResult,
)
from core.redis import get_redis_client
from core.tier_limits import Tier, get_tier_limits

logger = logging.getLogger(__name__)


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
    else:
        raise ValueError(f"Unknown operation type: {operation_type}")

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
    daily_pool = "sensitive" if operation_type == OperationType.SENSITIVE else "general"
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
