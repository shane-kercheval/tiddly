"""Integration tests for AI router endpoints."""
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient

from services.llm_service import AIUseCase, get_llm_service


# ---------------------------------------------------------------------------
# GET /ai/health
# ---------------------------------------------------------------------------


class TestAIHealth:

    async def test_returns_available(self, client: AsyncClient) -> None:
        response = await client.get("/ai/health")
        assert response.status_code == 200
        data = response.json()
        assert data["available"] is True
        assert data["byok"] is False

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


# ---------------------------------------------------------------------------
# POST /ai/validate-key
# ---------------------------------------------------------------------------


class TestValidateKey:

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
        from litellm.exceptions import AuthenticationError

        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=AuthenticationError(
                message="Invalid key",
                model="gemini/gemini-2.5-flash-lite",
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

    async def test_timeout_propagates_to_global_handler(self, client: AsyncClient) -> None:
        """Timeout during validation should return 504, not valid=false."""
        from litellm.exceptions import Timeout

        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=Timeout(
                message="timed out",
                model="gemini/gemini-2.5-flash-lite",
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
        from litellm.exceptions import RateLimitError

        with patch(
            "services.llm_service.acompletion",
            new_callable=AsyncMock,
            side_effect=RateLimitError(
                message="rate limited",
                model="gemini/gemini-2.5-flash-lite",
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

    async def test_returns_model_list(self, client: AsyncClient) -> None:
        response = await client.get("/ai/models")
        assert response.status_code == 200
        data = response.json()
        assert "models" in data
        assert "defaults" in data
        assert len(data["models"]) == 9

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


# ---------------------------------------------------------------------------
# LiteLLM exception handlers
# ---------------------------------------------------------------------------


class TestLLMExceptionHandlers:
    """Test that LiteLLM exceptions are handled by the app-level handlers.

    Handlers are defined inline in main.py. We test them by directly invoking
    the handler functions and by testing propagation through validate-key.
    """

    async def test_auth_error_returns_422(self, client: AsyncClient) -> None:
        from litellm.exceptions import AuthenticationError

        from api.main import llm_auth_exception_handler

        exc = AuthenticationError(
            message="bad key", model="test", llm_provider="test",
        )
        response = await llm_auth_exception_handler(MagicMock(), exc)
        assert response.status_code == 422
        assert b"llm_auth_failed" in response.body

    async def test_bad_request_returns_400(self, client: AsyncClient) -> None:
        from litellm.exceptions import BadRequestError

        from api.main import llm_bad_request_exception_handler

        exc = BadRequestError(
            message="bad request", model="test", llm_provider="test",
        )
        response = await llm_bad_request_exception_handler(MagicMock(), exc)
        assert response.status_code == 400
        assert b"llm_bad_request" in response.body

    async def test_rate_limit_returns_429(self, client: AsyncClient) -> None:
        from litellm.exceptions import RateLimitError

        from api.main import llm_rate_limit_exception_handler

        exc = RateLimitError(
            message="rate limited", model="test", llm_provider="test",
        )
        response = await llm_rate_limit_exception_handler(MagicMock(), exc)
        assert response.status_code == 429
        assert b"llm_rate_limited" in response.body

    async def test_timeout_returns_504(self, client: AsyncClient) -> None:
        from litellm.exceptions import Timeout

        from api.main import llm_timeout_exception_handler

        exc = Timeout(
            message="timed out", model="test", llm_provider="test",
        )
        response = await llm_timeout_exception_handler(MagicMock(), exc)
        assert response.status_code == 504
        assert b"llm_timeout" in response.body

    async def test_connection_error_returns_502(self, client: AsyncClient) -> None:
        from litellm.exceptions import APIConnectionError

        from api.main import llm_connection_exception_handler

        exc = APIConnectionError(
            message="connection failed", model="test", llm_provider="test",
        )
        response = await llm_connection_exception_handler(MagicMock(), exc)
        assert response.status_code == 502
        assert b"llm_connection_error" in response.body

    async def test_unknown_error_returns_503(self, client: AsyncClient) -> None:
        from litellm.exceptions import APIError

        from api.main import llm_unavailable_exception_handler

        exc = APIError(
            message="something unknown", model="test", llm_provider="test", status_code=500,
        )
        response = await llm_unavailable_exception_handler(MagicMock(), exc)
        assert response.status_code == 503
        assert b"llm_unavailable" in response.body
