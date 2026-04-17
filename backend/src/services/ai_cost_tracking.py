"""
AI cost tracking via Redis with hourly buckets.

Records LLM call cost and count in Redis hashes keyed by
user + hour + use_case + model + key_source. An hourly cron job
(tasks/ai_usage_flush.py) flushes completed buckets to Postgres.

Cost tracking is fire-and-forget — Redis failures are logged but
never block the response.
"""
import logging
from datetime import UTC, datetime
from uuid import UUID

from core.redis import get_redis_client
from services.llm_service import AIUseCase, KeySource

logger = logging.getLogger(__name__)

# Auto-expire Redis keys if the flush cron fails to delete them.
_COST_TTL = 7 * 86400  # 7 days


async def track_cost(
    user_id: UUID,
    use_case: AIUseCase,
    model: str,
    key_source: KeySource,
    cost: float | None,
    latency_ms: int,
) -> None:
    """
    Record LLM call cost in Redis and emit structured log.

    Logs the call metadata regardless of whether cost is available.
    Skips the Redis write when cost is None (nothing useful to record).
    """
    logger.info(
        "llm_call",
        extra={
            "user_id": str(user_id),
            "use_case": use_case.value,
            "model": model,
            "key_source": key_source.value,
            "cost": cost,
            "latency_ms": latency_ms,
        },
    )

    if cost is None:
        logger.warning(
            "cost_tracking_cost_unknown",
            extra={
                "user_id": str(user_id),
                "use_case": use_case.value,
                "model": model,
            },
        )

    redis_client = get_redis_client()
    if redis_client is None or not redis_client.is_connected:
        logger.warning(
            "cost_tracking_failed",
            extra={
                "user_id": str(user_id),
                "cost": cost,
                "use_case": use_case.value,
                "reason": "redis_unavailable",
            },
        )
        return

    hour = datetime.now(UTC).strftime("%Y-%m-%dT%H")
    key = f"ai_stats:{user_id}:{hour}:{use_case.value}:{model}:{key_source.value}"

    try:
        pipe = await redis_client.pipeline()
        if pipe is None:
            return
        pipe.hincrby(key, "count", 1)
        if cost is not None:
            pipe.hincrbyfloat(key, "cost", cost)
        pipe.expire(key, _COST_TTL)
        await pipe.execute()
    except Exception:
        logger.warning(
            "cost_tracking_failed",
            extra={
                "user_id": str(user_id),
                "cost": cost,
                "use_case": use_case.value,
                "reason": "redis_write_error",
            },
        )
