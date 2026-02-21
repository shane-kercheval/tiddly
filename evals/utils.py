"""Shared utilities for MCP server evaluations."""

import asyncio
from pathlib import Path
from typing import Any

import httpx
import yaml
from flex_evals import TestCase, get_check_class
from flex_evals.checks.base import BaseCheck
from sik_llms import RegisteredClients, create_client, user_message
from sik_llms.mcp_manager import MCPClientManager

# Concurrency limit for MCP connections. Tuned to avoid overwhelming npx mcp-remote
# processes which spawn subprocesses for each connection. Too high causes timeouts
# and connection failures; too low slows down parallel test execution.
MCP_CONCURRENCY_LIMIT = 20

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


def create_checks_from_config(check_specs: list[dict[str, Any]]) -> list[BaseCheck]:
    """
    Convert YAML check specifications to Check objects.

    Example YAML format:
        checks:
          - type: "contains"
            arguments:
              text: "$.output.value.final_content"
              phrases: "$.test_case.expected.must_contain"
    """
    checks = []
    for spec in check_specs:
        check_class = get_check_class(spec["type"])
        check = check_class(**spec["arguments"])
        checks.append(check)
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
        test_case = TestCase(
            id=spec.get("id"),
            input=spec["input"],
            expected=spec.get("expected"),
            metadata=spec.get("metadata"),
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


_PROVIDER_MAP = {
    "anthropic": RegisteredClients.ANTHROPIC_TOOLS,
    "openai": RegisteredClients.OPENAI_TOOLS,
}


async def get_tool_prediction(
    prompt: str,
    tools: list,
    model_name: str,
    provider: str,
    temperature: float = 0,
) -> dict[str, Any]:
    """
    Get the LLM's tool prediction for a given prompt.

    Returns:
        dict with 'tool_name' and 'arguments' keys
    """
    client_type = _PROVIDER_MAP.get(provider)
    if client_type is None:
        raise ValueError(f"Unknown provider '{provider}'. Must be one of: {list(_PROVIDER_MAP)}")
    client = create_client(
        client_type=client_type,
        model_name=model_name,
        temperature=temperature,
        tools=tools,
    )
    response = await client.run_async(messages=[user_message(prompt)])
    predictions = response.tool_predictions
    if not predictions:
        return {"tool_name": None, "arguments": {}}
    if len(predictions) > 1:
        # Multiple tool calls — treat as a failed prediction
        return {"tool_name": None, "arguments": {}}
    return {
        "tool_name": predictions[0].name,
        "arguments": predictions[0].arguments or {},
    }


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
