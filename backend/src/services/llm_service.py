"""LLM service wrapping LiteLLM for AI features."""
import json
import logging
import re
from collections.abc import AsyncIterator
from enum import StrEnum

import litellm
from litellm import ModelResponse, acompletion, completion_cost
from pydantic import BaseModel

from core.config import Settings

logger = logging.getLogger(__name__)


class KeySource(StrEnum):
    """Source of the API key used for an LLM call."""

    PLATFORM = "platform"
    USER = "user"


class AIUseCase(StrEnum):
    """AI feature use cases, each mapping to a default model."""

    SUGGESTIONS = "suggestions"
    TRANSFORM = "transform"
    AUTO_COMPLETE = "auto_complete"
    CHAT = "chat"


class LLMConfig(BaseModel):
    """Resolved config for a single LLM call."""

    model: str
    api_key: str
    key_source: KeySource


# ---------------------------------------------------------------------------
# Supported models — curated GA models only (no preview/experimental)
# ---------------------------------------------------------------------------
# 3 providers x 3 tiers. Preview models are added when they go GA.
# Model IDs must match what LiteLLM expects for acompletion() calls.
# Cost lookup keys may differ (e.g. OpenAI models have no prefix in cost map).

_SUPPORTED_MODEL_DEFS: list[dict] = [
    # Google Gemini
    {"id": "gemini/gemini-flash-lite-latest", "provider": "google", "tier": "budget"},
    # Gemini flash/pro disabled — chronic 503 "high demand" errors from Google's API
    # make these unreliable for production use. See evals/LEARNINGS.md.
    # {"id": "gemini/gemini-flash-latest", "provider": "google", "tier": "balanced"},
    # {"id": "gemini/gemini-pro-latest", "provider": "google", "tier": "flagship"},
    # OpenAI
    {"id": "openai/gpt-5.4-nano", "provider": "openai", "tier": "budget"},
    {"id": "openai/gpt-5.4-mini", "provider": "openai", "tier": "balanced"},
    {"id": "openai/gpt-5.4", "provider": "openai", "tier": "flagship"},
    # Anthropic
    {"id": "anthropic/claude-haiku-4-5", "provider": "anthropic", "tier": "budget"},
    {"id": "anthropic/claude-sonnet-4-6", "provider": "anthropic", "tier": "balanced"},
    {"id": "anthropic/claude-opus-4-6", "provider": "anthropic", "tier": "flagship"},
]


def _get_model_cost(model_id: str) -> dict | None:
    """
    Look up cost info in litellm.model_cost.

    LiteLLM's cost map uses prefixed keys for some providers (gemini/) but
    unprefixed keys for others (OpenAI, Anthropic). Try the full ID first,
    then fall back to stripping the provider prefix.
    """
    cost_info = litellm.model_cost.get(model_id)
    if cost_info:
        return cost_info
    if "/" in model_id:
        stripped = model_id.split("/", 1)[1]
        return litellm.model_cost.get(stripped)
    return None


def build_supported_models() -> list[dict]:
    """
    Build the supported models list with pricing from LiteLLM's SDK.

    Called at startup. Pricing auto-updates with LiteLLM version bumps.
    """
    models: list[dict] = []
    for defn in _SUPPORTED_MODEL_DEFS:
        model_id = defn["id"]
        entry = {**defn}
        cost_info = _get_model_cost(model_id)
        if cost_info:
            entry["input_cost_per_million"] = cost_info["input_cost_per_token"] * 1_000_000
            entry["output_cost_per_million"] = cost_info["output_cost_per_token"] * 1_000_000
        else:
            logger.warning("model_cost_not_found", extra={"model_id": model_id})
        models.append(entry)
    return models


# ---------------------------------------------------------------------------
# Provider key mapping
# ---------------------------------------------------------------------------
# Maps model ID prefixes/patterns to Settings attribute names for API keys.
# First match wins. Order matters: more specific prefixes before generic ones.

_PROVIDER_KEY_MAP: list[tuple[str, str]] = [
    ("gemini/", "gemini_api_key"),
    ("openai/", "openai_api_key"),
    ("anthropic/", "anthropic_api_key"),
]

# Allowlist of supported model IDs for BYOK model selection.
# Prevents SSRF: LiteLLM interprets model strings as provider routing directives,
# so arbitrary strings could route server requests to attacker-controlled endpoints.
_SUPPORTED_MODEL_IDS: set[str] = {d["id"] for d in _SUPPORTED_MODEL_DEFS}


def _resolve_platform_key(model: str, settings: Settings) -> str:
    """
    Determine which provider API key to use based on model prefix.

    Prefix-matched in order, first match wins. Raises ValueError for unknown prefix.
    """
    for prefix, key_attr in _PROVIDER_KEY_MAP:
        if model.startswith(prefix):
            return getattr(settings, key_attr)
    raise ValueError(f"Unknown model prefix: {model}. Add mapping to _PROVIDER_KEY_MAP.")


# ---------------------------------------------------------------------------
# Response normalization
# ---------------------------------------------------------------------------

# Models that only support temperature=1. Hardcoded — no pattern matching.
# The smoke test (test_llm_smoke.py) uses temperature=0 for all models,
# so adding a new model that requires temperature=1 will be caught immediately.
_TEMPERATURE_1_ONLY_MODELS: set[str] = {
    "openai/o4-mini",
}


def _normalize_temperature(model: str, temperature: float) -> float:
    """Clamp temperature to model-supported values."""
    if model in _TEMPERATURE_1_ONLY_MODELS:
        return 1.0
    return temperature


def _sanitize_structured_content(response: object) -> None:
    """
    Extract clean JSON from structured output responses.

    Some providers (notably Gemini 2.5) sometimes return preamble text or
    markdown fences around JSON even when response_format is set. This is a
    known provider bug (googleapis/python-genai#637). We extract the JSON
    object/array to prevent downstream parse failures.

    Mutates response.choices[*].message.content in place.
    """
    for choice in response.choices:
        content = choice.message.content
        if not content:
            continue

        stripped = content.strip()

        # Already clean JSON
        if stripped.startswith(("{", "[")):
            continue

        # Strip markdown fences: ```json ... ``` or ``` ... ```
        fenced = re.match(r"^```(?:json)?\s*\n?(.*?)\n?\s*```$", stripped, re.DOTALL)
        if fenced:
            choice.message.content = fenced.group(1).strip()
            continue

        # Extract first JSON object or array from preamble text
        match = re.search(r"[{\[]", stripped)
        if match:
            candidate = stripped[match.start():]
            try:
                json.loads(candidate)
                choice.message.content = candidate
                continue
            except json.JSONDecodeError:
                pass

        logger.warning(
            "structured_output_extraction_failed",
            extra={"content_preview": stripped[:200]},
        )


class LLMService:
    """Thin wrapper around LiteLLM with use-case model resolution and BYOK support."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.supported_models: list[dict] = build_supported_models()
        self._platform_configs: dict[AIUseCase, LLMConfig] = {
            AIUseCase.SUGGESTIONS: LLMConfig(
                model=settings.llm_model_suggestions,
                api_key=_resolve_platform_key(settings.llm_model_suggestions, settings),
                key_source=KeySource.PLATFORM,
            ),
            AIUseCase.TRANSFORM: LLMConfig(
                model=settings.llm_model_transform,
                api_key=_resolve_platform_key(settings.llm_model_transform, settings),
                key_source=KeySource.PLATFORM,
            ),
            AIUseCase.AUTO_COMPLETE: LLMConfig(
                model=settings.llm_model_auto_complete,
                api_key=_resolve_platform_key(settings.llm_model_auto_complete, settings),
                key_source=KeySource.PLATFORM,
            ),
            AIUseCase.CHAT: LLMConfig(
                model=settings.llm_model_chat,
                api_key=_resolve_platform_key(settings.llm_model_chat, settings),
                key_source=KeySource.PLATFORM,
            ),
        }

    def get_model_for_use_case(self, use_case: AIUseCase) -> str:
        """Return the platform model ID for a use case."""
        return self._platform_configs[use_case].model

    def resolve_config(
        self,
        use_case: AIUseCase,
        user_api_key: str | None = None,
        user_model: str | None = None,
    ) -> LLMConfig:
        """
        Determine which key and model to use.

        - If user provides a key: use their key + their model (or use-case default model)
        - Otherwise: use platform key + use-case model (ignore user model choice)

        Raises ValueError if user_model is not in the supported models allowlist.
        """
        if user_api_key:
            if user_model and user_model not in _SUPPORTED_MODEL_IDS:
                raise ValueError(f"Unsupported model: {user_model}")
            return LLMConfig(
                model=user_model or self._platform_configs[use_case].model,
                api_key=user_api_key,
                key_source=KeySource.USER,
            )
        return self._platform_configs[use_case]

    async def complete(
        self,
        messages: list[dict],
        config: LLMConfig,
        response_format: type[BaseModel] | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> tuple[ModelResponse, float | None]:
        """
        Non-streaming completion. Returns (response, cost).

        Cost is None if cost calculation fails (e.g. model not in LiteLLM's
        pricing database). A successful LLM call never fails due to cost tracking.
        """
        kwargs: dict = {
            "model": config.model,
            "messages": messages,
            "api_key": config.api_key,
            "temperature": _normalize_temperature(config.model, temperature),
            "timeout": self._settings.llm_timeout_default,
            "num_retries": 1,
        }
        if response_format is not None:
            kwargs["response_format"] = response_format
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        response = await acompletion(**kwargs)

        if response_format is not None:
            _sanitize_structured_content(response)

        try:
            cost: float | None = completion_cost(completion_response=response)
        except Exception:
            logger.warning("completion_cost_failed", extra={"model": config.model})
            cost = None
        return response, cost

    async def stream(
        self,
        messages: list[dict],
        config: LLMConfig,
        temperature: float = 0.7,
    ) -> AsyncIterator:
        """Streaming completion. Returns an async iterator of chunks."""
        return await acompletion(
            model=config.model,
            messages=messages,
            api_key=config.api_key,
            temperature=temperature,
            stream=True,
            timeout=self._settings.llm_timeout_streaming,
        )


# ---------------------------------------------------------------------------
# Global state (set during lifespan)
# ---------------------------------------------------------------------------
_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    """Get the global LLMService instance. Raises if not initialized."""
    if _llm_service is None:
        raise RuntimeError("LLMService not initialized. Check app lifespan.")
    return _llm_service


def set_llm_service(service: LLMService | None) -> None:
    """Set the global LLMService instance."""
    global _llm_service  # noqa: PLW0603
    _llm_service = service
