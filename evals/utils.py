"""Shared utilities for MCP server evaluations."""

import asyncio
import json
import time
import warnings
from pathlib import Path
from typing import Any

import httpx
import openai
import yaml
from flex_evals import Check, TestCase
from litellm import ModelResponse, Usage, acompletion, cost_per_token
from sik_llms import Tool
from sik_llms.anthropic import _tool_to_anthropic_schema
from sik_llms.mcp_manager import MCPClientManager
from sik_llms.openai import _tool_to_openai_schema

from services.llm_service import model_request_settings

# Default configuration
PAT_TOKEN = "bm_devtoken"
API_BASE_URL = "http://localhost:8000"
CONTENT_MCP_URL = "http://localhost:8001/mcp"
PROMPT_MCP_URL = "http://localhost:8002/mcp"


def get_content_mcp_config() -> dict[str, Any]:
    """Get MCP configuration for the Content MCP server."""
    return {
        "mcpServers": {
            "content": {
                "command": "npx",
                "args": [
                    "mcp-remote",
                    CONTENT_MCP_URL,
                    "--header",
                    f"Authorization: Bearer {PAT_TOKEN}",
                ],
            },
        },
    }


def get_prompt_mcp_config() -> dict[str, Any]:
    """Get MCP configuration for the Prompt MCP server."""
    return {
        "mcpServers": {
            "prompt": {
                "command": "npx",
                "args": [
                    "mcp-remote",
                    PROMPT_MCP_URL,
                    "--header",
                    f"Authorization: Bearer {PAT_TOKEN}",
                ],
            },
        },
    }


def load_yaml_config(config_path: Path) -> dict[str, Any]:
    """Load YAML configuration file."""
    with open(config_path) as f:
        return yaml.safe_load(f)


def create_checks_from_config(check_specs: list[dict[str, Any]]) -> list[Check]:
    """
    Convert YAML check specifications to Check objects.

    Returns Check dataclass objects (not BaseCheck instances) to preserve metadata.
    The flex_evals engine handles conversion internally.

    Example YAML format:
        checks:
          - type: "contains"
            arguments:
              text: "$.output.value.final_content"
              phrases: "$.test_case.expected.must_contain"
            metadata:
              name: "Content contains fix"
              description: "Verify the fix was applied"
    """
    checks = []
    for spec in check_specs:
        checks.append(Check(
            type=spec["type"],
            arguments=spec["arguments"],
            metadata=spec.get("metadata"),
        ))
    return checks


def create_test_cases_from_config(
    test_case_specs: list[dict[str, Any]],
) -> list[TestCase]:
    """
    Convert YAML test case specifications to TestCase objects.

    Example YAML format:
        test_cases:
          - id: "fix-typo-prefix"
            input:
              content: |
                This docu needs to be updated.
              typo: "docu"
            expected:
              tool_name: "edit_content"
              must_contain: "document"
    """
    test_cases = []
    for spec in test_case_specs:
        checks = None
        if spec.get("checks"):
            checks = create_checks_from_config(spec["checks"])
        test_case = TestCase(
            id=spec.get("id"),
            input=spec["input"],
            expected=spec.get("expected"),
            metadata=spec.get("metadata"),
            checks=checks,
        )
        test_cases.append(test_case)
    return test_cases


async def call_tool_with_retry(
    mcp_manager: MCPClientManager,
    tool_name: str,
    args: dict[str, Any],
    max_retries: int = 3,
    retry_delay: float = 1.0,
) -> Any:
    """
    Call MCP tool with retry logic for transient failures.

    Args:
        mcp_manager: The MCP client manager instance.
        tool_name: Name of the tool to call.
        args: Arguments to pass to the tool.
        max_retries: Maximum number of retry attempts.
        retry_delay: Base delay between retries (multiplied by attempt number).

    Returns:
        The tool result (with content or structuredContent).

    Raises:
        ValueError: If the tool returns empty response after all retries.
        Exception: If the tool call fails after all retries.
    """
    last_error = None
    for attempt in range(max_retries):
        try:
            result = await mcp_manager.call_tool(tool_name, args)
            # Check for valid response (either content or structuredContent)
            has_content = result.content and len(result.content) > 0
            has_structured = result.structuredContent is not None
            if has_content or has_structured:
                return result
            # Empty response, retry
            last_error = ValueError(f"Empty response from {tool_name}")
        except Exception as e:
            last_error = e
        if attempt < max_retries - 1:
            await asyncio.sleep(retry_delay * (attempt + 1))
    raise last_error or ValueError(f"Failed to call {tool_name} after {max_retries} retries")


# Converts the MCP tools (as `sik_llms` `Tool` objects, from `MCPClientManager`)
# into each provider's tool format, keyed by the model ID's provider prefix.
# These are private `sik_llms` functions, used on purpose: they are the
# conversions the evals' earlier `sik_llms` tool clients applied, so the tool
# schemas the models see stay exactly as before and results stay comparable
# with earlier runs. LiteLLM sends OpenAI-format tools to OpenAI as given and
# passes Anthropic-format tools (those with an `input_schema`) through
# unchanged. `sik-llms` is pinned for this reason; a `sik_llms` upgrade can
# rename or change these functions, so compare the tool schemas sent before
# and after one.
_TOOL_SCHEMA_CONVERTERS = {
    "openai": _tool_to_openai_schema,
    "anthropic": _tool_to_anthropic_schema,
}

# Anthropic requires `max_tokens`. The earlier `sik_llms` client sent 8,000
# (its cap, below every Claude model's maximum); kept so the request is the same.
_ANTHROPIC_MAX_TOKENS = 8000

# Retries are this module's, not LiteLLM's. LiteLLM 1.106.0 retries OpenAI calls
# through the OpenAI SDK but never retries Anthropic calls, whatever
# `num_retries` is set to, while the earlier `sik_llms` clients retried both.
# So LiteLLM's retries are off (`num_retries=0`) and `_acompletion_with_retries`
# retries both providers alike. Requests counted against a fake provider
# (2026-10-20, LiteLLM's httpx transport):
# - LiteLLM alone, persistent 500: 1 request per provider at `num_retries=0`, so
#   the OpenAI SDK adds no retries of its own (at `num_retries=2`: OpenAI 3,
#   Anthropic 1).
# - Through this loop: a persistent 500, 429, or Anthropic 529 gets 3 requests
#   per provider, a 500 then success gets 2, a 400 gets 1, and a timeout gets 3
#   attempts. A refused connection gets 3 for OpenAI and 6 for Anthropic,
#   because LiteLLM's own HTTP client retries a failed connection once.
# Worst case per call: 3 attempts of 60 s plus 3 s of delays, 183 s. The MCP
# eval tests' 300 s pytest timeout, which bounds a model's whole suite, covers
# one such call.
_TOOL_CALL_TIMEOUT = 60
_TOOL_CALL_MAX_ATTEMPTS = 3
_TOOL_CALL_RETRY_DELAY = 1.0

# Models whose cost lookup failed in this process, so each is warned about once.
_UNPRICED_MODELS: set[str] = set()


def _is_transient(error: openai.APIError) -> bool:
    """True for rate limits, server errors (5xx), timeouts, and connection failures."""
    # LiteLLM's `Timeout` subclasses `openai.APIConnectionError`.
    if isinstance(error, openai.APIConnectionError):
        return True
    status = getattr(error, "status_code", None)
    return isinstance(status, int) and (status == 429 or status >= 500)


async def _acompletion_with_retries(kwargs: dict[str, Any]) -> ModelResponse:
    """Call `acompletion`, retrying transient errors, up to `_TOOL_CALL_MAX_ATTEMPTS` attempts."""
    attempt = 1
    while True:
        try:
            return await acompletion(**kwargs)
        except openai.APIError as error:
            if attempt >= _TOOL_CALL_MAX_ATTEMPTS or not _is_transient(error):
                raise
        await asyncio.sleep(_TOOL_CALL_RETRY_DELAY * attempt)
        attempt += 1


def _call_costs(
    model_name: str,
    bare_model: str,
    usage: Usage,
) -> tuple[float | None, float | None]:
    """
    Return LiteLLM's (input cost, output cost) for a call, or (None, None) if it can't price it.

    A model missing from LiteLLM's price list must not turn a paid, successful
    prediction into an eval error, so the prediction is kept and its costs are
    recorded as null, as `LLMService.complete()` does. The warning names the
    error type, so a bug in the lookup isn't mistaken for a missing price.
    """
    try:
        # Strip the provider prefix, as `LLMService.complete()` does for `completion_cost`.
        return cost_per_token(model=bare_model, usage_object=usage)
    except Exception as error:
        if model_name not in _UNPRICED_MODELS:
            _UNPRICED_MODELS.add(model_name)
            warnings.warn(
                f"tool_call_cost_failed model={model_name} error={type(error).__name__}: "
                "LiteLLM couldn't price the call, so this model's calls record null costs",
                stacklevel=2,
            )
        return None, None


def _split_model_id(model_name: str) -> tuple[str, str]:
    """Split a provider-prefixed model ID into (provider, model); reject other providers."""
    provider, _, bare_model = model_name.partition("/")
    if provider not in _TOOL_SCHEMA_CONVERTERS or not bare_model:
        raise ValueError(
            f"Unsupported model '{model_name}'. Must be '<provider>/<model>' "
            f"with a provider in: {list(_TOOL_SCHEMA_CONVERTERS)}",
        )
    return provider, bare_model


async def get_tool_predictions(
    prompt: str,
    tools: list[Tool],
    model_name: str,
    temperature: float,
) -> dict[str, Any]:
    """
    Get the LLM's tool predictions for a given prompt.

    Calls LiteLLM with a forced tool call ("required", which LiteLLM sends to
    Anthropic as `{"type": "any"}`). The model gets its production request
    settings from the backend's settings table at `temperature`, so a model
    that rejects a temperature, or needs a reasoning effort, is sent what the
    table says rather than the raw config value.

    Returns:
        Dict with 'predictions' (list of tool calls), 'request_settings' (the
        per-model settings sent, the temperature included when it was sent), and
        'usage' (token/cost data). `input_tokens` counts every prompt token,
        cached ones included, and `cached_input_tokens` is the cached part
        (None when the provider reports none). The costs are LiteLLM's, and None
        when LiteLLM has no price for the model. `duration_seconds` covers every
        attempt.
    """
    provider, bare_model = _split_model_id(model_name)
    convert_tool = _TOOL_SCHEMA_CONVERTERS[provider]
    request_settings = model_request_settings(model_name, temperature)
    kwargs: dict[str, Any] = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "tools": [convert_tool(tool) for tool in tools],
        "tool_choice": "required",
        "timeout": _TOOL_CALL_TIMEOUT,
        "num_retries": 0,
        # Private LiteLLM flag, used on purpose. On every call that has `tools`,
        # LiteLLM 1.106.0 first checks for its proxy's MCP gateway tools, and the
        # check imports code that needs `mcp>=2.2`. fastmcp 3.2.4 (the MCP
        # servers) pins `mcp<2`, so the import fails and every call errors.
        # LiteLLM's own MCP handler sets this flag to skip the check; these
        # tools are plain function tools, so the check has nothing to find.
        # Remove it once a LiteLLM release contains LiteLLM PR #45961, which
        # stops these calls from importing that code. If
        # the flag stops working (say a LiteLLM upgrade renames it), every call
        # fails with `APIConnectionError` naming `CacheableResult`, after all
        # retries, so it looks like a network failure. The flag doesn't cover a
        # call LiteLLM sends to OpenAI's Responses API, which fails on the same
        # import: on 1.106.0 that is any GPT-6 tool call with reasoning effort
        # above "none", so GPT-6 Sol and Astra can't run in these evals yet.
        "_skip_mcp_handler": True,
        **request_settings,
    }
    if provider == "anthropic":
        kwargs["max_tokens"] = _ANTHROPIC_MAX_TOKENS

    start = time.perf_counter()
    response = await _acompletion_with_retries(kwargs)
    duration_seconds = time.perf_counter() - start

    usage = response.usage
    input_cost, output_cost = _call_costs(model_name, bare_model, usage)
    prompt_details = usage.prompt_tokens_details
    tool_calls = response.choices[0].message.tool_calls or []
    return {
        "predictions": [
            {
                "tool_name": call.function.name,
                "arguments": json.loads(call.function.arguments or "{}"),
            }
            for call in tool_calls
        ],
        "request_settings": request_settings,
        "usage": {
            "input_tokens": usage.prompt_tokens,
            "cached_input_tokens": prompt_details.cached_tokens if prompt_details else None,
            "output_tokens": usage.completion_tokens,
            "input_cost": input_cost,
            "output_cost": output_cost,
            "total_cost": None if input_cost is None else input_cost + output_cost,
            "duration_seconds": duration_seconds,
        },
    }


def model_record(model_name: str, request_settings: dict[str, Any]) -> dict[str, Any]:
    """
    Return the model fields an MCP eval sample records.

    `temperature` is the temperature sent, or None when the settings table
    omits it; `request_settings` is what `get_tool_predictions` returned.
    """
    provider, _ = _split_model_id(model_name)
    return {
        "model_name": model_name,
        "model_provider": provider,
        "temperature": request_settings.get("temperature"),
    }


def check_argument_descriptions_preserved(
    prediction: dict[str, Any] | None,
    input_arguments: list[dict[str, Any]],
    expected_argument_names: list[str] | None,
) -> bool:
    """
    Check that unchanged argument descriptions are preserved exactly in the prediction.

    "Unchanged" args are names present in both the input and expected lists. For each,
    we verify the prediction's description matches the original exactly.

    Args:
        prediction: The LLM's tool prediction dict.
        input_arguments: The original argument definitions from the test case input.
        expected_argument_names: Expected argument names after the edit.

    Returns:
        True if all unchanged argument descriptions match the originals, or if
        there are no unchanged args to check.
    """
    if not expected_argument_names:
        return True

    input_names = {arg['name'] for arg in input_arguments if 'name' in arg}
    unchanged_names = input_names & set(expected_argument_names)
    if not unchanged_names or prediction is None:
        return not unchanged_names

    pred_args = prediction.get('arguments', {}).get('arguments')
    if not pred_args:
        # LLM omitted arguments parameter — server preserves descriptions automatically
        return True

    input_desc = {
        arg['name']: arg.get('description', '')
        for arg in input_arguments
        if 'name' in arg
    }
    pred_desc = {
        arg['name']: arg.get('description', '')
        for arg in pred_args
        if isinstance(arg, dict) and 'name' in arg
    }

    return all(
        name in pred_desc and pred_desc[name] == input_desc.get(name, '')
        for name in unchanged_names
    )


async def delete_note_via_api(note_id: str) -> None:
    """Delete a note via the API (permanent delete)."""
    async with httpx.AsyncClient() as client:
        await client.delete(
            f"{API_BASE_URL}/notes/{note_id}?permanent=true",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
        )


async def delete_bookmark_via_api(bookmark_id: str) -> None:
    """Delete a bookmark via the API (permanent delete)."""
    async with httpx.AsyncClient() as client:
        await client.delete(
            f"{API_BASE_URL}/bookmarks/{bookmark_id}?permanent=true",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
        )


async def delete_prompt_via_api(prompt_id: str) -> None:
    """Delete a prompt via the API (permanent delete)."""
    async with httpx.AsyncClient() as client:
        await client.delete(
            f"{API_BASE_URL}/prompts/{prompt_id}?permanent=true",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
        )


async def create_prompt_via_api(
    name: str,
    content: str,
    arguments: list[dict[str, Any]],
    title: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Create a prompt via the API and return the response."""
    payload: dict[str, Any] = {
        "name": name,
        "content": content,
        "arguments": arguments,
    }
    if title:
        payload["title"] = title
    if description:
        payload["description"] = description

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{API_BASE_URL}/prompts/",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def get_prompt_via_api(prompt_id: str) -> dict[str, Any]:
    """Get a prompt by ID via the API."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/prompts/{prompt_id}",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
        )
        response.raise_for_status()
        return response.json()


async def create_note_via_api(
    title: str,
    content: str,
    tags: list[str] | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Create a note via the API and return the response."""
    payload: dict[str, Any] = {
        "title": title,
        "content": content,
    }
    if tags:
        payload["tags"] = tags
    if description:
        payload["description"] = description

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{API_BASE_URL}/notes/",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def get_note_via_api(note_id: str) -> dict[str, Any]:
    """Get a note by ID via the API."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/notes/{note_id}",
            headers={"Authorization": f"Bearer {PAT_TOKEN}"},
        )
        response.raise_for_status()
        return response.json()
