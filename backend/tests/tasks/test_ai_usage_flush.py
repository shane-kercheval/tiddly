"""Tests for AI usage flush task."""
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.redis import RedisClient
from models.ai_usage import AiUsage
from tasks.ai_usage_flush import _parse_key, flush_ai_usage


def _make_redis_key(
    user_id: str,
    hour: str,
    use_case: str = "suggestions",
    model: str = "gemini/gemini-2.5-flash-lite",
    key_source: str = "platform",
) -> str:
    return f"ai_stats:{user_id}:{hour}:{use_case}:{model}:{key_source}"


def _past_hour(hours_ago: int = 1) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H")


def _current_hour() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H")


class TestParseKey:
    """Tests for _parse_key."""

    def test_valid_key(self) -> None:
        user_id = str(uuid4())
        key = _make_redis_key(user_id, "2026-04-05T14")
        parsed = _parse_key(key)
        assert parsed is not None
        assert str(parsed["user_id"]) == user_id
        assert parsed["bucket_start"] == datetime(2026, 4, 5, 14, tzinfo=UTC)
        assert parsed["use_case"] == "suggestions"
        assert parsed["model"] == "gemini/gemini-2.5-flash-lite"
        assert parsed["key_source"] == "platform"

    def test_model_with_slash(self) -> None:
        user_id = str(uuid4())
        key = _make_redis_key(user_id, "2026-04-05T14", model="anthropic/claude-sonnet-4-6")
        parsed = _parse_key(key)
        assert parsed is not None
        assert parsed["model"] == "anthropic/claude-sonnet-4-6"

    def test_invalid_prefix(self) -> None:
        assert _parse_key("wrong_prefix:something") is None

    def test_invalid_uuid(self) -> None:
        assert _parse_key("ai_stats:not-a-uuid:2026-04-05T14:suggestions:model:platform") is None

    def test_invalid_hour_format(self) -> None:
        user_id = str(uuid4())
        assert _parse_key(f"ai_stats:{user_id}:bad-hour:suggestions:model:platform") is None

    def test_too_few_segments(self) -> None:
        assert _parse_key("ai_stats:foo:bar") is None


class TestFlushAiUsage:
    """Tests for flush_ai_usage."""

    async def test_flushes_past_hour_to_db(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        user_id = uuid4()
        hour = _past_hour()
        key = _make_redis_key(str(user_id), hour)

        pipe = await redis_client.pipeline()
        pipe.hincrbyfloat(key, "cost", 0.005)
        pipe.hincrby(key, "count", 3)
        await pipe.execute()

        result = await flush_ai_usage(db_session, redis_client)
        assert result["keys_processed"] == 1
        assert result["total_cost_flushed"] == 0.005

        # Verify DB row
        row = (await db_session.execute(
            select(AiUsage).where(AiUsage.user_id == user_id),
        )).scalar_one()
        assert row.request_count == 3
        assert row.total_cost == Decimal("0.005")
        assert row.use_case == "suggestions"
        assert row.model == "gemini/gemini-2.5-flash-lite"
        assert row.key_source == "platform"

    async def test_does_not_flush_current_hour(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        user_id = uuid4()
        key = _make_redis_key(str(user_id), _current_hour())

        pipe = await redis_client.pipeline()
        pipe.hincrbyfloat(key, "cost", 0.01)
        pipe.hincrby(key, "count", 1)
        await pipe.execute()

        result = await flush_ai_usage(db_session, redis_client)
        assert result["keys_processed"] == 0

        # Key should still exist in Redis
        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        assert len(keys) == 1

    async def test_flushes_multiple_hours(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        """Handles skipped hours — all past hours flushed in one run."""
        user_id = uuid4()
        for hours_ago in [1, 2, 3]:
            hour = _past_hour(hours_ago)
            key = _make_redis_key(str(user_id), hour)
            pipe = await redis_client.pipeline()
            pipe.hincrbyfloat(key, "cost", 0.001)
            pipe.hincrby(key, "count", 1)
            await pipe.execute()

        result = await flush_ai_usage(db_session, redis_client)
        assert result["keys_processed"] == 3

        rows = (await db_session.execute(
            select(AiUsage).where(AiUsage.user_id == user_id),
        )).scalars().all()
        assert len(rows) == 3

    async def test_deletes_redis_keys_after_flush(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        user_id = uuid4()
        key = _make_redis_key(str(user_id), _past_hour())

        pipe = await redis_client.pipeline()
        pipe.hincrbyfloat(key, "cost", 0.01)
        pipe.hincrby(key, "count", 1)
        await pipe.execute()

        await flush_ai_usage(db_session, redis_client)

        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        assert len(keys) == 0

    async def test_empty_redis_returns_zero(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        result = await flush_ai_usage(db_session, redis_client)
        assert result["keys_processed"] == 0
        assert result["total_cost_flushed"] == 0.0

    async def test_upsert_is_idempotent(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        """Re-running flush with same data produces same DB state (SET not INCREMENT)."""
        user_id = uuid4()
        hour = _past_hour()
        key = _make_redis_key(str(user_id), hour)

        # First flush
        pipe = await redis_client.pipeline()
        pipe.hincrbyfloat(key, "cost", 0.005)
        pipe.hincrby(key, "count", 3)
        await pipe.execute()
        await flush_ai_usage(db_session, redis_client)

        # Simulate re-run by re-seeding same key (as if delete failed)
        pipe = await redis_client.pipeline()
        pipe.hincrbyfloat(key, "cost", 0.005)
        pipe.hincrby(key, "count", 3)
        await pipe.execute()
        await flush_ai_usage(db_session, redis_client)

        # Should be SET, not accumulated
        row = (await db_session.execute(
            select(AiUsage).where(AiUsage.user_id == user_id),
        )).scalar_one()
        assert row.request_count == 3
        assert row.total_cost == Decimal("0.005")

    async def test_null_cost_stored_as_null(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        """Keys with zero cost get null total_cost in DB."""
        user_id = uuid4()
        key = _make_redis_key(str(user_id), _past_hour())

        # Write count but no cost (simulates cost=None scenario where
        # only count is tracked)
        pipe = await redis_client.pipeline()
        pipe.hincrby(key, "count", 1)
        await pipe.execute()

        await flush_ai_usage(db_session, redis_client)

        row = (await db_session.execute(
            select(AiUsage).where(AiUsage.user_id == user_id),
        )).scalar_one()
        assert row.request_count == 1
        assert row.total_cost is None

    async def test_zero_cost_stored_as_zero_not_null(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        """cost=0.0 means 'free call', distinct from None ('cost unknown')."""
        user_id = uuid4()
        key = _make_redis_key(str(user_id), _past_hour())

        pipe = await redis_client.pipeline()
        pipe.hincrbyfloat(key, "cost", 0.0)
        pipe.hincrby(key, "count", 1)
        await pipe.execute()

        await flush_ai_usage(db_session, redis_client)

        row = (await db_session.execute(
            select(AiUsage).where(AiUsage.user_id == user_id),
        )).scalar_one()
        assert row.request_count == 1
        assert row.total_cost == Decimal("0")
        assert row.total_cost is not None

    async def test_different_users_separate_rows(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        hour = _past_hour()
        for _ in range(2):
            user_id = uuid4()
            key = _make_redis_key(str(user_id), hour)
            pipe = await redis_client.pipeline()
            pipe.hincrbyfloat(key, "cost", 0.001)
            pipe.hincrby(key, "count", 1)
            await pipe.execute()

        result = await flush_ai_usage(db_session, redis_client)
        assert result["keys_processed"] == 2

    async def test_different_use_cases_separate_rows(
        self, db_session: AsyncSession, redis_client: RedisClient,
    ) -> None:
        user_id = uuid4()
        hour = _past_hour()

        for use_case in ["suggestions", "chat"]:
            key = _make_redis_key(str(user_id), hour, use_case=use_case)
            pipe = await redis_client.pipeline()
            pipe.hincrbyfloat(key, "cost", 0.001)
            pipe.hincrby(key, "count", 1)
            await pipe.execute()

        await flush_ai_usage(db_session, redis_client)

        rows = (await db_session.execute(
            select(AiUsage).where(AiUsage.user_id == user_id),
        )).scalars().all()
        assert len(rows) == 2
        use_cases = {r.use_case for r in rows}
        assert use_cases == {"suggestions", "chat"}
