"""
Evaluation tests for the Prompt MCP server's update_prompt tool.

update_prompt updates metadata (title, description, tags, name) and/or fully replaces template
content. All parameters optional - only provide what you want to change.

These tests verify that an LLM correctly uses update_prompt for full content
replacement scenarios, with particular focus on critical coordination behaviors:

Arguments:
1. When variables DON'T change: LLM should NOT provide arguments parameter
2. When variables DO change: LLM MUST provide arguments with ALL variables
3. Arguments is a FULL REPLACEMENT, not a merge

Tags:
4. When NOT updating tags: LLM should NOT provide tags parameter
5. When updating tags: LLM MUST provide ALL tags (existing + new)
6. Tags is a FULL REPLACEMENT, not a merge

The tests also verify the LLM chooses update_prompt (not edit_prompt_content)
for substantial template rewrites.
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from sik_llms.mcp_manager import MCPClientManager

from evals.utils import (
    MCP_CONCURRENCY_LIMIT,
    call_tool_with_retry,
    check_argument_descriptions_preserved,
    create_checks_from_config,
    create_test_cases_from_config,
    delete_prompt_via_api,
    get_prompt_mcp_config,
    get_tool_predictions,
    load_yaml_config,
)

_MCP_SEMAPHORE = asyncio.Semaphore(MCP_CONCURRENCY_LIMIT)

# Load configuration at module level
CONFIG_PATH = Path(__file__).parent / "config_update_prompt.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

# Extract configuration values
MODELS = CONFIG["models"]
EVAL_CONFIG = CONFIG["eval"]
EVAL_NAME = CONFIG.get("name", "")
EVAL_DESCRIPTION = CONFIG.get("description", "")
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])
CHECKS = create_checks_from_config(CONFIG["checks"])


def _get_args_from_llm_call(prediction: dict[str, Any]) -> list[str] | None:
    """
    Extract argument names from what the LLM passed in its tool call.

    Returns:
        None: If the LLM did not provide the arguments parameter at all.
        list[str]: Sorted list of argument names if arguments was provided
            (may be empty if LLM provided an empty list or malformed entries).
    """
    tool_args = prediction.get("arguments", {})
    if "arguments" not in tool_args:
        return None

    args_list = tool_args.get("arguments")
    if args_list is None:
        return None

    if not isinstance(args_list, list):
        return None

    names = [arg.get("name") for arg in args_list if isinstance(arg, dict) and arg.get("name")]
    return sorted(names)


def _get_args_from_final_state(prompt_data: dict[str, Any]) -> list[str]:
    """
    Extract argument names from the actual prompt state (fetched via MCP).

    Returns sorted list for order-independent comparison.
    """
    args = prompt_data.get("arguments", [])
    if not args:
        return []
    names = [arg.get("name") for arg in args if isinstance(arg, dict) and arg.get("name")]
    return sorted(names)


def _parse_tool_result(exec_result: Any) -> dict[str, Any] | None:
    """Parse tool execution result into a dict."""
    if exec_result.structuredContent:
        return exec_result.structuredContent
    if exec_result.content:
        try:
            return json.loads(exec_result.content[0].text)
        except (json.JSONDecodeError, IndexError):
            raw_text = exec_result.content[0].text if exec_result.content else None
            return {"raw": raw_text}
    return None


def _check_arguments_provided(prediction: dict[str, Any]) -> bool:
    """Check if the arguments parameter was provided in the prediction."""
    predicted_args = prediction.get("arguments", {})
    return "arguments" in predicted_args and predicted_args["arguments"] is not None


def _check_tags_provided(prediction: dict[str, Any]) -> bool:
    """Check if the tags parameter was provided in the prediction."""
    predicted_args = prediction.get("arguments", {})
    return "tags" in predicted_args and predicted_args["tags"] is not None


async def _execute_and_verify(
    mcp_manager: MCPClientManager,
    predicted_tool: str | None,
    predicted_args: dict[str, Any],
    unique_name: str,
) -> tuple[dict[str, Any] | None, str | None, str | None, list[str], list[str]]:
    """
    Execute the predicted tool and fetch final state.

    Returns: (tool_result, tool_error, final_content, final_argument_names, final_tags)
    """
    if predicted_tool not in ("update_prompt", "edit_prompt_content"):
        return None, None, None, [], []

    try:
        # Adjust args for the unique name
        exec_args = dict(predicted_args)
        exec_args["name"] = unique_name

        exec_result = await call_tool_with_retry(mcp_manager, predicted_tool, exec_args)

        if exec_result.isError:
            error_text = exec_result.content[0].text if exec_result.content else "Unknown error"
            return None, error_text, None, [], []

        tool_result = _parse_tool_result(exec_result)

        # Fetch final prompt state via MCP
        # Use get_prompt_content for content and arguments
        final_get_result = await call_tool_with_retry(
            mcp_manager, "get_prompt_content", {"name": unique_name},
        )
        final_prompt = json.loads(final_get_result.content[0].text)
        final_content = final_prompt.get("content")
        final_argument_names = _get_args_from_final_state(final_prompt)

        # Use get_prompt_metadata for tags (get_prompt_content doesn't return tags)
        final_metadata_result = await call_tool_with_retry(
            mcp_manager, "get_prompt_metadata", {"name": unique_name},
        )
        final_metadata = json.loads(final_metadata_result.content[0].text)
        final_tags = sorted(final_metadata.get("tags", []))

        return tool_result, None, final_content, final_argument_names, final_tags

    except Exception as e:
        return None, str(e), None, [], []


async def _run_update_prompt_eval(  # noqa: PLR0915
    prompt_name: str,
    content: str,
    arguments: list[dict[str, Any]],
    instruction: str,
    expected_argument_names: list[str] | None,
    model_name: str,
    provider: str,
    temperature: float,
    show_results: list[str],
    tags: list[str] | None = None,
    expected_tags: list[str] | None = None,
) -> dict[str, Any]:
    """
    Run a single update_prompt evaluation case end-to-end.

    Steps:
    1. Connect to MCP server
    2. Create prompt via MCP create_prompt tool (unique name to avoid conflicts)
    3. Get prompt data via specified tool(s) to show the LLM
    4. Get LLM tool prediction
    5. Execute the predicted tool
    6. Fetch final prompt state via MCP get_prompt_content tool
    7. Extract metrics and compute checks
    8. Clean up (delete prompt via API - no MCP delete tool)

    Args:
        prompt_name: Base name for the test prompt (will be made unique).
        content: Initial template content.
        arguments: Initial argument definitions.
        instruction: What to tell the LLM to do with the prompt.
        expected_argument_names: Expected behavior for arguments parameter:
            - None: LLM should NOT provide arguments parameter
            - list: LLM should provide arguments, final state should match this list
        model_name: LLM model to use for prediction.
        provider: LLM provider ("anthropic" or "openai").
        temperature: Temperature setting for LLM.
        show_results: Which tool results to show the LLM (required). This simulates
            what an LLM would fetch before calling update_prompt - they'd call
            get_prompt_content to see template content, or get_prompt_metadata to
            see tags/title. Options:
            - ["get_prompt_content"]: For template edits
            - ["get_prompt_metadata"]: For metadata-only edits (tags, title)
            - ["get_prompt_content", "get_prompt_metadata"]: For both
        tags: Initial tags for the prompt (optional).
        expected_tags: Expected final tags after update:
            - None: Don't check tags
            - list: Final tags should match this list (tags is full replacement)
    """
    # Create unique prompt name to avoid conflicts in parallel runs
    unique_name = f"{prompt_name}-{uuid.uuid4().hex[:8]}"
    config = get_prompt_mcp_config()
    prompt_id = None

    try:
        async with _MCP_SEMAPHORE, MCPClientManager(config) as mcp_manager:
            print(".", end="", flush=True)
            tools = mcp_manager.get_tools()

            # Create the prompt via MCP
            create_payload: dict[str, Any] = {
                "name": unique_name,
                "content": content,
                "arguments": arguments,
            }
            if tags:
                create_payload["tags"] = tags

            create_result = await call_tool_with_retry(
                mcp_manager,
                "create_prompt",
                create_payload,
            )
            # Parse the response to get the prompt ID
            if create_result.structuredContent:
                created_data = create_result.structuredContent
            else:
                created_data = json.loads(create_result.content[0].text)
            prompt_id = created_data["id"]

            # Fetch prompt data via specified tool(s) to show the LLM
            tool_results_text = []
            prompt_data = None  # Will store template data if fetched

            if "get_prompt_content" in show_results:
                get_template_result = await call_tool_with_retry(
                    mcp_manager,
                    "get_prompt_content",
                    {"name": unique_name},
                )
                prompt_data = json.loads(get_template_result.content[0].text)
                tool_results_text.append(
                    f"`get_prompt_content` tool result:\n\n```json\n"
                    f"{json.dumps(prompt_data, indent=2)}\n```",
                )

            if "get_prompt_metadata" in show_results:
                get_metadata_result = await call_tool_with_retry(
                    mcp_manager,
                    "get_prompt_metadata",
                    {"name": unique_name},
                )
                metadata = json.loads(get_metadata_result.content[0].text)
                tool_results_text.append(
                    f"`get_prompt_metadata` tool result:\n\n```json\n"
                    f"{json.dumps(metadata, indent=2)}\n```",
                )

            # Build prompt - show the tool result(s) and ask for changes
            tool_results_section = "\n\n".join(tool_results_text)
            llm_prompt = f"""
{tool_results_section}

Use the tool results above as context for the following instruction.

**Instruction:** {instruction}"""

            # Get tool predictions (expect exactly one)
            result = await get_tool_predictions(
                prompt=llm_prompt,
                tools=tools,
                model_name=model_name,
                provider=provider,
                temperature=temperature,
            )
            predictions = result["predictions"]
            prediction = predictions[0] if len(predictions) == 1 else None

            # Extract prediction metadata
            predicted_args = prediction.get("arguments", {}) if prediction else {}
            arguments_provided = _check_arguments_provided(prediction) if prediction else False
            tags_provided = _check_tags_provided(prediction) if prediction else False
            predicted_argument_names = _get_args_from_llm_call(prediction) if prediction else None
            predicted_tool = prediction["tool_name"] if prediction else None

            # Execute the predicted tool and fetch final state
            tool_result, tool_error, final_content, final_argument_names, final_tags = (
                await _execute_and_verify(
                    mcp_manager, predicted_tool, predicted_args, unique_name,
                )
            )

            # DEBUG: Print when something goes wrong
            if tool_error or final_content is None:
                print(f"\n[DEBUG] prompt_name={unique_name}")
                print(f"[DEBUG] predicted_tool={predicted_tool}")
                print(f"[DEBUG] predicted_args={predicted_args}")
                print(f"[DEBUG] tool_error={tool_error}")
                print(f"[DEBUG] final_content is None: {final_content is None}")

            # Compute the combined argument check:
            # - If expected is None: LLM should NOT have provided arguments
            # - If expected is a list: final argument names should match
            if expected_argument_names is None:
                expected_argument_names_check = not arguments_provided
            else:
                expected_argument_names_check = (
                    sorted(final_argument_names) == sorted(expected_argument_names)
                )

            # Compute tags check (mirrors arguments check pattern):
            # - If expected is None: LLM should NOT have provided tags
            # - If expected is a list: final tags should match
            if expected_tags is None:
                tags_check = not tags_provided
            else:
                tags_check = sorted(final_tags) == sorted(expected_tags)

            return {
                "prompt_id": prompt_id,
                "prompt_name": unique_name,
                "original_content": content,
                "original_arguments": arguments,
                "original_tags": tags,
                "prompt_data": prompt_data,
                "llm_prompt": llm_prompt,
                "tool_predictions": predictions,
                "prediction_count": len(predictions),
                "arguments_provided": arguments_provided,
                "tags_provided": tags_provided,
                "predicted_argument_names": predicted_argument_names,
                "tool_result": tool_result,
                "tool_error": tool_error,
                "final_content": final_content,
                "final_argument_names": final_argument_names,
                "final_tags": final_tags,
                "expected_argument_names_check": expected_argument_names_check,
                "argument_descriptions": check_argument_descriptions_preserved(
                    prediction, arguments, expected_argument_names,
                ),
                "tags_check": tags_check,
                "usage": result["usage"],
            }

    finally:
        # Clean up - delete via API (no MCP delete tool)
        if prompt_id:
            await delete_prompt_via_api(prompt_id)


@evaluate(
    test_cases=TEST_CASES,
    checks=CHECKS,
    samples=EVAL_CONFIG["samples"],
    success_threshold=EVAL_CONFIG["success_threshold"],
    output_dir=Path(__file__).parent / "results",
    metadata={
        "eval_name": EVAL_NAME,
        "eval_description": EVAL_DESCRIPTION,
    },
)
@pytest.mark.parametrize("model_config", MODELS, ids=[m["name"] for m in MODELS])
async def test_update_prompt(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that the LLM correctly uses update_prompt for full content replacement.

    Each test case:
    1. Creates a prompt with specific content and arguments
    2. Gets the prompt data via MCP get_prompt_content tool
    3. Asks the LLM to make significant changes
    4. Gets the LLM's tool prediction
    5. Executes the predicted tool
    6. Fetches final prompt state via MCP
    7. Verifies the results

    The checks verify:
    - Correct tool was selected (update_prompt, not edit_prompt_content)
    - Final content contains expected text
    - Final content does not contain forbidden text
    - Argument behavior is correct:
      - If expected_argument_names is null: LLM should NOT have provided arguments
      - If expected_argument_names is a list: final args should match
    - Tags behavior is correct (if expected_tags provided):
      - Tags are full replacement, so LLM must provide ALL tags
    """
    result = await _run_update_prompt_eval(
        prompt_name=test_case.input["prompt_name"],
        content=test_case.input["content"],
        arguments=test_case.input["arguments"],
        instruction=test_case.input["instruction"],
        expected_argument_names=test_case.expected.get("expected_argument_names"),
        model_name=model_config["name"],
        provider=model_config["provider"],
        temperature=model_config["temperature"],
        show_results=test_case.input["show_results"],
        tags=test_case.input.get("tags"),
        expected_tags=test_case.expected.get("expected_tags"),
    )
    result["model_name"] = model_config["name"]
    result["model_provider"] = model_config["provider"]
    result["temperature"] = model_config["temperature"]
    return result
