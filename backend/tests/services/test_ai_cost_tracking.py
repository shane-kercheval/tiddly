"""Unit tests for AI cost tracking."""
import logging
from uuid import uuid4

from core.redis import RedisClient
from services.ai_cost_tracking import track_cost
from services.llm_service import AIUseCase, KeySource


class TestTrackCost:
    """Tests for track_cost Redis writes and logging."""

    async def test_writes_redis_hash_with_correct_key_format(
        self, redis_client: RedisClient,
    ) -> None:
        user_id = uuid4()
        await track_cost(
            user_id=user_id,
            use_case=AIUseCase.SUGGESTIONS,
            model="gemini/gemini-2.5-flash-lite",
            key_source=KeySource.PLATFORM,
            cost=0.001,
            latency_ms=150,
        )

        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        assert len(keys) == 1
        key = keys[0]
        assert key.startswith(f"ai_stats:{user_id}:")
        assert ":suggestions:" in key
        assert ":gemini/gemini-2.5-flash-lite:" in key
        assert key.endswith(":platform")

    async def test_writes_cost_and_count(self, redis_client: RedisClient) -> None:
        user_id = uuid4()
        await track_cost(
            user_id=user_id,
            use_case=AIUseCase.SUGGESTIONS,
            model="gemini/gemini-2.5-flash-lite",
            key_source=KeySource.PLATFORM,
            cost=0.005,
            latency_ms=100,
        )

        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        data = await redis_client.hgetall(keys[0])
        assert data is not None
        assert float(data["cost"]) == 0.005
        assert int(data["count"]) == 1

    async def test_increments_on_multiple_calls(self, redis_client: RedisClient) -> None:
        user_id = uuid4()
        for _ in range(3):
            await track_cost(
                user_id=user_id,
                use_case=AIUseCase.SUGGESTIONS,
                model="gemini/gemini-2.5-flash-lite",
                key_source=KeySource.PLATFORM,
                cost=0.001,
                latency_ms=100,
            )

        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        data = await redis_client.hgetall(keys[0])
        assert data is not None
        assert abs(float(data["cost"]) - 0.003) < 1e-9
        assert int(data["count"]) == 3

    async def test_writes_count_but_not_cost_when_cost_is_none(
        self, redis_client: RedisClient,
    ) -> None:
        """Count is always recorded. Cost is omitted when None."""
        user_id = uuid4()
        await track_cost(
            user_id=user_id,
            use_case=AIUseCase.SUGGESTIONS,
            model="gemini/gemini-2.5-flash-lite",
            key_source=KeySource.PLATFORM,
            cost=None,
            latency_ms=100,
        )

        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        assert len(keys) == 1
        data = await redis_client.hgetall(keys[0])
        assert data is not None
        assert int(data["count"]) == 1
        assert "cost" not in data

    async def test_logs_llm_call_even_when_cost_is_none(
        self, redis_client: RedisClient, caplog: logging.LogRecord,  # noqa: ARG002
    ) -> None:
        user_id = uuid4()
        with caplog.at_level(logging.INFO, logger="services.ai_cost_tracking"):
            await track_cost(
                user_id=user_id,
                use_case=AIUseCase.SUGGESTIONS,
                model="gemini/gemini-2.5-flash-lite",
                key_source=KeySource.PLATFORM,
                cost=None,
                latency_ms=100,
            )

        assert any("llm_call" in r.message for r in caplog.records)

    async def test_logs_warning_when_cost_is_none(
        self, redis_client: RedisClient, caplog: logging.LogRecord,  # noqa: ARG002
    ) -> None:
        with caplog.at_level(logging.WARNING, logger="services.ai_cost_tracking"):
            await track_cost(
                user_id=uuid4(),
                use_case=AIUseCase.SUGGESTIONS,
                model="test-model",
                key_source=KeySource.PLATFORM,
                cost=None,
                latency_ms=100,
            )

        assert any("cost_tracking_cost_unknown" in r.message for r in caplog.records)

    async def test_logs_structured_metadata(
        self, redis_client: RedisClient, caplog: logging.LogRecord,  # noqa: ARG002
    ) -> None:
        user_id = uuid4()
        with caplog.at_level(logging.INFO, logger="services.ai_cost_tracking"):
            await track_cost(
                user_id=user_id,
                use_case=AIUseCase.CHAT,
                model="gemini/gemini-2.5-flash",
                key_source=KeySource.USER,
                cost=0.01,
                latency_ms=250,
            )

        llm_records = [r for r in caplog.records if r.message == "llm_call"]
        assert len(llm_records) == 1
        record = llm_records[0]
        assert record.user_id == str(user_id)
        assert record.use_case == "chat"
        assert record.model == "gemini/gemini-2.5-flash"
        assert record.key_source == "user"
        assert record.cost == 0.01
        assert record.latency_ms == 250

    async def test_redis_unavailable_does_not_raise(
        self, redis_client: RedisClient,
    ) -> None:
        """Cost tracking should never break the response."""
        from core.redis import set_redis_client  # noqa: PLC0415

        set_redis_client(None)
        try:
            # Should not raise
            await track_cost(
                user_id=uuid4(),
                use_case=AIUseCase.SUGGESTIONS,
                model="test",
                key_source=KeySource.PLATFORM,
                cost=0.001,
                latency_ms=100,
            )
        finally:
            set_redis_client(redis_client)

    async def test_different_use_cases_separate_keys(
        self, redis_client: RedisClient,
    ) -> None:
        user_id = uuid4()
        await track_cost(
            user_id=user_id,
            use_case=AIUseCase.SUGGESTIONS,
            model="gemini/gemini-2.5-flash-lite",
            key_source=KeySource.PLATFORM,
            cost=0.001,
            latency_ms=100,
        )
        await track_cost(
            user_id=user_id,
            use_case=AIUseCase.CHAT,
            model="gemini/gemini-2.5-flash-lite",
            key_source=KeySource.PLATFORM,
            cost=0.002,
            latency_ms=200,
        )

        keys = await redis_client.scan_keys(f"ai_stats:{user_id}:*")
        assert len(keys) == 2
