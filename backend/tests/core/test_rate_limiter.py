"""Tests for the Redis-based rate limiter module."""
import time
from uuid import uuid4

from core.rate_limit_config import (
    OperationType,
    RateLimitResult,
    get_operation_type,
)
from core.rate_limiter import check_rate_limit
from core.redis import RedisClient, set_redis_client
from core.tier_limits import Tier, get_tier_limits

# Reference configurations for cleaner tests
FREE_LIMITS = get_tier_limits(Tier.FREE)


class TestGetOperationType:
    """Tests for get_operation_type function."""

    def test__get_operation_type__get_request_is_read(self) -> None:
        """GET requests are classified as READ."""
        assert get_operation_type("GET", "/bookmarks") == OperationType.READ

    def test__get_operation_type__post_request_is_write(self) -> None:
        """POST requests are classified as WRITE."""
        assert get_operation_type("POST", "/bookmarks") == OperationType.WRITE

    def test__get_operation_type__patch_request_is_write(self) -> None:
        """PATCH requests are classified as WRITE."""
        assert get_operation_type("PATCH", "/bookmarks/1") == OperationType.WRITE

    def test__get_operation_type__delete_request_is_write(self) -> None:
        """DELETE requests are classified as WRITE."""
        assert get_operation_type("DELETE", "/bookmarks/1") == OperationType.WRITE

    def test__get_operation_type__fetch_metadata_is_sensitive(self) -> None:
        """fetch-metadata endpoint is classified as SENSITIVE."""
        assert get_operation_type("GET", "/bookmarks/fetch-metadata") == OperationType.SENSITIVE


class TestCheckRateLimit:
    """Tests for check_rate_limit function."""

    async def test__check__allows_request_under_limit(
        self, redis_client: RedisClient,  # noqa: ARG002
    ) -> None:
        """Requests under the limit are allowed."""
        result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        assert result.allowed is True
        assert result.remaining >= 0

    async def test__check__blocks_request_over_limit(
        self, redis_client: RedisClient,
    ) -> None:
        """Requests over the limit are blocked."""
        user_id = uuid4()
        limit = FREE_LIMITS.rate_read_per_minute

        # Fill up the limit by manually adding entries via sliding window
        key = f"rate:{user_id}:read:min"
        now = int(time.time())
        for i in range(limit):
            await redis_client.evalsha(
                redis_client.sliding_window_sha,
                1,
                key,
                now,
                60,
                limit,
                f"test-{i}",
            )

        # Next request should be blocked
        result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        assert result.allowed is False
        assert result.remaining == 0
        assert result.retry_after > 0

    async def test__check__different_users_have_separate_limits(
        self, redis_client: RedisClient,  # noqa: ARG002
    ) -> None:
        """Different users have separate rate limit buckets."""
        result1 = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )
        result2 = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        # Both should be allowed (separate buckets)
        assert result1.allowed is True
        assert result2.allowed is True

    async def test__check__limits_match_tier_config(
        self, redis_client: RedisClient,  # noqa: ARG002
    ) -> None:
        """Rate limits match the tier configuration."""
        read_result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )
        write_result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.WRITE,
            tier=Tier.FREE,
        )
        sensitive_result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.SENSITIVE,
            tier=Tier.FREE,
        )

        assert read_result.limit == FREE_LIMITS.rate_read_per_minute
        assert write_result.limit == FREE_LIMITS.rate_write_per_minute
        assert sensitive_result.limit == FREE_LIMITS.rate_sensitive_per_minute

    async def test__check__sensitive_has_strictest_limits(
        self, redis_client: RedisClient,  # noqa: ARG002
    ) -> None:
        """Sensitive operations have the strictest limits."""
        result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.SENSITIVE,
            tier=Tier.FREE,
        )

        assert result.limit == FREE_LIMITS.rate_sensitive_per_minute
        assert result.limit < FREE_LIMITS.rate_read_per_minute
        assert result.limit < FREE_LIMITS.rate_write_per_minute

    async def test__check__returns_rate_limit_info_for_headers(
        self, redis_client: RedisClient,  # noqa: ARG002
    ) -> None:
        """Check returns all info needed for rate limit headers."""
        result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        assert isinstance(result, RateLimitResult)
        assert result.limit > 0
        assert result.remaining >= 0
        assert result.reset > 0
        assert result.retry_after >= 0


class TestDailyLimits:
    """Tests for daily rate limit enforcement."""

    async def test__check__daily_limit_blocks_after_minute_limit_passes(
        self, redis_client: RedisClient,
    ) -> None:
        """
        Daily limit blocks requests even when per-minute limit has room.

        Scenario: User exhausts daily limit over multiple minute windows.
        Per-minute sliding window resets, but daily fixed window still blocks.
        """
        user_id = uuid4()
        daily_limit = FREE_LIMITS.rate_read_per_day

        # Pre-fill the daily limit directly using the fixed window key
        daily_key = f"rate:{user_id}:daily:general"

        # Exhaust daily limit by incrementing counter
        for _ in range(daily_limit):
            await redis_client.evalsha(
                redis_client.fixed_window_sha,
                1,
                daily_key,
                daily_limit,
                86400,
            )

        # The per-minute limit should still have room (we haven't used it)
        # But daily limit is exhausted, so request should be blocked
        result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        assert result.allowed is False, "Should be blocked by daily limit"
        assert result.retry_after > 60, "Daily retry_after should be > 60 seconds"

    async def test__check__general_and_sensitive_have_separate_daily_pools(
        self, redis_client: RedisClient,
    ) -> None:
        """
        READ/WRITE share 'general' daily pool, SENSITIVE has separate pool.

        Exhausting general daily limit should not affect sensitive limit.
        """
        user_id = uuid4()
        daily_limit = FREE_LIMITS.rate_read_per_day

        # Exhaust the general daily pool (READ/WRITE share this)
        general_key = f"rate:{user_id}:daily:general"
        for _ in range(daily_limit):
            await redis_client.evalsha(
                redis_client.fixed_window_sha,
                1,
                general_key,
                daily_limit,
                86400,
            )

        # READ should be blocked (uses general pool)
        read_result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )
        assert read_result.allowed is False, "READ should be blocked (general pool exhausted)"

        # SENSITIVE should still be allowed (separate pool)
        sensitive_result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.SENSITIVE,
            tier=Tier.FREE,
        )
        assert sensitive_result.allowed is True, "SENSITIVE should be allowed (separate pool)"

    async def test__check__sensitive_daily_pool_is_independent(
        self, redis_client: RedisClient,
    ) -> None:
        """Exhausting sensitive daily limit does not affect general pool."""
        user_id = uuid4()
        sensitive_daily_limit = FREE_LIMITS.rate_sensitive_per_day

        # Exhaust the sensitive daily pool
        sensitive_key = f"rate:{user_id}:daily:sensitive"
        for _ in range(sensitive_daily_limit):
            await redis_client.evalsha(
                redis_client.fixed_window_sha,
                1,
                sensitive_key,
                sensitive_daily_limit,
                86400,
            )

        # SENSITIVE should be blocked
        sensitive_result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.SENSITIVE,
            tier=Tier.FREE,
        )
        assert sensitive_result.allowed is False, "SENSITIVE should be blocked"

        # READ should still be allowed (general pool is separate)
        read_result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )
        assert read_result.allowed is True, "READ should be allowed (general pool not affected)"

    async def test__check__daily_limit_reset_is_future_timestamp(
        self, redis_client: RedisClient,  # noqa: ARG002
    ) -> None:
        """Daily limit returns reset timestamp in the future (within 24 hours)."""
        user_id = uuid4()
        now = int(time.time())

        result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        # Reset should be in the future but within 24 hours
        assert result.reset > now
        assert result.reset <= now + 86400, "Reset should be within 24 hours"

    async def test__check__write_operations_share_general_daily_pool(
        self, redis_client: RedisClient,
    ) -> None:
        """WRITE operations use the same 'general' daily pool as READ."""
        user_id = uuid4()
        daily_limit = FREE_LIMITS.rate_read_per_day

        # Exhaust general daily pool
        general_key = f"rate:{user_id}:daily:general"
        for _ in range(daily_limit):
            await redis_client.evalsha(
                redis_client.fixed_window_sha,
                1,
                general_key,
                daily_limit,
                86400,
            )

        # WRITE should be blocked (shares general pool with READ)
        write_result = await check_rate_limit(
            user_id=user_id,
            operation_type=OperationType.WRITE,
            tier=Tier.FREE,
        )
        assert write_result.allowed is False, "WRITE should be blocked (general pool exhausted)"


class TestRateLimiterFallback:
    """Tests for rate limiter fallback when Redis unavailable."""

    async def test__check__allows_request_when_redis_unavailable(self) -> None:
        """Requests are allowed when Redis is unavailable (fail-open)."""
        set_redis_client(None)

        result = await check_rate_limit(
            user_id=uuid4(),
            operation_type=OperationType.READ,
            tier=Tier.FREE,
        )

        assert result.allowed is True

    async def test__check__allows_request_when_redis_disabled(self) -> None:
        """Requests are allowed when Redis is disabled (fail-open)."""
        disabled_client = RedisClient("redis://localhost:6379", enabled=False)
        await disabled_client.connect()
        set_redis_client(disabled_client)

        try:
            result = await check_rate_limit(
                user_id=uuid4(),
                operation_type=OperationType.READ,
                tier=Tier.FREE,
            )

            assert result.allowed is True
        finally:
            await disabled_client.close()
            set_redis_client(None)

    async def test__check__allows_request_when_script_sha_not_loaded(
        self, redis_client: RedisClient,
    ) -> None:
        """
        Requests are allowed when Lua scripts failed to load (fail-open).

        This handles the edge case where Redis connects but script loading fails.
        """
        original_sliding = redis_client._sliding_window_sha
        original_fixed = redis_client._fixed_window_sha

        redis_client._sliding_window_sha = None
        redis_client._fixed_window_sha = None

        try:
            result = await check_rate_limit(
                user_id=uuid4(),
                operation_type=OperationType.READ,
                tier=Tier.FREE,
            )

            assert result.allowed is True
        finally:
            redis_client._sliding_window_sha = original_sliding
            redis_client._fixed_window_sha = original_fixed
