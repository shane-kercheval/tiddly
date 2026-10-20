"""
Smoke tests for supported LLM models.

These tests make real API calls to verify model IDs, structured output,
and cost tracking work end-to-end. Skipped if the provider API key is not set.

Run manually before deploys or on a schedule to catch provider/model changes early.
"""
import os
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from schemas.ai import AIModelEntry
from services.llm_service import (
    _MODEL_REQUEST_SETTINGS,
    KeySource,
    LLMConfig,
    LLMService,
    build_supported_models,
)

_SMOKE_MODELS = build_supported_models()


class SimpleResponse(BaseModel):
    """Simple structured output schema for smoke tests."""

    greeting: str


def _get_api_key_for_model(model_id: str) -> str | None:
    """Get the API key env var for a model, or None if not set."""
    provider_env_map = {
        "gemini/": "GEMINI_API_KEY",
        "openai/": "OPENAI_API_KEY",
        "anthropic/": "ANTHROPIC_API_KEY",
    }
    for prefix, env_var in provider_env_map.items():
        if model_id.startswith(prefix):
            return os.environ.get(env_var)
    return None


def _make_smoke_settings(model_id: str, api_key: str) -> object:
    """Create a minimal settings-like object for smoke tests."""
    settings = MagicMock()
    settings.llm_model_suggestions = model_id
    settings.llm_model_transform = model_id
    settings.llm_model_auto_complete = model_id
    settings.llm_model_chat = model_id
    settings.gemini_api_key = api_key if model_id.startswith("gemini/") else ""
    settings.openai_api_key = api_key if model_id.startswith("openai/") else ""
    settings.anthropic_api_key = api_key if model_id.startswith("anthropic/") else ""
    settings.llm_timeout_default = 30
    settings.llm_timeout_streaming = 60
    return settings


@pytest.mark.parametrize(
    "model_def",
    _SMOKE_MODELS,
    ids=[m.id for m in _SMOKE_MODELS],
)
async def test_smoke_structured_output(model_def: AIModelEntry) -> None:
    """Verify each supported model works with structured output and cost tracking."""
    model_id = model_def.id
    api_key = _get_api_key_for_model(model_id)

    if not api_key:
        pytest.skip(f"No API key for {model_id}")

    settings = _make_smoke_settings(model_id, api_key)
    service = LLMService(settings)
    config = LLMConfig(model=model_id, api_key=api_key, key_source=KeySource.PLATFORM)

    # temperature=0 is intentional — DO NOT change to a higher value.
    # This proves the provider accepts each model's entry in
    # _MODEL_REQUEST_SETTINGS (llm_service.py): models that reject a
    # temperature other than 1 (GPT-6 at a reasoning effort other than "none",
    # Claude 5.5) fail here unless their entry omits it. A model with no entry
    # fails the offline coverage test in test_llm_service.py instead. Whether
    # the entry turns reasoning off is only partly checked (see below).
    # max_tokens=1000 because reasoning models use internal reasoning tokens
    # that count against the limit — 50 is not enough for them.
    response, cost = await service.complete(
        messages=[{"role": "user", "content": "Say hello in one word."}],
        config=config,
        response_format=SimpleResponse,
        max_tokens=1000,
        temperature=0,
    )

    # Verify response is valid — service sanitizes preamble/fences automatically
    content = response.choices[0].message.content
    assert content is not None

    # Verify structured output parses cleanly after sanitization
    parsed = SimpleResponse.model_validate_json(content)
    assert parsed.greeting  # non-empty

    # Verify cost tracking works — real API calls with tokens should have non-zero cost
    assert cost is not None
    assert cost > 0

    # The model must not reason unless its entry asks it to with a reasoning
    # effort above "none": reasoning left on adds cost and latency to every
    # suggestion. This catches an entry that leaves the effort unset (GPT-6
    # Luna with no effort reasons even on this one-word prompt). It cannot
    # catch thinking a model does only on real prompts: Claude Haiku 5.5 with
    # thinking left on does not think here. See the _MODEL_REQUEST_SETTINGS
    # comment for the one-time check such a model needs.
    if _MODEL_REQUEST_SETTINGS.get(model_id, {}).get("reasoning_effort", "none") == "none":
        details = getattr(response.usage, "completion_tokens_details", None)
        reasoning_tokens = getattr(details, "reasoning_tokens", None) or 0
        assert reasoning_tokens == 0, (
            f"{model_id} used {reasoning_tokens} reasoning tokens; its "
            "_MODEL_REQUEST_SETTINGS entry should turn reasoning off"
        )


@pytest.mark.parametrize(
    "model_def",
    _SMOKE_MODELS,
    ids=[m.id for m in _SMOKE_MODELS],
)
async def test_smoke_key_check_call(model_def: AIModelEntry) -> None:
    """
    Make exactly the call `POST /ai/validate-key` makes for each supported model.

    The Settings page's "Test connection" sends `max_tokens=5`, temperature 0,
    and no response format, so a model whose settings-table entry breaks that
    call would report every user's key as unusable. Only an exception fails
    this: the endpoint treats any reply as a valid key, and a 5-token cap can
    leave the reply empty when the model reasons first (recorded below, not
    asserted). Pytest hides a passing test's output, so run with `-rP` to see
    each model's recorded reply and reasoning tokens.
    """
    model_id = model_def.id
    api_key = _get_api_key_for_model(model_id)

    if not api_key:
        pytest.skip(f"No API key for {model_id}")

    service = LLMService(_make_smoke_settings(model_id, api_key))
    config = LLMConfig(model=model_id, api_key=api_key, key_source=KeySource.PLATFORM)
    response, _ = await service.complete(
        messages=[{"role": "user", "content": "This is a test. Respond with 'ok'."}],
        config=config,
        max_tokens=5,
        temperature=0,
    )
    details = getattr(response.usage, "completion_tokens_details", None)
    print(
        f"{model_id}: content={response.choices[0].message.content!r} "
        f"reasoning_tokens={getattr(details, 'reasoning_tokens', None)}",
    )
