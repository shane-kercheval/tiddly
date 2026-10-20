"""Integration tests for AI router endpoints."""
import json
import re
import typing
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import litellm
import openai
import pytest
import respx
from httpx import AsyncClient, Request, Response
from litellm import anthropic_beta_headers_manager
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    BadGatewayError,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    ServiceUnavailableError,
    Timeout,
)

from starlette.requests import Request as StarletteRequest

from core.logging_config import FIRST_PARTY_LOGGERS
from core.tier_limits import Tier, TierLimits, get_tier_limits
from services.llm_service import AIUseCase, get_llm_service
from services.suggestion_service import LLMParseFailedError

# A plain word, not a key-shaped string: LiteLLM masks key-shaped strings on
# some loggers, which would hide a leak of the provider text around it.
_PROVIDER_TEXT_MARKER = "zanzibar"

# The API's documented `detail` for each LLM error code.
_ERROR_DETAILS: dict[str, str] = {
    "llm_auth_failed": "LLM authentication failed. Check your API key.",
    "llm_bad_request": "Invalid request to LLM provider.",
    "llm_rate_limited": "LLM provider rate limit exceeded. Try again later.",
    "llm_timeout": "LLM request timed out. Try again.",
    "llm_unavailable": "AI service temporarily unavailable.",
}


def _provider_response(status: int) -> Response:
    """A provider response; some LiteLLM classes need one that carries a request."""
    return Response(status, request=Request("POST", "https://example"))


def _permission_denied_error() -> PermissionDeniedError:
    """
    Build a provider 403. Unlike the other LiteLLM classes used here,
    `PermissionDeniedError` needs a real response that carries a request.
    """
    return PermissionDeniedError(
        message="key lacks access to this model",
        llm_provider="openai",
        model="openai/gpt-5.4-nano",
        response=_provider_response(403),
    )


def _api_request(llm_api_key: str | None = None) -> StarletteRequest:
    """A bare request, with or without the BYOK header, for calling handlers directly."""
    headers = [(b"x-llm-api-key", llm_api_key.encode())] if llm_api_key else []
    return StarletteRequest({"type": "http", "headers": headers})


def _first_party_log_text(caplog: pytest.LogCaptureFixture) -> str:
    """
    Every record from the API's own loggers, formatted message and `extra=`
    fields both, so a leak through either is visible.
    """
    records = [r for r in caplog.records if r.name.split(".")[0] in FIRST_PARTY_LOGGERS]
    return "\n".join(f"{r.getMessage()} {r.__dict__}" for r in records)


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

    async def test_permission_denied_key(self, client: AsyncClient) -> None:
        """A provider 403 is a rejected key here too, not 422 `llm_auth_failed`."""
        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=_permission_denied_error(),
        ):
            response = await client.post(
                "/ai/validate-key",
                headers={"X-LLM-Api-Key": "key-without-model-access"},
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
        from api.main import llm_provider_status_exception_handler  # noqa: PLC0415
        exc = AuthenticationError(
            message="bad key", model="test", llm_provider="test",
        )
        response = await llm_provider_status_exception_handler(_api_request(), exc)
        assert response.status_code == 422
        assert b"llm_auth_failed" in response.body

    async def test_bad_request_returns_400(self) -> None:
        from api.main import llm_provider_status_exception_handler  # noqa: PLC0415
        exc = BadRequestError(
            message="bad request", model="test", llm_provider="test",
        )
        response = await llm_provider_status_exception_handler(_api_request(), exc)
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
        from api.main import llm_provider_status_exception_handler  # noqa: PLC0415
        exc = APIError(
            message="something unknown", model="test", llm_provider="test", status_code=500,
        )
        response = await llm_provider_status_exception_handler(_api_request(), exc)
        assert response.status_code == 503
        assert b"llm_unavailable" in response.body

    @pytest.mark.parametrize(
        ("exc", "expected_status", "expected_code"),
        [
            pytest.param(_permission_denied_error(), 422, "llm_auth_failed", id="403-permission-denied"),
            pytest.param(
                APIError(message="m", model="test", llm_provider="openai", status_code=403),
                422, "llm_auth_failed", id="403-as-litellm-apierror",
            ),
            pytest.param(
                BadRequestError(message="m", model="test", llm_provider="openai", response=_provider_response(401)),
                422, "llm_auth_failed", id="401-as-bad-request",
            ),
            pytest.param(
                NotFoundError(message="m", model="test", llm_provider="openai", response=_provider_response(403)),
                422, "llm_auth_failed", id="403-as-not-found",
            ),
            pytest.param(
                NotFoundError(message="m", model="test", llm_provider="test"),
                400, "llm_bad_request", id="404",
            ),
            pytest.param(
                APIError(message="m", model="test", llm_provider="openai", status_code=409),
                400, "llm_bad_request", id="409-as-litellm-apierror",
            ),
            pytest.param(
                APIError(message="m", model="test", llm_provider="openai", status_code=429),
                429, "llm_rate_limited", id="429-as-litellm-apierror",
            ),
            pytest.param(
                APIError(message="m", model="test", llm_provider="openai", status_code=408),
                504, "llm_timeout", id="408-as-litellm-apierror",
            ),
            pytest.param(
                APIError(message="m", model="test", llm_provider="openai", status_code=504),
                504, "llm_timeout", id="504-as-litellm-apierror",
            ),
            pytest.param(
                InternalServerError(message="m", model="test", llm_provider="test"),
                503, "llm_unavailable", id="500",
            ),
            pytest.param(
                BadGatewayError(message="m", model="test", llm_provider="test"),
                503, "llm_unavailable", id="502",
            ),
            pytest.param(
                ServiceUnavailableError(message="m", model="test", llm_provider="test"),
                503, "llm_unavailable", id="503",
            ),
            pytest.param(
                openai.APIError("m", Request("POST", "https://example"), body=None),
                503, "llm_unavailable", id="no-status",
            ),
        ],
    )
    async def test_maps_by_status_not_class(
        self, exc: Exception, expected_status: int, expected_code: str,
    ) -> None:
        """LiteLLM picks the class from the provider's body as well as its status, so only the status counts."""
        from api.main import llm_provider_status_exception_handler  # noqa: PLC0415
        response = await llm_provider_status_exception_handler(_api_request(), exc)
        assert response.status_code == expected_status
        assert json.loads(response.body) == {
            "detail": _ERROR_DETAILS[expected_code], "error_code": expected_code,
        }

    @pytest.mark.parametrize(("llm_api_key", "byok"), [(None, False), ("sk-user-key-value", True)])
    async def test_log_line_carries_its_fields_in_the_message(
        self, llm_api_key: str | None, byok: bool, caplog: pytest.LogCaptureFixture,
    ) -> None:
        """
        The API's log format prints only the message, so `extra=` fields never
        reach Railway. Whether a user key was sent is logged; its value never is.
        """
        from api.main import llm_provider_status_exception_handler  # noqa: PLC0415
        exc = ServiceUnavailableError(
            message="overloaded", model="openai/gpt-5.4-nano", llm_provider="openai",
        )
        await llm_provider_status_exception_handler(_api_request(llm_api_key), exc)
        messages = [r.getMessage() for r in caplog.records if r.name == "api.main"]
        assert messages[-1] == (
            "llm_provider_status code=llm_unavailable status=503 "
            f"class=ServiceUnavailableError model=openai/gpt-5.4-nano byok={byok}"
        )
        assert "sk-user-key-value" not in _first_party_log_text(caplog)

    async def test_provider_text_stays_out_of_logs_and_response(
        self, caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Provider error text can echo part of the key, so it is never logged or returned."""
        from api.main import llm_provider_status_exception_handler  # noqa: PLC0415
        exc = AuthenticationError(
            message=f"Incorrect API key provided: {_PROVIDER_TEXT_MARKER}",
            model="openai/gpt-5.4-nano",
            llm_provider="openai",
        )
        response = await llm_provider_status_exception_handler(_api_request("k"), exc)
        assert _PROVIDER_TEXT_MARKER.encode() not in response.body
        log_text = _first_party_log_text(caplog)
        assert "llm_provider_status" in log_text
        assert _PROVIDER_TEXT_MARKER not in log_text

    async def test_provider_5xx_through_app_returns_503(self, client: AsyncClient) -> None:
        """A provider outage on a suggestion endpoint reaches the caller as a typed 503."""
        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=ServiceUnavailableError(
                message="overloaded", model="openai/gpt-5.4-nano", llm_provider="openai",
            ),
        ):
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Flask REST API Tutorial", "content_type": "bookmark"},
            )
        assert response.status_code == 503
        assert response.json()["error_code"] == "llm_unavailable"

    async def test_connection_error_through_app_returns_502(self, client: AsyncClient) -> None:
        """
        The connection handler still wins over the status handler, which would
        answer `APIConnectionError` (status 500) with 503. Built by hand because
        LiteLLM 1.106.0 translates a refused connection into
        `InternalServerError` (a 503 here), not `APIConnectionError`.
        """
        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=APIConnectionError(
                message="connection failed", model="openai/gpt-5.4-nano", llm_provider="openai",
            ),
        ):
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Flask REST API Tutorial", "content_type": "bookmark"},
            )
        assert response.status_code == 502
        assert response.json()["error_code"] == "llm_connection_error"

    async def test_parse_failed_returns_502(self) -> None:
        """LLM structured-output parse failure returns 502 with llm_parse_failed code."""
        from api.main import llm_parse_failed_exception_handler  # noqa: PLC0415

        exc = LLMParseFailedError("could not parse LLM response as expected schema")
        response = await llm_parse_failed_exception_handler(MagicMock(), exc)
        assert response.status_code == 502
        assert b"llm_parse_failed" in response.body
        assert b"could not parse" in response.body


# ---------------------------------------------------------------------------
# Provider errors through LiteLLM's real error translation
# ---------------------------------------------------------------------------

_OPENAI_URL = "https://api.openai.com/v1/chat/completions"
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_GEMINI_URL = re.compile(r"https://generativelanguage\.googleapis\.com/.*")

# Google's reply to an invalid key, captured verbatim from the live API on
# 2026-10-19 with a made-up key. Google answers HTTP 400; LiteLLM recognizes the
# bad key by this message's wording and raises `AuthenticationError`, whose own
# default status (401) is what makes it a rejected key here. If LiteLLM ever
# copied Google's 400 instead, this row would catch it.
_GOOGLE_BAD_KEY_REPLY = {
    "error": {
        "code": 400,
        "message": "API key not valid. Please pass a valid API key.",
        "status": "INVALID_ARGUMENT",
        "details": [
            {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                "reason": "API_KEY_INVALID",
                "domain": "googleapis.com",
                "metadata": {"service": "generativelanguage.googleapis.com"},
            },
            {
                "@type": "type.googleapis.com/google.rpc.LocalizedMessage",
                "locale": "en-US",
                "message": "API key not valid. Please pass a valid API key.",
            },
        ],
    },
}


def _openai_error(message: str, error_type: str | None, code: str | None = None) -> dict:
    return {"error": {"message": f"{message} {_PROVIDER_TEXT_MARKER}", "type": error_type, "code": code}}


def _anthropic_error(error_type: str) -> dict:
    return {"type": "error", "error": {"type": error_type, "message": f"failed {_PROVIDER_TEXT_MARKER}"}}


def _google_error(code: int, status: str, message: str) -> dict:
    return {"error": {"code": code, "message": f"{message} {_PROVIDER_TEXT_MARKER}", "status": status}}


# (model, provider URL, provider status, provider body, API status, API error code).
# The OpenAI 403 rows differ only in body, and LiteLLM 1.106.0 raises a
# different class for each (`APIError`, `BadRequestError`, `NotFoundError`).
_PROVIDER_ERROR_CASES = [
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 403,
        _openai_error("Country, region, or territory not supported", "request_forbidden",
                      "unsupported_country_region_territory"),
        422, "llm_auth_failed", id="openai-403-request-forbidden",
    ),
    pytest.param("openai/gpt-5.4-nano", _OPENAI_URL, 403, {}, 422, "llm_auth_failed", id="openai-403-no-body"),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 403,
        _openai_error("You are not allowed to sample from this model", "invalid_request_error"),
        422, "llm_auth_failed", id="openai-403-invalid-request",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 403,
        _openai_error("Project does not have access to model", "invalid_request_error", "model_not_found"),
        422, "llm_auth_failed", id="openai-403-model-not-found",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 401,
        _openai_error("You didn't provide an API key.", "invalid_request_error"),
        422, "llm_auth_failed", id="openai-401-no-key",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 401,
        _openai_error("Incorrect API key provided:", "invalid_request_error", "invalid_api_key"),
        422, "llm_auth_failed", id="openai-401-incorrect-key",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 404,
        _openai_error("The model does not exist", "invalid_request_error", "model_not_found"),
        400, "llm_bad_request", id="openai-404-model-not-found",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 409, _openai_error("Conflict", "invalid_request_error"),
        400, "llm_bad_request", id="openai-409",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 500, _openai_error("Server error", "server_error"),
        503, "llm_unavailable", id="openai-500",
    ),
    pytest.param(
        "openai/gpt-5.4-nano", _OPENAI_URL, 503, _openai_error("Overloaded", "server_error"),
        503, "llm_unavailable", id="openai-503",
    ),
    pytest.param(
        "anthropic/claude-haiku-4-5", _ANTHROPIC_URL, 403, _anthropic_error("permission_error"),
        422, "llm_auth_failed", id="anthropic-403",
    ),
    pytest.param(
        "anthropic/claude-haiku-4-5", _ANTHROPIC_URL, 529, _anthropic_error("overloaded_error"),
        503, "llm_unavailable", id="anthropic-529",
    ),
    pytest.param(
        "gemini/gemini-flash-lite-latest", _GEMINI_URL, 400, _GOOGLE_BAD_KEY_REPLY,
        422, "llm_auth_failed", id="gemini-400-bad-key",
    ),
    pytest.param(
        "gemini/gemini-flash-lite-latest", _GEMINI_URL, 403,
        _google_error(403, "PERMISSION_DENIED", "Permission denied on resource project."),
        422, "llm_auth_failed", id="gemini-403-permission-denied",
    ),
    pytest.param(
        "gemini/gemini-flash-lite-latest", _GEMINI_URL, 503,
        _google_error(503, "UNAVAILABLE", "The model is overloaded. Please try again later."),
        503, "llm_unavailable", id="gemini-503",
    ),
]


@pytest.fixture
def provider_http(monkeypatch: pytest.MonkeyPatch) -> Iterator[respx.MockRouter]:
    """
    Fake the providers' HTTP endpoints so LiteLLM's real error translation runs.

    respx sees only httpx's transport, so LiteLLM's default aiohttp transport
    is switched off and its client cache flushed: a client built earlier in the
    session (the live smoke test builds them) would bypass the mock. The
    Anthropic beta-header file comes from LiteLLM's bundled copy instead of
    GitHub, and LiteLLM's module-level cache of it is restored afterwards, so a
    later test in the session (the live smoke test) still loads the downloaded
    copy, as production does.
    """
    monkeypatch.setattr(litellm, "disable_aiohttp_transport", True)
    monkeypatch.setenv("LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS", "True")
    monkeypatch.setattr(
        anthropic_beta_headers_manager,
        "_BETA_HEADERS_CONFIG",
        anthropic_beta_headers_manager._BETA_HEADERS_CONFIG,
    )
    litellm.in_memory_llm_clients_cache.flush_cache()
    with respx.mock(assert_all_called=False) as router:
        yield router
    litellm.in_memory_llm_clients_cache.flush_cache()


class TestProviderErrorsThroughLiteLLM:
    """
    A provider's HTTP error, translated by LiteLLM itself, reaches the caller
    as the documented response. Tests that build LiteLLM exceptions by hand
    encode an assumption about which class LiteLLM raises; these don't.
    """

    @pytest.mark.parametrize(
        ("model", "url", "provider_status", "provider_body", "expected_status", "expected_code"),
        _PROVIDER_ERROR_CASES,
    )
    async def test_suggestion_endpoint(
        self,
        client: AsyncClient,
        provider_http: respx.MockRouter,
        caplog: pytest.LogCaptureFixture,
        model: str,
        url: str | re.Pattern[str],
        provider_status: int,
        provider_body: dict,
        expected_status: int,
        expected_code: str,
    ) -> None:
        route = provider_http.post(url).mock(return_value=Response(provider_status, json=provider_body))
        response = await client.post(
            "/ai/suggest-tags",
            headers={"X-LLM-Api-Key": "test-byok-key"},
            json={"title": "Flask REST API Tutorial", "content_type": "bookmark", "model": model},
        )
        assert route.called, "the request bypassed the mocked provider"
        assert response.status_code == expected_status
        assert response.json() == {"detail": _ERROR_DETAILS[expected_code], "error_code": expected_code}
        assert _PROVIDER_TEXT_MARKER not in response.text
        log_text = _first_party_log_text(caplog)
        assert f"llm_provider_status code={expected_code} status=" in log_text
        assert f"model={model} byok=True" in log_text
        assert _PROVIDER_TEXT_MARKER not in log_text
        assert "test-byok-key" not in log_text

    @pytest.mark.parametrize(
        ("model", "url", "provider_status", "provider_body", "expected_status", "expected_code"),
        _PROVIDER_ERROR_CASES,
    )
    async def test_key_check(
        self,
        client: AsyncClient,
        provider_http: respx.MockRouter,
        model: str,
        url: str | re.Pattern[str],
        provider_status: int,
        provider_body: dict,
        expected_status: int,
        expected_code: str,
    ) -> None:
        """
        Every reply a suggestion endpoint answers with `llm_auth_failed` is a
        rejected key here (200 `valid: false`); anything else keeps its status.
        """
        route = provider_http.post(url).mock(return_value=Response(provider_status, json=provider_body))
        response = await client.post(
            "/ai/validate-key",
            headers={"X-LLM-Api-Key": "test-byok-key"},
            json={"model": model},
        )
        assert route.called, "the request bypassed the mocked provider"
        if expected_code == "llm_auth_failed":
            assert response.status_code == 200
            assert response.json() == {"valid": False, "error": "API key rejected by provider"}
        else:
            assert response.status_code == expected_status
            assert response.json()["error_code"] == expected_code
        assert _PROVIDER_TEXT_MARKER not in response.text

    @pytest.mark.parametrize(
        ("provider_reply", "expected_status", "expected_code"),
        [
            pytest.param(
                Response(429, json=_openai_error("Rate limit reached", "requests")),
                429, "llm_rate_limited", id="429-rate-limit",
            ),
            pytest.param(
                Response(504, json=_openai_error("Gateway timeout", "server_error")),
                504, "llm_timeout", id="504-timeout",
            ),
        ],
    )
    async def test_class_handlers_still_win(
        self,
        client: AsyncClient,
        provider_http: respx.MockRouter,
        caplog: pytest.LogCaptureFixture,
        provider_reply: Response,
        expected_status: int,
        expected_code: str,
    ) -> None:
        """
        LiteLLM raises `RateLimitError` for a 429 and `Timeout` (status 504)
        for a 504; their class handlers must answer, not the status handler.
        The status handler would return the same responses, so the test tells
        the two apart by which handler logged.
        """
        route = provider_http.post(_OPENAI_URL).mock(return_value=provider_reply)
        response = await client.post(
            "/ai/suggest-tags",
            headers={"X-LLM-Api-Key": "test-byok-key"},
            json={"title": "Flask", "content_type": "bookmark", "model": "openai/gpt-5.4-nano"},
        )
        assert route.called, "the request bypassed the mocked provider"
        assert response.status_code == expected_status
        assert response.json()["error_code"] == expected_code
        messages = [r.getMessage() for r in caplog.records if r.name == "api.main"]
        assert expected_code in messages
        assert not any(m.startswith("llm_provider_status") for m in messages)


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
        """
        Unsupported-model validation must happen before any early-return
        path, so the 400 contract is consistent regardless of whether the
        caller's search inputs are empty or whether candidate search finds
        matches. Previously the check ran after early returns and would
        silently let an invalid `model` slip through as 200 `{"candidates": []}`.
        """
        # Empty inputs path — previously produced 200; must now produce 400.
        response = await client.post(
            "/ai/suggest-relationships",
            headers={"X-LLM-Api-Key": "user-key"},
            json={**self._UNSUPPORTED_PAYLOAD},
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.json()["detail"]

        # With inputs but no matching candidates — same outcome.
        response = await client.post(
            "/ai/suggest-relationships",
            headers={"X-LLM-Api-Key": "user-key"},
            json={"title": "something to relate", **self._UNSUPPORTED_PAYLOAD},
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.json()["detail"]

    async def test_suggest_prompt_arguments_unsupported_model(self, client: AsyncClient) -> None:
        response = await client.post(
            "/ai/suggest-prompt-arguments",
            headers={"X-LLM-Api-Key": "user-key"},
            json={
                "prompt_content": "hello {{ name }}",
                "arguments": [],
                **self._UNSUPPORTED_PAYLOAD,
            },
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.json()["detail"]
