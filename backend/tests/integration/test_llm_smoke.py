"""Smoke tests for supported LLM models.

These tests make real API calls to verify model IDs, structured output,
and cost tracking work end-to-end. Skipped if the provider API key is not set.

Run manually before deploys or on a schedule to catch provider/model changes early.
"""
import os

import pytest
from pydantic import BaseModel

from services.llm_service import (
    KeySource,
    LLMConfig,
    LLMService,
    _SUPPORTED_MODEL_DEFS,
    build_supported_models,
)

_SMOKE_MODELS = build_supported_models()


class SimpleResponse(BaseModel):
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
    from unittest.mock import MagicMock

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
    ids=[m["id"] for m in _SMOKE_MODELS],
)
async def test_smoke_structured_output(model_def: dict) -> None:
    """Verify each supported model works with structured output and cost tracking."""
    model_id = model_def["id"]
    api_key = _get_api_key_for_model(model_id)

    if not api_key:
        pytest.skip(f"No API key for {model_id}")

    settings = _make_smoke_settings(model_id, api_key)
    service = LLMService(settings)
    config = LLMConfig(model=model_id, api_key=api_key, key_source=KeySource.PLATFORM)

    # temperature=0 is passed intentionally — the service normalizes it
    # for O-series models automatically.
    # max_tokens=1000 because O-series models use internal reasoning tokens
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
