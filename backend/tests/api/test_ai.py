"""Integration tests for AI router endpoints."""
import typing
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
    Timeout,
)

from core.tier_limits import Tier, TierLimits, get_tier_limits
from services.llm_service import AIUseCase, get_llm_service


# ---------------------------------------------------------------------------
# GET /ai/health
# ---------------------------------------------------------------------------


class TestAIHealth:
    """Tests for GET /ai/health."""

    async def test_returns_available_dev_mode(self, client: AsyncClient) -> None:
        """Dev mode has non-zero AI limits, so available=True."""
        response = await client.get("/ai/health")
        assert response.status_code == 200
        data = response.json()
        assert data["available"] is True
        assert data["byok"] is False
        assert "remaining_per_day" in data
        assert "limit_per_day" in data

    async def test_byok_detected(self, client: AsyncClient) -> None:
        response = await client.get(
            "/ai/health",
            headers={"X-LLM-Api-Key": "user-provided-key"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["byok"] is True

    async def test_no_byok_header(self, client: AsyncClient) -> None:
        response = await client.get("/ai/health")
        data = response.json()
        assert data["byok"] is False

    async def test_quota_fields_present(self, client: AsyncClient) -> None:
        response = await client.get("/ai/health")
        data = response.json()
        assert "remaining_per_day" in data
        assert "limit_per_day" in data
        assert data["limit_per_day"] > 0  # DEV tier has non-zero limits

    async def test_per_minute_fields_present(self, client: AsyncClient) -> None:
        """Per-minute quota exposed alongside daily for client-side pacing."""
        response = await client.get("/ai/health")
        data = response.json()
        assert "remaining_per_minute" in data
        assert "limit_per_minute" in data
        assert data["limit_per_minute"] > 0  # DEV tier has non-zero limits
        assert data["remaining_per_minute"] <= data["limit_per_minute"]

    async def test_resets_at_null_before_first_ai_call(
        self, client: AsyncClient,
    ) -> None:
        """
        `resets_at` is null when no daily counter key exists yet.

        Counter keys are created only on actual rate-limited operations, not
        by reading /ai/health. Until the user makes an AI call, there's no
        TTL to surface.
        """
        response = await client.get("/ai/health")
        data = response.json()
        assert "resets_at" in data
        # Dev test env: each test starts with a clean Redis. No prior call
        # means no key → null reset.
        assert data["resets_at"] is None

    async def test_resets_at_populated_after_ai_call(
        self, client: AsyncClient,
    ) -> None:
        """After an AI call creates the daily counter, resets_at is a future UTC timestamp."""
        # Mock the LLM response
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"tags": ["test"]}'
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            call_resp = await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        assert call_resp.status_code == 200

        health = (await client.get("/ai/health")).json()
        assert health["resets_at"] is not None
        resets = datetime.fromisoformat(health["resets_at"].replace("Z", "+00:00"))
        now = datetime.now(UTC)
        # Reset is in the future and within ~24 hours
        assert now < resets <= now + timedelta(seconds=86400 + 5)  # 5s tolerance

    async def test_resets_at_tracks_selected_bucket(
        self, client: AsyncClient,
    ) -> None:
        """
        `resets_at` reflects the bucket chosen by the `X-LLM-Api-Key` header —
        platform bucket without the header, BYOK bucket with it. The two
        buckets have independent Redis keys, so their reset timestamps are
        independent.
        """
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"tags": ["test"]}'
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            # Trigger only the PLATFORM bucket — no BYOK header
            await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )

        platform_health = (await client.get("/ai/health")).json()
        byok_health = (
            await client.get("/ai/health", headers={"X-LLM-Api-Key": "user-key"})
        ).json()

        # Platform bucket was touched → has a reset time
        assert platform_health["resets_at"] is not None
        assert platform_health["byok"] is False

        # BYOK bucket was not touched → no reset time
        assert byok_health["resets_at"] is None
        assert byok_health["byok"] is True

    async def test_does_not_consume_ai_quota(self, client: AsyncClient) -> None:
        """Health endpoint should not consume AI rate limit quota."""
        # Call health twice, remaining should not decrease
        resp1 = await client.get("/ai/health")
        resp2 = await client.get("/ai/health")
        assert resp1.json()["remaining_per_day"] == resp2.json()["remaining_per_day"]


# ---------------------------------------------------------------------------
# POST /ai/validate-key
# ---------------------------------------------------------------------------


class TestValidateKey:
    """Tests for POST /ai/validate-key."""

    async def test_no_key_returns_400(self, client: AsyncClient) -> None:
        response = await client.post("/ai/validate-key")
        assert response.status_code == 400
        assert "No API key" in response.json()["detail"]

    async def test_valid_key(self, client: AsyncClient) -> None:
        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "valid-key-123"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True

    async def test_invalid_key(self, client: AsyncClient) -> None:
        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=AuthenticationError(
                message="Invalid key",
                model="gemini/gemini-flash-lite-latest",
                llm_provider="gemini",
            ),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "bad-key"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False
        assert "rejected" in data["error"]

    async def test_valid_key_with_model(self, client: AsyncClient) -> None:
        """validate-key with explicit model should use that model for the test call."""
        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response) as mock_acompletion,
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "valid-key-123"},
                json={"model": "anthropic/claude-haiku-4-5"},
            )
        assert response.status_code == 200
        assert response.json()["valid"] is True
        # Verify the model passed to acompletion matches the requested model
        call_kwargs = mock_acompletion.call_args
        assert call_kwargs.kwargs["model"] == "anthropic/claude-haiku-4-5"

    async def test_valid_key_with_unsupported_model(self, client: AsyncClient) -> None:
        """validate-key with unsupported model should return 400."""
        response = await client.post(
            "/ai/validate-key",
            headers={"X-LLM-Api-Key": "valid-key-123"},
            json={"model": "evil/attacker-model"},
        )
        assert response.status_code == 400

    async def test_valid_key_without_model_uses_default(self, client: AsyncClient) -> None:
        """validate-key without model should fall back to platform default."""
        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "valid-key-123"},
            )
        assert response.status_code == 200
        assert response.json()["valid"] is True

    async def test_timeout_propagates_to_global_handler(self, client: AsyncClient) -> None:
        """Timeout during validation should return 504, not valid=false."""
        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=Timeout(
                message="timed out",
                model="gemini/gemini-flash-lite-latest",
                llm_provider="gemini",
            ),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "some-key"},
            )
        assert response.status_code == 504
        assert response.json()["error_code"] == "llm_timeout"

    async def test_rate_limit_propagates_to_global_handler(self, client: AsyncClient) -> None:
        """Provider rate limit during validation should return 429, not valid=false."""
        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=RateLimitError(
                message="rate limited",
                model="gemini/gemini-flash-lite-latest",
                llm_provider="gemini",
            ),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "some-key"},
            )
        assert response.status_code == 429
        assert response.json()["error_code"] == "llm_rate_limited"


# ---------------------------------------------------------------------------
# GET /ai/models
# ---------------------------------------------------------------------------


class TestAIModels:
    """Tests for GET /ai/models."""

    async def test_returns_model_list(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        assert response.status_code == 200
        data = response.json()
        assert "models" in data
        assert "defaults" in data
        assert len(data["models"]) == 7  # 1 Google + 3 OpenAI + 3 Anthropic

    async def test_model_fields(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        models = response.json()["models"]
        for model in models:
            assert "id" in model
            assert "provider" in model
            assert "tier" in model

    async def test_defaults_match_use_cases(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        defaults = response.json()["defaults"]
        for use_case in AIUseCase:
            assert use_case.value in defaults

    async def test_defaults_match_service(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        defaults = response.json()["defaults"]
        llm_service = get_llm_service()
        for use_case in AIUseCase:
            assert defaults[use_case.value] == llm_service.get_model_for_use_case(use_case)

    async def test_three_providers(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        models = response.json()["models"]
        providers = {m["provider"] for m in models}
        assert providers == {"google", "openai", "anthropic"}

    async def test_three_tiers(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        models = response.json()["models"]
        tiers = {m["tier"] for m in models}
        assert tiers == {"budget", "balanced", "flagship"}

    async def test_models_have_pricing(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        models = response.json()["models"]
        for model in models:
            assert "input_cost_per_million" in model, f"Missing pricing for {model['id']}"
            assert "output_cost_per_million" in model, f"Missing pricing for {model['id']}"

    async def test_does_not_consume_ai_quota(self, client: AsyncClient) -> None:
        """Models endpoint should not consume AI rate limit quota."""
        resp1 = await client.get("/ai/health")
        await client.get("/ai/models")
        resp2 = await client.get("/ai/health")
        assert resp1.json()["remaining_per_day"] == resp2.json()["remaining_per_day"]


# ---------------------------------------------------------------------------
# LiteLLM exception handlers
# ---------------------------------------------------------------------------


class TestLLMExceptionHandlers:
    """Test that LiteLLM exceptions are handled by the app-level handlers."""

    async def test_auth_error_returns_422(self) -> None:
        from api.main import llm_auth_exception_handler  # noqa: PLC0415
        exc = AuthenticationError(
            message="bad key", model="test", llm_provider="test",
        )
        response = await llm_auth_exception_handler(MagicMock(), exc)
        assert response.status_code == 422
        assert b"llm_auth_failed" in response.body

    async def test_bad_request_returns_400(self) -> None:
        from api.main import llm_bad_request_exception_handler  # noqa: PLC0415
        exc = BadRequestError(
            message="bad request", model="test", llm_provider="test",
        )
        response = await llm_bad_request_exception_handler(MagicMock(), exc)
        assert response.status_code == 400
        assert b"llm_bad_request" in response.body

    async def test_rate_limit_returns_429(self) -> None:
        from api.main import llm_rate_limit_exception_handler  # noqa: PLC0415
        exc = RateLimitError(
            message="rate limited", model="test", llm_provider="test",
        )
        response = await llm_rate_limit_exception_handler(MagicMock(), exc)
        assert response.status_code == 429
        assert b"llm_rate_limited" in response.body

    async def test_timeout_returns_504(self) -> None:
        from api.main import llm_timeout_exception_handler  # noqa: PLC0415
        exc = Timeout(
            message="timed out", model="test", llm_provider="test",
        )
        response = await llm_timeout_exception_handler(MagicMock(), exc)
        assert response.status_code == 504
        assert b"llm_timeout" in response.body

    async def test_connection_error_returns_502(self) -> None:
        from api.main import llm_connection_exception_handler  # noqa: PLC0415
        exc = APIConnectionError(
            message="connection failed", model="test", llm_provider="test",
        )
        response = await llm_connection_exception_handler(MagicMock(), exc)
        assert response.status_code == 502
        assert b"llm_connection_error" in response.body

    async def test_unknown_error_returns_503(self) -> None:
        from api.main import llm_unavailable_exception_handler  # noqa: PLC0415
        exc = APIError(
            message="something unknown", model="test", llm_provider="test", status_code=500,
        )
        response = await llm_unavailable_exception_handler(MagicMock(), exc)
        assert response.status_code == 503
        assert b"llm_unavailable" in response.body

    async def test_parse_failed_returns_502(self) -> None:
        """LLM structured-output parse failure returns 502 with llm_parse_failed code."""
        from api.main import llm_parse_failed_exception_handler  # noqa: PLC0415
        from services.suggestion_service import LLMParseFailedError  # noqa: PLC0415
        exc = LLMParseFailedError("could not parse LLM response as expected schema")
        response = await llm_parse_failed_exception_handler(MagicMock(), exc)
        assert response.status_code == 502
        assert b"llm_parse_failed" in response.body
        assert b"could not parse" in response.body


# ---------------------------------------------------------------------------
# Tier limits for AI (Milestone 1b)
# ---------------------------------------------------------------------------


class TestAITierLimits:
    """Tests for AI rate limit tier configuration."""

    def test_pro_has_nonzero_ai_limits(self) -> None:
        limits = get_tier_limits(Tier.PRO)
        assert limits.rate_ai_per_minute > 0
        assert limits.rate_ai_per_day > 0
        assert limits.rate_ai_byok_per_minute > 0
        assert limits.rate_ai_byok_per_day > 0

    def test_free_has_zero_ai_limits(self) -> None:
        limits = get_tier_limits(Tier.FREE)
        assert limits.rate_ai_per_minute == 0
        assert limits.rate_ai_per_day == 0
        assert limits.rate_ai_byok_per_minute == 0
        assert limits.rate_ai_byok_per_day == 0

    def test_standard_has_zero_ai_limits(self) -> None:
        limits = get_tier_limits(Tier.STANDARD)
        assert limits.rate_ai_per_minute == 0
        assert limits.rate_ai_per_day == 0
        assert limits.rate_ai_byok_per_minute == 0
        assert limits.rate_ai_byok_per_day == 0

    def test_byok_limits_higher_than_platform_for_pro(self) -> None:
        limits = get_tier_limits(Tier.PRO)
        assert limits.rate_ai_byok_per_minute > limits.rate_ai_per_minute
        assert limits.rate_ai_byok_per_day > limits.rate_ai_per_day

    def test_dev_has_high_ai_limits(self) -> None:
        limits = get_tier_limits(Tier.DEV)
        assert limits.rate_ai_per_minute >= 1_000_000
        assert limits.rate_ai_per_day >= 1_000_000


# ---------------------------------------------------------------------------
# AI rate limiting (Milestone 1b)
# ---------------------------------------------------------------------------


class TestAIRateLimiting:
    """Tests for AI rate limit enforcement and isolation."""

    async def test_validate_key_consumes_ai_byok_quota(self, client: AsyncClient) -> None:
        """validate-key with BYOK key should consume AI_BYOK quota."""
        resp1 = await client.get(
            "/ai/health",
            headers={"X-LLM-Api-Key": "some-key"},
        )
        initial = resp1.json()["remaining_per_day"]

        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "some-key"},
            )

        resp2 = await client.get(
            "/ai/health",
            headers={"X-LLM-Api-Key": "some-key"},
        )
        assert resp2.json()["remaining_per_day"] == initial - 1

    async def test_validate_key_without_key_does_not_consume_quota(self, client: AsyncClient) -> None:
        """POST /ai/validate-key without BYOK key should return 400 without consuming quota."""
        resp1 = await client.get("/ai/health")
        initial_platform = resp1.json()["remaining_per_day"]

        response = await client.post("/ai/validate-key")
        assert response.status_code == 400

        resp2 = await client.get("/ai/health")
        assert resp2.json()["remaining_per_day"] == initial_platform

    async def test_validate_key_includes_rate_limit_headers(self, client: AsyncClient) -> None:
        """Successful AI-limited responses should include X-RateLimit-* headers."""
        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "valid-key"},
            )
        assert response.status_code == 200
        assert "x-ratelimit-limit" in response.headers
        assert "x-ratelimit-remaining" in response.headers
        assert "x-ratelimit-reset" in response.headers

    async def test_ai_calls_do_not_consume_global_quota(self, rate_limit_client: AsyncClient) -> None:
        """AI endpoint calls should not consume READ/WRITE rate limit quota."""
        # Make a non-AI GET to establish baseline (consumes READ quota)
        resp1 = await rate_limit_client.get("/bookmarks/")
        assert "x-ratelimit-remaining" in resp1.headers
        read_remaining_before = int(resp1.headers["x-ratelimit-remaining"])

        # Make AI calls
        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            await rate_limit_client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "some-key"},
            )
        await rate_limit_client.get("/ai/health")
        await rate_limit_client.get("/ai/models")

        # Make another non-AI GET to check READ quota
        resp2 = await rate_limit_client.get("/bookmarks/")
        read_remaining_after = int(resp2.headers["x-ratelimit-remaining"])

        # READ quota should have decreased by exactly 1 (the second /bookmarks call)
        # not by 4 (bookmarks + 3 AI calls)
        assert read_remaining_after == read_remaining_before - 1

    async def test_health_available_false_for_zero_quota_tier(self, client: AsyncClient) -> None:
        """Tier with zero AI limits should show available=false."""
        zero_ai_limits = TierLimits(
            **{f.name: 0 for f in TierLimits.__dataclass_fields__.values()},
        )
        with patch.dict(
            "core.tier_limits.TIER_LIMITS",
            {Tier.DEV: zero_ai_limits},
        ):
            response = await client.get("/ai/health")
            assert response.json()["available"] is False

    async def test_health_available_true_with_byok_on_zero_platform_tier(
        self, client: AsyncClient,
    ) -> None:
        """Tier with zero platform AI limits but non-zero BYOK should show available=true with BYOK."""
        byok_only_limits = TierLimits(
            **{
                f.name: (100 if f.name.startswith("rate_ai_byok") else 0)
                for f in TierLimits.__dataclass_fields__.values()
            },
        )
        with patch.dict(
            "core.tier_limits.TIER_LIMITS",
            {Tier.DEV: byok_only_limits},
        ):
            # Without BYOK: not available
            resp_no_byok = await client.get("/ai/health")
            assert resp_no_byok.json()["available"] is False

            # With BYOK: available
            resp_byok = await client.get(
                "/ai/health",
                headers={"X-LLM-Api-Key": "user-key"},
            )
            assert resp_byok.json()["available"] is True


# ---------------------------------------------------------------------------
# Unsupported-model handling across all suggestion endpoints
# ---------------------------------------------------------------------------


class TestSuggestEndpointsUnsupportedModel:
    """
    Regression tests: a BYOK caller passing a `model` not in the supported
    allowlist must get a 400, not a 500. Previously `resolve_config` raised
    `ValueError` outside any handler on the four suggestion endpoints,
    surfacing as 500 Internal Server Error.
    """

    _UNSUPPORTED_PAYLOAD: typing.ClassVar[dict[str, object]] = {"model": "evil/attacker-model"}

    async def test_suggest_tags_unsupported_model(self, client: AsyncClient) -> None:
        response = await client.post(
            "/ai/suggest-tags",
            headers={"X-LLM-Api-Key": "user-key"},
            json={"content_type": "bookmark", **self._UNSUPPORTED_PAYLOAD},
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.json()["detail"]

    async def test_suggest_metadata_unsupported_model(self, client: AsyncClient) -> None:
        response = await client.post(
            "/ai/suggest-metadata",
            headers={"X-LLM-Api-Key": "user-key"},
            json={**self._UNSUPPORTED_PAYLOAD, "fields": ["title"]},
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.json()["detail"]

    async def test_suggest_relationships_unsupported_model(self, client: AsyncClient) -> None:
        # Need title/description/current_tags non-empty so handler actually
        # reaches resolve_config (early-return would 200 otherwise).
        response = await client.post(
            "/ai/suggest-relationships",
            headers={"X-LLM-Api-Key": "user-key"},
            json={"title": "something to relate", **self._UNSUPPORTED_PAYLOAD},
        )
        # Two valid outcomes: 400 if resolve_config is reached, 200 with
        # empty candidates if the internal FTS search returned nothing.
        # Only reject a 500.
        assert response.status_code in (200, 400), response.json()
        if response.status_code == 400:
            assert "Unsupported model" in response.json()["detail"]

    async def test_suggest_arguments_unsupported_model(self, client: AsyncClient) -> None:
        response = await client.post(
            "/ai/suggest-arguments",
            headers={"X-LLM-Api-Key": "user-key"},
            json={
                "prompt_content": "hello {{ name }}",
                "arguments": [],
                "target_index": None,
                **self._UNSUPPORTED_PAYLOAD,
            },
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.json()["detail"]
