"""
Evaluation tests for the Content MCP server's edit_content tool.

These tests verify that an LLM can correctly use the edit_content tool
to make precise text replacements in notes and bookmarks.
"""

import asyncio
import json
from pathlib import Path
from typing import Any
from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from sik_llms.mcp_manager import MCPClientManager
from evals.utils import (
    create_checks_from_config,
    create_test_cases_from_config,
    delete_note_via_api,
    get_content_mcp_config,
    get_tool_prediction,
    load_yaml_config,
)

# Limit concurrent MCP connections to avoid overwhelming npx mcp-remote processes.
# Each connection spawns a subprocess, and too many concurrent connections cause
# asyncio task/cancel scope issues in the MCP client SDK.
_MCP_SEMAPHORE = asyncio.Semaphore(20)

async def _call_tool_with_retry(
    mcp_manager: MCPClientManager,
    tool_name: str,
    args: dict[str, Any],
    max_retries: int = 3,
    retry_delay: float = 1.0,
) -> Any:
    """Call MCP tool with retry logic for transient failures."""
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

# Load configuration at module level
CONFIG_PATH = Path(__file__).parent / "config_edit_content.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

# Extract configuration values
MODEL_CONFIG = CONFIG["model"]
EVAL_CONFIG = CONFIG["eval"]
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])
CHECKS = create_checks_from_config(CONFIG["checks"])


async def _run_edit_content_eval(
    content: str,
    search_query: str,
    model_name: str,
    temperature: float,
) -> dict[str, Any]:
    """
    Run a single edit_content evaluation case end-to-end.

    Creates its own MCP connection to avoid blocking issues when running
    concurrently (flex-evals runs all samples in parallel).

    Steps:
    1. Connect to MCP server
    2. Create note
    3. Search for the issue
    4. Get LLM tool prediction
    5. Execute the tool
    6. Get final content
    7. Clean up (delete note)
    """
    config = get_content_mcp_config()

    # Acquire semaphore to limit concurrent MCP connections
    async with _MCP_SEMAPHORE, MCPClientManager(config) as mcp_manager:
        print(".", end="", flush=True)
        tools = mcp_manager.get_tools()
        # Create the note (with retry for transient failures)
        create_result = await _call_tool_with_retry(
            mcp_manager,
            "create_note",
            {
                "title": "Eval Test Note",
                "content": content,
                "tags": ["eval-test"],
            },
        )

        content_data = json.loads(create_result.content[0].text)
        content_id = content_data["id"]

        try:
            # Search for the issue (with retry)
            search_result = await _call_tool_with_retry(
                mcp_manager,
                "search_in_content",
                {
                    "id": content_id,
                    "type": "note",
                    "query": search_query,
                },
            )
            search_response = json.dumps(search_result.structuredContent, indent=2)

            # Build prompt
            prompt = f"""I found an issue in this note. Please fix it.

Note ID: {content_id}
Type: note

`search_in_content` tool result for "{search_query}":
```json
{search_response}
```

Fix the issue."""

            # Get tool prediction
            prediction = await get_tool_prediction(
                prompt=prompt,
                tools=tools,
                model_name=model_name,
                temperature=temperature,
            )

            # Execute the tool if it's edit_content
            tool_result = None
            final_content = None
            edit_error = None

            if prediction["tool_name"] == "edit_content":
                try:
                    edit_result = await _call_tool_with_retry(
                        mcp_manager,
                        "edit_content",
                        prediction["arguments"],
                    )
                    if not edit_result.isError:
                        tool_result = edit_result.structuredContent

                        # Get final content
                        get_result = await _call_tool_with_retry(
                            mcp_manager,
                            "get_content",
                            {"id": content_id, "type": "note"},
                        )
                        if not get_result.isError:
                            final_content = get_result.structuredContent.get("content")
                    # Capture error details for debugging
                    elif edit_result.content:
                        edit_error = edit_result.content[0].text
                    else:
                        edit_error = "Unknown error"
                except Exception as e:
                    edit_error = str(e)

            return {
                "content_id": content_id,
                "prompt": prompt,
                "tool_prediction": prediction,
                "tool_result": tool_result,
                "final_content": final_content,
                "edit_error": edit_error,
            }

        finally:
            # Clean up
            await delete_note_via_api(content_id)


@evaluate(
    test_cases=TEST_CASES,
    checks=CHECKS,
    samples=EVAL_CONFIG["samples"],
    success_threshold=EVAL_CONFIG["success_threshold"],
)
async def test_edit_content_notes(test_case: TestCase) -> dict[str, Any]:
    """
    Test that the LLM correctly uses edit_content to fix issues in notes.

    Each test case:
    1. Creates its own MCP connection (to avoid blocking in concurrent runs)
    2. Creates a note with specific content containing an issue
    3. Searches for the issue using search_in_content
    4. Gets the LLM's tool prediction for fixing it
    5. Executes the edit_content tool
    6. Verifies the final content is correct
    7. Cleans up the test note

    The checks verify:
    - Correct tool was selected (edit_content)
    - old_str contains the issue
    - new_str contains the fix
    - Final content contains the fix
    """
    return await _run_edit_content_eval(
        content=test_case.input["content"],
        search_query=test_case.input["search_query"],
        model_name=MODEL_CONFIG["name"],
        temperature=MODEL_CONFIG["temperature"],
    )
