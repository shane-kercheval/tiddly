"""Unit tests for LLMService."""
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from core.config import Settings
from services.llm_service import (
    _MODEL_REQUEST_SETTINGS,
    _PROVIDER_KEY_MAP,
    _RETIRED_MODEL_REPLACEMENTS,
    _SUPPORTED_MODEL_DEFS,
    AIUseCase,
    KeySource,
    LLMConfig,
    LLMService,
    UnsupportedModelError,
    _get_model_cost,
    _resolve_platform_key,
    _sanitize_structured_content,
    build_supported_models,
    model_request_settings,
)

# One model from the table that keeps the temperature, one that omits it, and
# one with no entry. Expected kwargs come from the plan's settings table
# (docs/implementation_plans/2026-10-19-llm-model-refresh.md, milestone 2).
_COMPLETE_AND_STREAM_CASES = [
    pytest.param("openai/gpt-6-luna", {"temperature": 0.5, "reasoning_effort": "none"}, id="luna"),
    pytest.param("anthropic/claude-haiku-5-5", {"thinking": {"type": "disabled"}}, id="haiku-5-5"),
    pytest.param("openai/gpt-4o", {"temperature": 0.5}, id="not-in-table"),
]


def _per_model_kwargs(call_kwargs: dict) -> dict:
    """The kwargs the settings table decides, out of everything sent to `acompletion`."""
    return {k: v for k, v in call_kwargs.items() if k in ("temperature", "reasoning_effort", "thinking")}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(**overrides: str) -> MagicMock:
    """Create a mock Settings with LLM defaults."""
    defaults = {
        "llm_model_suggestions": "openai/gpt-6-luna",
        "llm_model_transform": "gemini/gemini-3.5-flash-lite",
        "llm_model_auto_complete": "gemini/gemini-3.5-flash-lite",
        "llm_model_chat": "openai/gpt-6.1-sol",
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
        assert _resolve_platform_key("anthropic/claude-haiku-5-5", settings) == "test-anthropic-key"

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
        cost = _get_model_cost("gemini/gemini-3.5-flash-lite")
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
        assert config.model == "openai/gpt-6-luna"
        assert config.api_key == "test-openai-key"
        assert config.key_source == KeySource.PLATFORM

    def test_chat_uses_different_model(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(AIUseCase.CHAT)
        assert config.model == "openai/gpt-6.1-sol"

    def test_user_key_overrides_platform(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(AIUseCase.SUGGESTIONS, user_api_key="user-key-123")
        assert config.api_key == "user-key-123"
        assert config.key_source == KeySource.USER
        # Falls back to use-case default model
        assert config.model == "openai/gpt-6-luna"

    def test_user_key_with_user_model(self) -> None:
        service = LLMService(_make_settings())
        config = service.resolve_config(
            AIUseCase.SUGGESTIONS,
            user_api_key="user-key-123",
            user_model="anthropic/claude-sonnet-5-5",
        )
        assert config.model == "anthropic/claude-sonnet-5-5"
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
        assert config.model == "openai/gpt-6-luna"
        assert config.key_source == KeySource.PLATFORM

    def test_user_model_ignored_without_user_key(self, caplog: pytest.LogCaptureFixture) -> None:
        """Without a key, even a retired `user_model` is ignored: no remap, platform default."""
        caplog.set_level(logging.INFO, logger="services.llm_service")
        service = LLMService(_make_settings())
        config = service.resolve_config(
            AIUseCase.SUGGESTIONS,
            user_model="anthropic/claude-sonnet-4-6",
        )
        assert config.model == "openai/gpt-6-luna"
        assert config.key_source == KeySource.PLATFORM
        assert not any("byok_model_remapped" in r.getMessage() for r in caplog.records)

    def test_all_use_cases_resolve(self) -> None:
        service = LLMService(_make_settings())
        for use_case in AIUseCase:
            config = service.resolve_config(use_case)
            assert config.key_source == KeySource.PLATFORM
            assert config.api_key  # non-empty

    @pytest.mark.parametrize(
        ("retired", "replacement"),
        [
            # Expected values are the plan's map (milestone 4), not the code's.
            ("openai/gpt-5.4-nano", "openai/gpt-6-luna"),
            ("openai/gpt-5.4-mini", "openai/gpt-6-luna"),
            ("openai/gpt-5.4", "openai/gpt-6-luna"),
            ("anthropic/claude-haiku-4-5", "anthropic/claude-haiku-5-5"),
            ("anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-5-5"),
            ("anthropic/claude-opus-4-6", "anthropic/claude-opus-5-5"),
            ("gemini/gemini-flash-lite-latest", "gemini/gemini-3.5-flash-lite"),
        ],
    )
    def test_retired_byok_model_is_replaced(
        self, retired: str, replacement: str, caplog: pytest.LogCaptureFixture,
    ) -> None:
        """A BYOK caller's stale model ID from a previous allowlist keeps working."""
        # The API sets its own loggers to INFO at startup (core/logging_config.py); this
        # module never imports the app, so set the level the API runs at.
        caplog.set_level(logging.INFO, logger="services.llm_service")
        service = LLMService(_make_settings())
        config = service.resolve_config(
            AIUseCase.SUGGESTIONS, user_api_key="user-key-secret", user_model=retired,
        )
        assert config.model == replacement
        assert config.api_key == "user-key-secret"
        assert config.key_source == KeySource.USER
        messages = [r.getMessage() for r in caplog.records if r.name == "services.llm_service"]
        # The IDs are in the message itself: the API's log format prints only the message.
        assert f"byok_model_remapped from={retired} to={replacement} use_case=suggestions" in messages
        assert not any("user-key-secret" in m for m in messages)

    def test_replacement_still_passes_the_allowlist_check(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """
        The allowlist's protection comes from checking after swapping: a
        replacement goes through the same check as any other ID, so even a map
        entry pointing off the allowlist cannot route a request there.
        """
        monkeypatch.setitem(_RETIRED_MODEL_REPLACEMENTS, "openai/gpt-5.4-nano", "openai/evil-model")
        service = LLMService(_make_settings())
        with pytest.raises(UnsupportedModelError, match="Unsupported model: openai/evil-model"):
            service.resolve_config(
                AIUseCase.SUGGESTIONS, user_api_key="user-key-123", user_model="openai/gpt-5.4-nano",
            )

    def test_never_offered_model_still_rejected(self) -> None:
        """An ID that was never on the allowlist and is not in the map is rejected."""
        service = LLMService(_make_settings())
        with pytest.raises(UnsupportedModelError, match="Unsupported model"):
            service.resolve_config(
                AIUseCase.SUGGESTIONS, user_api_key="user-key-123", user_model="evil/attacker-model",
            )


class TestRetiredModelReplacements:
    """Drift rules for _RETIRED_MODEL_REPLACEMENTS."""

    def test_no_retired_id_is_still_allowlisted(self) -> None:
        allowlist = {d["id"] for d in _SUPPORTED_MODEL_DEFS}
        still_offered = sorted(_RETIRED_MODEL_REPLACEMENTS.keys() & allowlist)
        assert not still_offered, f"Retired IDs still on the allowlist: {still_offered}"

    def test_every_replacement_is_allowlisted(self) -> None:
        """
        Every replacement is on the allowlist, so a remapped user is not refused.

        Without this, a remapped request would be rejected with 400. The
        allowlist's protection itself comes from checking after the swap (see
        `test_replacement_still_passes_the_allowlist_check`).
        """
        allowlist = {d["id"] for d in _SUPPORTED_MODEL_DEFS}
        unknown = sorted(set(_RETIRED_MODEL_REPLACEMENTS.values()) - allowlist)
        assert not unknown, f"Replacements not on the allowlist: {unknown}"

    def test_replacement_keeps_the_provider(self) -> None:
        """
        The model's prefix is the only record of which provider issued the
        user's key, so a cross-provider replacement would send the key to the
        wrong provider.
        """
        prefixes = [prefix for prefix, _ in _PROVIDER_KEY_MAP]

        def provider(model: str) -> str | None:
            return next((p for p in prefixes if model.startswith(p)), None)

        crossed = {
            retired: replacement
            for retired, replacement in _RETIRED_MODEL_REPLACEMENTS.items()
            if provider(retired) is None or provider(retired) != provider(replacement)
        }
        assert not crossed, f"Replacements that change or lack a provider prefix: {crossed}"


# ---------------------------------------------------------------------------
# LLMService.get_model_for_use_case
# ---------------------------------------------------------------------------


class TestGetModelForUseCase:
    """Tests for LLMService.get_model_for_use_case."""

    def test_returns_platform_model(self) -> None:
        service = LLMService(_make_settings())
        assert service.get_model_for_use_case(AIUseCase.SUGGESTIONS) == "openai/gpt-6-luna"
        assert service.get_model_for_use_case(AIUseCase.CHAT) == "openai/gpt-6.1-sol"


# ---------------------------------------------------------------------------
# LLMService.complete
# ---------------------------------------------------------------------------


class TestComplete:
    """Tests for LLMService.complete."""

    async def test_calls_acompletion_with_correct_args(self) -> None:
        """A model with no settings-table entry gets the caller's temperature and nothing else."""
        service = LLMService(_make_settings())
        config = LLMConfig(model="openai/gpt-4o", api_key="key", key_source=KeySource.PLATFORM)

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
            assert call_kwargs["model"] == "openai/gpt-4o"
            assert call_kwargs["api_key"] == "key"
            assert call_kwargs["timeout"] == 30
            assert call_kwargs["num_retries"] == 1
            assert call_kwargs["temperature"] == 0.7
            assert "reasoning_effort" not in call_kwargs
            assert "thinking" not in call_kwargs
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

    @pytest.mark.parametrize(("model", "expected"), _COMPLETE_AND_STREAM_CASES)
    async def test_applies_model_request_settings(self, model: str, expected: dict) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model=model, api_key="key", key_source=KeySource.USER)

        with (
            patch("services.llm_service.acompletion", new_callable=AsyncMock) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.0),
        ):
            await service.complete(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
                temperature=0.5,
            )
            assert _per_model_kwargs(mock_acomp.call_args.kwargs) == expected

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

    @pytest.mark.parametrize(("model", "expected"), _COMPLETE_AND_STREAM_CASES)
    async def test_applies_model_request_settings(self, model: str, expected: dict) -> None:
        service = LLMService(_make_settings())
        config = LLMConfig(model=model, api_key="key", key_source=KeySource.USER)

        with patch("services.llm_service.acompletion", new_callable=AsyncMock) as mock_acomp:
            await service.stream(
                messages=[{"role": "user", "content": "Hi"}],
                config=config,
                temperature=0.5,
            )
            assert _per_model_kwargs(mock_acomp.call_args.kwargs) == expected


# ---------------------------------------------------------------------------
# model_request_settings and the settings table
# ---------------------------------------------------------------------------


class TestModelRequestSettings:
    """Tests for model_request_settings and _MODEL_REQUEST_SETTINGS."""

    @pytest.mark.parametrize(
        ("model", "expected"),
        [
            # Expected values come from the plan's table, not from the code.
            ("openai/gpt-6-luna", {"reasoning_effort": "none", "temperature": 0.7}),
            ("openai/gpt-6.1-sol", {"reasoning_effort": "low"}),
            ("openai/gpt-6-astra", {"reasoning_effort": "low"}),
            ("anthropic/claude-haiku-5-5", {"thinking": {"type": "disabled"}}),
            ("anthropic/claude-sonnet-5-5", {}),
            ("anthropic/claude-opus-5-5", {}),
            ("gemini/gemini-3.5-flash-lite", {}),
        ],
    )
    def test_table_entries(self, model: str, expected: dict) -> None:
        assert model_request_settings(model, 0.7) == expected

    def test_unlisted_model_gets_only_the_callers_temperature(self) -> None:
        assert model_request_settings("openai/gpt-4o", 0.3) == {"temperature": 0.3}
        assert model_request_settings("gemini/gemini-flash-latest", 0.0) == {"temperature": 0.0}

    def test_returned_kwargs_never_alias_the_table(self) -> None:
        """LiteLLM or a caller mutating what it was sent must not change the table."""
        sent = model_request_settings("anthropic/claude-haiku-5-5", 0.7)
        sent["thinking"]["type"] = "enabled"
        sent["temperature"] = 1.0
        assert model_request_settings("anthropic/claude-haiku-5-5", 0.7) == {"thinking": {"type": "disabled"}}

    def test_no_entry_uses_a_key_complete_or_stream_set_themselves(self) -> None:
        """
        `complete()` and `stream()` set these keys themselves and disagree on
        which value wins (`stream()` even crashes on a repeated keyword), so an
        entry must never contain one. In particular, a `temperature` key is
        silently replaced by the caller's temperature.
        """
        reserved = {
            "temperature", "model", "messages", "api_key", "stream",
            "timeout", "num_retries", "max_tokens", "response_format",
        }
        clashes = {
            model: sorted(entry.keys() & reserved)
            for model, entry in _MODEL_REQUEST_SETTINGS.items()
            if entry.keys() & reserved
        }
        assert not clashes, (
            f"_MODEL_REQUEST_SETTINGS entries use keys complete()/stream() set themselves: "
            f"{clashes}. To stop the caller's temperature being sent, use "
            "`omit_temperature: True`."
        )

    def test_every_key_has_a_known_provider_prefix(self) -> None:
        prefixes = tuple(prefix for prefix, _ in _PROVIDER_KEY_MAP)
        unknown = sorted(m for m in _MODEL_REQUEST_SETTINGS if not m.startswith(prefixes))
        assert not unknown, f"Settings-table keys without a known provider prefix: {unknown}"

    def test_every_allowlisted_model_and_default_has_an_entry(self) -> None:
        """
        CI has no provider keys and skips the live smoke test, so this is what
        stops a model being added without deciding its request settings.
        Defaults are read from the field definitions, not a `Settings()`
        instance, so a developer's `.env` override cannot change the result.
        """
        defaults = {
            name: field.default
            for name, field in Settings.model_fields.items()
            if name.startswith("llm_model_")
        }
        assert defaults.keys() == {f"llm_model_{use_case.value}" for use_case in AIUseCase}
        allowlist = {d["id"] for d in _SUPPORTED_MODEL_DEFS}

        missing = sorted((allowlist | set(defaults.values())) - _MODEL_REQUEST_SETTINGS.keys())
        assert not missing, (
            f"No _MODEL_REQUEST_SETTINGS entry for {missing}. Add one ({{}} if the model "
            "accepts the caller's temperature) and run the LLM smoke test. For a model that "
            "thinks by default, also check its reasoning tokens once on a real suggestion "
            "prompt (see the comment on _MODEL_REQUEST_SETTINGS)."
        )
        off_allowlist = {name: model for name, model in defaults.items() if model not in allowlist}
        assert not off_allowlist, f"llm_model_* defaults not on the allowlist: {off_allowlist}"


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
