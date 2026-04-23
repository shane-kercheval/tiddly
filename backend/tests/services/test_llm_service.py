"""Unit tests for LLMService."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from core.config import Settings
from services.llm_service import (
    AIUseCase,
    KeySource,
    LLMConfig,
    LLMService,
    _get_model_cost,
    _normalize_temperature,
    _resolve_platform_key,
    _sanitize_structured_content,
    build_supported_models,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(**overrides: str) -> MagicMock:
    """Create a mock Settings with LLM defaults."""
    defaults = {
        "llm_model_suggestions": "gemini/gemini-flash-lite-latest",
        "llm_model_transform": "gemini/gemini-flash-lite-latest",
        "llm_model_auto_complete": "gemini/gemini-flash-lite-latest",
        "llm_model_chat": "openai/gpt-5.4-mini",
        "gemini_api_key": "test-gemini-key",
        "openai_api_key": "test-openai-key",
        "anthropic_api_key": "test-anthropic-key",
        "llm_timeout_default": 30,
        "llm_timeout_streaming": 60,
    }
    defaults.update(overrides)
    settings = MagicMock(spec=Settings)
    for key, value in defaults.items():
        setattr(settings, key, value)
    return settings


# ---------------------------------------------------------------------------
# _resolve_platform_key
# ---------------------------------------------------------------------------


class TestResolvePlatformKey:
    """Tests for _resolve_platform_key."""

    def test_gemini_prefix(self) -> None:
        settings = _make_settings()
        assert _resolve_platform_key("gemini/gemini-flash-latest", settings) == "test-gemini-key"

    def test_openai_prefix(self) -> None:
        settings = _make_settings()
        assert _resolve_platform_key("openai/gpt-4o-mini", settings) == "test-openai-key"

    def test_anthropic_prefix(self) -> None:
        settings = _make_settings()
        assert _resolve_platform_key("anthropic/claude-haiku-4-5", settings) == "test-anthropic-key"

    def test_unknown_prefix_raises(self) -> None:
        settings = _make_settings()
        with pytest.raises(ValueError, match="Unknown model prefix"):
            _resolve_platform_key("unknown-provider/some-model", settings)


# ---------------------------------------------------------------------------
# _get_model_cost
# ---------------------------------------------------------------------------


class TestGetModelCost:
    """Tests for _get_model_cost."""

    def test_prefixed_key_found(self) -> None:
        """Gemini models are in cost map with prefix."""
        cost = _get_model_cost("gemini/gemini-flash-lite-latest")
        assert cost is not None
        assert "input_cost_per_token" in cost

    def test_unprefixed_fallback(self) -> None:
        """OpenAI/Anthropic models are in cost map without prefix — fallback works."""
        cost = _get_model_cost("openai/gpt-4o-mini")
        assert cost is not None
        assert "input_cost_per_token" in cost

    def test_completely_unknown_model(self) -> None:
        cost = _get_model_cost("unknown/nonexistent-model-xyz")
        assert cost is None


# ---------------------------------------------------------------------------
# build_supported_models
# ---------------------------------------------------------------------------


class TestBuildSupportedModels:
    """Tests for build_supported_models."""

    def test_returns_all_models(self) -> None:
        models = build_supported_models()
        assert len(models) == 7  # 1 Google + 3 OpenAI + 3 Anthropic (Gemini flash/pro disabled)

    def test_all_models_have_required_fields(self) -> None:
        models = build_supported_models()
        for model in models:
            assert model.id
            assert model.provider
            assert model.tier

    def test_all_models_have_pricing(self) -> None:
        """All curated models should have pricing in LiteLLM's cost map."""
        models = build_supported_models()
        for model in models:
            assert model.input_cost_per_million is not None, f"Missing pricing for {model.id}"
            assert model.output_cost_per_million is not None, f"Missing pricing for {model.id}"
            assert model.input_cost_per_million > 0
            assert model.output_cost_per_million > 0

    def test_tiers_per_provider(self) -> None:
        """OpenAI and Anthropic have all three tiers. Google has budget only (flash/pro disabled)."""
        models = build_supported_models()
        for provider in ["openai", "anthropic"]:
            provider_models = [m for m in models if m.provider == provider]
            tiers = {m.tier for m in provider_models}
            assert tiers == {"budget", "balanced", "flagship"}, f"Missing tiers for {provider}"
        google_models = [m for m in models if m.provider == "google"]
        assert {m.tier for m in google_models} == {"budget"}

    def test_service_stores_supported_models(self) -> None:
        """LLMService instance should have supported_models populated."""
        service = LLMService(_make_settings())
        assert len(service.supported_models) == 7


# ---------------------------------------------------------------------------
# LLMService.resolve_config
# ---------------------------------------------------------------------------


class TestResolveConfig:
    """Tests for LLMService.resolve_config."""

    def test_platform_config_suggestions(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(AIUseCase.SUGGESTIONS)
        assert config.model == "gemini/gemini-flash-lite-latest"
        assert config.api_key == "test-gemini-key"
        assert config.key_source == KeySource.PLATFORM

    def test_chat_uses_different_model(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(AIUseCase.CHAT)
        assert config.model == "openai/gpt-5.4-mini"

    def test_user_key_overrides_platform(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(AIUseCase.SUGGESTIONS, user_api_key="user-key-123")
        assert config.api_key == "user-key-123"
        assert config.key_source == KeySource.USER
        # Falls back to use-case default model
        assert config.model == "gemini/gemini-flash-lite-latest"

    def test_user_key_with_user_model(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(
            AIUseCase.SUGGESTIONS,
            user_api_key="user-key-123",
            user_model="anthropic/claude-sonnet-4-6",
        )
        assert config.model == "anthropic/claude-sonnet-4-6"
        assert config.api_key == "user-key-123"
        assert config.key_source == KeySource.USER

    def test_unsupported_user_model_raises(self) -> None:
        """Arbitrary model strings are rejected to prevent SSRF via LiteLLM routing."""
        service = LLMService(_make_settings())
        with pytest.raises(ValueError, match="Unsupported model"):
            service.resolve_config(
                AIUseCase.SUGGESTIONS,
                user_api_key="user-key-123",
                user_model="openai/evil-model-with-custom-base",
            )

    def test_unsupported_model_without_key_ignored(self) -> None:
        """Unsupported model without BYOK key is silently ignored (platform default used)."""
        service = LLMService(_make_settings())
        config = service.resolve_config(
            AIUseCase.SUGGESTIONS,
            user_model="openai/evil-model",
        )
        assert config.model == "gemini/gemini-flash-lite-latest"
        assert config.key_source == KeySource.PLATFORM

    def test_user_model_ignored_without_user_key(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(
            AIUseCase.SUGGESTIONS,
            user_model="anthropic/claude-sonnet-4-6",
        )
        assert config.model == "gemini/gemini-flash-lite-latest"
        assert config.key_source == KeySource.PLATFORM

    def test_all_use_cases_resolve(self) -> None:
        service = LLMService(_make_settings())
        for use_case in AIUseCase:
            config = service.resolve_config(use_case)
            assert config.key_source == KeySource.PLATFORM
            assert config.api_key  # non-empty


# ---------------------------------------------------------------------------
# LLMService.get_model_for_use_case
# ---------------------------------------------------------------------------


class TestGetModelForUseCase:
    """Tests for LLMService.get_model_for_use_case."""

    def test_returns_platform_model(self) -> None:
        service = LLMService(_make_settings())
        assert service.get_model_for_use_case(AIUseCase.SUGGESTIONS) == "gemini/gemini-flash-lite-latest"
        assert service.get_model_for_use_case(AIUseCase.CHAT) == "openai/gpt-5.4-mini"


# ---------------------------------------------------------------------------
# LLMService.complete
# ---------------------------------------------------------------------------


class TestComplete:
    """Tests for LLMService.complete."""

    async def test_calls_acompletion_with_correct_args(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-lite-latest", api_key="key", key_source=KeySource.PLATFORM)

        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.001),
        ):
            response, cost = await service.complete(
                messages=[{"role": "user", "content": "Hello"}],
                config=config,
            )

            mock_acomp.assert_called_once()
            call_kwargs = mock_acomp.call_args.kwargs
            assert call_kwargs["model"] == "gemini/gemini-flash-lite-latest"
            assert call_kwargs["api_key"] == "key"
            assert call_kwargs["timeout"] == 30
            assert call_kwargs["num_retries"] == 1
            assert call_kwargs["temperature"] == 0.7
            assert "response_format" not in call_kwargs
            assert response is mock_response
            assert cost == 0.001

    async def test_passes_response_format(self) -> None:
        class TestSchema(BaseModel):
            name: str

        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-lite-latest", api_key="key", key_source=KeySource.PLATFORM)

        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
                response_format=TestSchema,
            )
            assert mock_acomp.call_args.kwargs["response_format"] is TestSchema

    async def test_passes_max_tokens(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-lite-latest", api_key="key", key_source=KeySource.PLATFORM)

        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
                max_tokens=5,
            )
            assert mock_acomp.call_args.kwargs["max_tokens"] == 5

    async def test_o_series_temperature_normalized(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="openai/o4-mini", api_key="key", key_source=KeySource.USER)

        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
                temperature=0.5,
            )
            assert mock_acomp.call_args.kwargs["temperature"] == 1.0

    async def test_sanitizes_structured_content(self) -> None:
        class TestSchema(BaseModel):
            name: str

        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-latest", api_key="key", key_source=KeySource.PLATFORM)

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = 'Here is JSON:\n{"name": "test"}'

        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            response, _ = await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
                response_format=TestSchema,
            )
            assert response.choices[0].message.content == '{"name": "test"}'

    async def test_no_sanitize_without_response_format(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-latest", api_key="key", key_source=KeySource.PLATFORM)

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Here is some text with no JSON"

        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            response, _ = await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
            )
            assert response.choices[0].message.content == "Here is some text with no JSON"

    async def test_completion_cost_failure_returns_none(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-lite-latest", api_key="key", key_source=KeySource.PLATFORM)

        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", side_effect=Exception("unknown model")),
        ):
            response, cost = await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
            )
            assert response is mock_response
            assert cost is None

    async def test_cost_from_completion_cost(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-lite-latest", api_key="key", key_source=KeySource.PLATFORM)

        mock_response = MagicMock()
        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
            patch("services.llm_service.completion_cost", return_value=0.0042) as mock_cost,
        ):
            _, cost = await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
            )
            mock_cost.assert_called_once_with(completion_response=mock_response, model="gemini-flash-lite-latest")
            assert cost == 0.0042


# ---------------------------------------------------------------------------
# LLMService.stream
# ---------------------------------------------------------------------------


class TestStream:
    """Tests for LLMService.stream."""

    async def test_calls_acompletion_with_stream_args(self) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model="gemini/gemini-flash-latest", api_key="key", key_source=KeySource.PLATFORM)

        mock_iter = AsyncMock()
        with patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_iter) as mock_acomp:
            result = await service.stream(
                messages=[{"role": "user", "content": "Hello"}],
                config=config,
            )

            mock_acomp.assert_called_once()
            call_kwargs = mock_acomp.call_args.kwargs
            assert call_kwargs["stream"] is True
            assert call_kwargs["timeout"] == 60
            assert "num_retries" not in call_kwargs
            assert result is mock_iter


# ---------------------------------------------------------------------------
# _normalize_temperature
# ---------------------------------------------------------------------------


class TestNormalizeTemperature:
    """Tests for _normalize_temperature."""

    def test_regular_model_passes_through(self) -> None:
        assert _normalize_temperature("gemini/gemini-flash-latest", 0.7) == 0.7
        assert _normalize_temperature("openai/gpt-4o-mini", 0.0) == 0.0
        assert _normalize_temperature("anthropic/claude-haiku-4-5", 0.5) == 0.5
        assert _normalize_temperature("openai/gpt-4o", 0.3) == 0.3

    def test_temperature_1_only_models_clamped(self) -> None:
        assert _normalize_temperature("openai/o4-mini", 0.7) == 1.0
        assert _normalize_temperature("openai/o4-mini", 0.0) == 1.0


# ---------------------------------------------------------------------------
# _sanitize_structured_content
# ---------------------------------------------------------------------------


def _make_response(content: str) -> MagicMock:
    """Create a mock LLM response with one choice."""
    choice = MagicMock()
    choice.message.content = content
    response = MagicMock()
    response.choices = [choice]
    return response


class TestSanitizeStructuredContent:
    """Tests for _sanitize_structured_content."""

    def test_clean_json_unchanged(self) -> None:
        response = _make_response('{"greeting": "hello"}')
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == '{"greeting": "hello"}'

    def test_clean_json_array_unchanged(self) -> None:
        response = _make_response('[1, 2, 3]')
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == '[1, 2, 3]'

    def test_strips_markdown_fences(self) -> None:
        response = _make_response('```json\n{"greeting": "hello"}\n```')
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == '{"greeting": "hello"}'

    def test_strips_markdown_fences_no_lang(self) -> None:
        response = _make_response('```\n{"greeting": "hello"}\n```')
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == '{"greeting": "hello"}'

    def test_extracts_json_from_preamble(self) -> None:
        response = _make_response('Here is the JSON requested:\n{"greeting": "hello"}')
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == '{"greeting": "hello"}'

    def test_extracts_json_array_from_preamble(self) -> None:
        response = _make_response('Sure, here you go:\n[{"name": "test"}]')
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == '[{"name": "test"}]'

    def test_empty_content_unchanged(self) -> None:
        response = _make_response("")
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == ""

    def test_none_content_unchanged(self) -> None:
        response = _make_response(None)
        _sanitize_structured_content(response)
        assert response.choices[0].message.content is None

    def test_no_json_found_leaves_content(self) -> None:
        response = _make_response("No JSON here at all")
        _sanitize_structured_content(response)
        assert response.choices[0].message.content == "No JSON here at all"
