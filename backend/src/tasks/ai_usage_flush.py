"""
Hourly flush of AI usage data from Redis to Postgres.

Scans Redis for completed hourly ai_stats:* buckets and upserts them
into the ai_usage table. Only processes past hours (never the current
hour) so no in-flight writes are lost.

Usage:
    python -m tasks.ai_usage_flush
"""
import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.redis import RedisClient

logger = logging.getLogger(__name__)


async def flush_ai_usage(db: AsyncSession, redis: RedisClient) -> dict:
    """
    Flush completed hourly AI usage buckets from Redis to Postgres.

    Returns summary dict with keys_processed and total_cost_flushed.
    """
    current_hour = datetime.now(UTC).strftime("%Y-%m-%dT%H")

    keys = await redis.scan_keys("ai_stats:*")
    if not keys:
        logger.info("ai_usage_flush: no keys found")
        return {"keys_processed": 0, "total_cost_flushed": 0.0}

    # Filter to past hours only — never process the current hour
    past_keys = []
    for key in keys:
        hour = _parse_hour_from_key(key)
        if hour and hour < current_hour:
            past_keys.append(key)

    if not past_keys:
        logger.info("ai_usage_flush: no completed hourly buckets to flush")
        return {"keys_processed": 0, "total_cost_flushed": 0.0}

    keys_processed = 0
    total_cost_flushed = 0.0
    keys_to_delete = []

    for key in past_keys:
        parsed = _parse_key(key)
        if parsed is None:
            logger.warning("ai_usage_flush: skipping malformed key", extra={"key": key})
            continue

        data = await redis.hgetall(key)
        if data is None:
            continue

        raw_cost = data.get("cost")
        cost_value = float(raw_cost) if raw_cost is not None else None
        count = int(data.get("count", "0"))

        await _upsert_usage(
            db,
            bucket_start=parsed["bucket_start"],
            user_id=parsed["user_id"],
            use_case=parsed["use_case"],
            model=parsed["model"],
            key_source=parsed["key_source"],
            request_count=count,
            total_cost=Decimal(str(cost_value)) if cost_value is not None else None,
        )

        keys_to_delete.append(key)
        keys_processed += 1
        if cost_value is not None:
            total_cost_flushed += cost_value

    # Commit all upserts before deleting Redis keys
    await db.commit()

    # Delete processed keys — safe because we only process past hours
    if keys_to_delete:
        await redis.delete(*keys_to_delete)

    summary = {
        "keys_processed": keys_processed,
        "total_cost_flushed": round(total_cost_flushed, 6),
    }
    logger.info("ai_usage_flush: complete", extra=summary)
    return summary


def _parse_hour_from_key(key: str) -> str | None:
    """
    Extract the hour segment from an ai_stats key.

    Key format: ai_stats:{user_id}:{hour}:{use_case}:{model}:{key_source}
    """
    parts = key.split(":")
    if len(parts) < 3:
        return None
    return parts[2]


def _parse_key(key: str) -> dict | None:
    """
    Parse an ai_stats Redis key into its components.

    Key format: ai_stats:{user_id}:{hour}:{use_case}:{model}:{key_source}
    Model IDs contain slashes (e.g. gemini/gemini-flash-lite-latest), so we split
    from the right to handle the key_source, then from the left for the rest.
    """
    # Remove prefix
    if not key.startswith("ai_stats:"):
        return None
    remainder = key[len("ai_stats:"):]

    # key_source is the last colon-delimited segment
    parts = remainder.rsplit(":", 1)
    if len(parts) != 2:
        return None
    before_key_source, key_source = parts

    # Remaining format: {user_id}:{hour}:{use_case}:{model}
    # Model IDs use slashes (gemini/gemini-flash-lite-latest), not colons.
    segments = before_key_source.split(":")
    if len(segments) < 4:
        return None

    user_id_str = segments[0]
    hour = segments[1]
    use_case = segments[2]
    model = ":".join(segments[3:])

    try:
        user_id = UUID(user_id_str)
    except ValueError:
        return None

    try:
        bucket_start = datetime.strptime(hour, "%Y-%m-%dT%H").replace(tzinfo=UTC)
    except ValueError:
        return None

    return {
        "user_id": user_id,
        "bucket_start": bucket_start,
        "use_case": use_case,
        "model": model,
        "key_source": key_source,
    }


async def _upsert_usage(
    db: AsyncSession,
    bucket_start: datetime,
    user_id: UUID,
    use_case: str,
    model: str,
    key_source: str,
    request_count: int,
    total_cost: Decimal | None,
) -> None:
    """
    Upsert a usage row.

    Uses SET (not INCREMENT) so re-runs are idempotent. This is safe because
    we only process completed hours — no new writes land on past-hour keys.
    """
    await db.execute(
        text("""
            INSERT INTO ai_usage
                (bucket_start, user_id, use_case, model,
                 key_source, request_count, total_cost)
            VALUES
                (:bucket_start, :user_id, :use_case, :model,
                 :key_source, :request_count, :total_cost)
            ON CONFLICT ON CONSTRAINT uq_ai_usage_bucket
            DO UPDATE SET
                request_count = EXCLUDED.request_count,
                total_cost = EXCLUDED.total_cost
        """),
        {
            "bucket_start": bucket_start,
            "user_id": user_id,
            "use_case": use_case,
            "model": model,
            "key_source": key_source,
            "request_count": request_count,
            "total_cost": total_cost,
        },
    )


async def run_flush(db: AsyncSession | None = None) -> dict:
    """
    Run the AI usage flush, optionally with a provided session.

    When called with db (e.g. from tests), uses the existing Redis global.
    When called standalone (cron), initializes its own Redis connection.
    """
    from core.redis import get_redis_client  # noqa: PLC0415

    redis = get_redis_client()

    if db is not None:
        if redis is None or not redis.is_connected:
            logger.warning("ai_usage_flush: Redis unavailable, skipping")
            return {"keys_processed": 0, "total_cost_flushed": 0.0}
        return await flush_ai_usage(db, redis)

    # Standalone cron path: initialize Redis + DB
    from core.config import get_settings  # noqa: PLC0415
    from core.redis import RedisClient, set_redis_client  # noqa: PLC0415
    from db.session import async_session_factory  # noqa: PLC0415

    settings = get_settings()
    redis_client = RedisClient(
        url=settings.redis_url,
        enabled=settings.redis_enabled,
        pool_size=settings.redis_pool_size,
    )
    await redis_client.connect()
    set_redis_client(redis_client)

    try:
        async with async_session_factory() as session:
            return await flush_ai_usage(session, redis_client)
    finally:
        await redis_client.close()
        set_redis_client(None)


def main() -> None:
    """Entry point for running flush as a cron job."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    asyncio.run(run_flush())


if __name__ == "__main__":
    main()
