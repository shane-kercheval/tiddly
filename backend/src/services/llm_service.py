"""LLM service wrapping LiteLLM for AI features."""
import copy
import json
import logging
import re
from collections.abc import AsyncIterator
from enum import StrEnum

import litellm
from litellm import ModelResponse, acompletion, completion_cost
from pydantic import BaseModel

from core.config import Settings
from schemas.ai import AIModelEntry

# Suppress LiteLLM's "Provider List: ..." stderr output on unrecognized model prefixes
litellm.suppress_debug_info = True

logger = logging.getLogger(__name__)


class UnsupportedModelError(ValueError):
    """
    Raised when a BYOK caller passes a `model` ID not in the supported allowlist.

    Subclasses `ValueError` for backward compatibility with any code that
    catches `ValueError` around `LLMService.resolve_config`. Routers should
    catch this specifically (and map to HTTP 400) rather than catching bare
    `ValueError`, so that unrelated `ValueError`s from `resolve_config`
    surface as 500 with a generic message rather than leaking internal
    details to clients.
    """


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


# Provider HTTP statuses that mean the provider refused the API key. The API's
# error mapping (api/main.py) and POST /ai/validate-key both read this, so they
# agree on what a rejected key is. It is a status, not an exception class:
# LiteLLM picks the class from the provider's error body as well as its status
# (an OpenAI 403 becomes `APIError`, `BadRequestError` or `NotFoundError`
# depending on the body).
LLM_KEY_REJECTED_STATUSES: frozenset[int] = frozenset({401, 403})


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


def build_supported_models() -> list[AIModelEntry]:
    """
    Build the supported models list with pricing from LiteLLM's SDK.

    Called at startup. Pricing auto-updates with LiteLLM version bumps.
    Returns typed `AIModelEntry` instances rather than raw dicts — so a typo
    or drift in `_SUPPORTED_MODEL_DEFS` (e.g., an unsupported `provider`
    value) surfaces as a `ValidationError` at import/startup, not at
    `/ai/models` response time in production.
    """
    models: list[AIModelEntry] = []
    for defn in _SUPPORTED_MODEL_DEFS:
        model_id = defn["id"]
        cost_info = _get_model_cost(model_id)
        if cost_info:
            input_cost = cost_info["input_cost_per_token"] * 1_000_000
            output_cost = cost_info["output_cost_per_token"] * 1_000_000
        else:
            logger.warning("model_cost_not_found", extra={"model_id": model_id})
            input_cost = None
            output_cost = None
        models.append(AIModelEntry(
            id=model_id,
            provider=defn["provider"],
            tier=defn["tier"],
            input_cost_per_million=input_cost,
            output_cost_per_million=output_cost,
        ))
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
# Per-model request settings
# ---------------------------------------------------------------------------
# What each model must be sent besides the prompt, keyed by provider-prefixed
# model ID. `omit_temperature: True` means the caller's temperature is not sent;
# every other key is passed to `acompletion` unchanged. A model with no entry
# gets the caller's temperature and nothing else.
#
# Every allowlisted model and every `llm_model_*` default needs an entry, and
# test_llm_service.py enforces that offline (CI has no provider keys, so it skips
# the live smoke test). An empty entry `{}` means "verified to accept the
# caller's temperature".
#
# The smoke test (test_llm_smoke.py) calls each allowlisted model at
# temperature 0. It proves the provider accepts the entry, and that the model
# does not reason on its one-word prompt unless the entry sets a reasoning
# effort above "none". It cannot prove an entry turns off thinking that a model
# does only on real prompts: Claude Haiku 5.5 with thinking left on does not
# think on the smoke prompt but does on a tag suggestion. So check a model that
# thinks by default once with a real suggestion prompt, reading the reasoning
# tokens in the response's usage, before adding its entry.
#
# Why a table and not LiteLLM's `drop_params`: `drop_params` can only remove
# parameters, and it decides from flags in LiteLLM's downloaded price list
# rather than from reviewed code. On LiteLLM 1.106.0 it silently turned
# reasoning on for gpt-6-luna and claude-haiku-5-5 (slower, more tokens),
# because removing their temperature without setting an effort leaves the
# model's default reasoning on.
_MODEL_REQUEST_SETTINGS: dict[str, dict] = {
    # Today's allowlist and defaults: verified to accept the caller's temperature.
    "gemini/gemini-flash-lite-latest": {},
    "openai/gpt-5.4-nano": {},
    "openai/gpt-5.4-mini": {},
    "openai/gpt-5.4": {},
    "anthropic/claude-haiku-4-5": {},
    "anthropic/claude-sonnet-4-6": {},
    "anthropic/claude-opus-4-6": {},
    # Temperature is accepted only when reasoning effort is "none".
    "openai/gpt-6-luna": {"reasoning_effort": "none"},
    # No "none" effort level exists, so temperature must be omitted.
    "openai/gpt-6.1-sol": {"omit_temperature": True, "reasoning_effort": "low"},
    "openai/gpt-6-astra": {"omit_temperature": True, "reasoning_effort": "low"},
    # Claude 5.5 rejects any temperature other than 1. Haiku thinks by default.
    "anthropic/claude-haiku-5-5": {"omit_temperature": True, "thinking": {"type": "disabled"}},
    "anthropic/claude-sonnet-5-5": {"omit_temperature": True},
    "anthropic/claude-opus-5-5": {"omit_temperature": True},
    # Google ignores temperature on 3.5 and LiteLLM warns on every call that sends one.
    "gemini/gemini-3.5-flash-lite": {"omit_temperature": True},
}


def model_request_settings(model: str, temperature: float) -> dict:
    """
    Return the per-model kwargs to send `acompletion` for `model` at `temperature`.

    Applies `_MODEL_REQUEST_SETTINGS`: the temperature is left out when the
    entry says `omit_temperature`, and every other key in the entry is added.
    `LLMService.complete()` and `stream()` both call this, and nothing else
    decides per-model parameters. Code that calls `acompletion` directly must
    call it too (the eval judge in `evals/ai_suggestions/helpers.py` does).
    """
    # Deep copy: callers and LiteLLM get their own nested dicts, never the table's.
    kwargs = copy.deepcopy(_MODEL_REQUEST_SETTINGS.get(model, {}))
    if not kwargs.pop("omit_temperature", False):
        kwargs["temperature"] = temperature
    return kwargs


# ---------------------------------------------------------------------------
# Response normalization
# ---------------------------------------------------------------------------


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
        self.supported_models: list[AIModelEntry] = build_supported_models()
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

        Raises UnsupportedModelError (subclass of ValueError) if user_model is
        not in the supported models allowlist.
        """
        if user_api_key:
            if user_model and user_model not in _SUPPORTED_MODEL_IDS:
                raise UnsupportedModelError(f"Unsupported model: {user_model}")
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
        timeout: int | None = None,
        num_retries: int | None = None,
    ) -> tuple[ModelResponse, float | None]:
        """
        Non-streaming completion. Returns (response, cost).

        `timeout` and `num_retries` override the service-wide defaults for this
        call. Callers use this to tune latency vs resilience: UI paths default
        to a short timeout with no retries (fail fast so the user isn't waiting
        on a flaky provider), eval paths use longer timeouts and more retries
        (tolerant of transient upstream slowness). Defaults preserve the
        prior behavior (timeout=LLM_TIMEOUT_DEFAULT, num_retries=1) when
        neither is supplied.

        Cost is None if cost calculation fails (e.g. model not in LiteLLM's
        pricing database). A successful LLM call never fails due to cost tracking.
        """
        kwargs: dict = {
            "model": config.model,
            "messages": messages,
            "api_key": config.api_key,
            **model_request_settings(config.model, temperature),
            "timeout": timeout if timeout is not None else self._settings.llm_timeout_default,
            "num_retries": num_retries if num_retries is not None else 1,
        }
        if response_format is not None:
            kwargs["response_format"] = response_format
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        response = await acompletion(**kwargs)

        if response_format is not None:
            _sanitize_structured_content(response)

        try:
            # Strip provider prefix (e.g. "openai/gpt-5.4-nano" → "gpt-5.4-nano")
            # because completion_cost() doesn't recognize prefixed OpenAI/Anthropic
            # model names. Bare names work for all providers including Gemini.
            cost_model = config.model.split("/")[-1] if "/" in config.model else config.model
            cost: float | None = completion_cost(
                completion_response=response,
                model=cost_model,
            )
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
            stream=True,
            timeout=self._settings.llm_timeout_streaming,
            **model_request_settings(config.model, temperature),
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
