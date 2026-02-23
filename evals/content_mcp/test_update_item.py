"""
Evaluation tests for the Content MCP server's update_item tool.

update_item updates metadata (title, description, tags, url) and/or fully replaces content.
All parameters optional - only provide what you want to change.

These tests verify that an LLM correctly uses update_item for:
1. Substantial content changes requiring full replacement (not edit_content)
2. Tags behavior:
   - When NOT updating tags: LLM should NOT provide tags parameter
   - When updating tags: LLM MUST provide ALL tags (full replacement, not merge)
"""

import json
from pathlib import Path
from typing import Any

import pytest
from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from sik_llms.mcp_manager import MCPClientManager

from evals.utils import (
    call_tool_with_retry,
    create_checks_from_config,
    create_test_cases_from_config,
    delete_note_via_api,
    get_content_mcp_config,
    get_tool_predictions,
    load_yaml_config,
)


# Load configuration at module level
CONFIG_PATH = Path(__file__).parent / "config_update_item.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

# Extract configuration values
MODELS = CONFIG["models"]
EVAL_CONFIG = CONFIG["eval"]
EVAL_NAME = CONFIG.get("name", "")
EVAL_DESCRIPTION = CONFIG.get("description", "")
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])
CHECKS = create_checks_from_config(CONFIG["checks"])


def _check_tags_provided(prediction: dict[str, Any]) -> bool:
    """Check if the tags parameter was provided in the prediction."""
    predicted_args = prediction.get("arguments", {})
    return "tags" in predicted_args and predicted_args["tags"] is not None


async def _run_update_item_eval(
    content: str,
    instruction: str,
    model_name: str,
    provider: str,
    temperature: float,
    tags: list[str] | None = None,
    expected_tags: list[str] | None = None,
) -> dict[str, Any]:
    """
    Run a single update_item evaluation case end-to-end.

    Steps:
    1. Connect to MCP server
    2. Create note via MCP create_note tool
    3. Get note content via MCP get_item tool
    4. Get LLM tool prediction for the instruction
    5. Execute the predicted tool (update_item or edit_content)
    6. Get final content via MCP get_item tool
    7. Clean up (delete note via API - no MCP delete tool)

    Args:
        content: Initial note content.
        instruction: What to tell the LLM to do.
        model_name: LLM model to use.
        provider: LLM provider ("anthropic" or "openai").
        temperature: Temperature setting.
        tags: Initial tags for the note (optional).
        expected_tags: Expected behavior for tags:
            - None: LLM should NOT provide tags parameter
            - list: Final tags should match this list
    """
    config = get_content_mcp_config()
    note_id = None

    try:
        async with MCPClientManager(config) as mcp_manager:
            print(".", end="", flush=True)
            tools = mcp_manager.get_tools()

            # Create the note via MCP
            create_payload: dict[str, Any] = {
                "title": "Eval Test Note",
                "content": content,
                "tags": tags if tags else ["eval-test"],
            }
            create_result = await call_tool_with_retry(
                mcp_manager,
                "create_note",
                create_payload,
            )
            note_data = json.loads(create_result.content[0].text)
            note_id = note_data["id"]
            original_tags = tags if tags else ["eval-test"]

            # Get the note content via MCP to show the LLM
            get_result = await call_tool_with_retry(
                mcp_manager,
                "get_item",
                {"id": note_id, "type": "note"},
            )
            note_data = get_result.structuredContent

            # Build prompt - show the full get_item result (includes tags)
            assert note_data is not None, "get_item returned no data"
            prompt = f"""
`get_item` tool result:
```json
{json.dumps(note_data, indent=2)}
```

Use the tool result above as context for the following instruction.

**Instruction:** {instruction}"""
            # Get tool predictions (expect exactly one)
            result = await get_tool_predictions(
                prompt=prompt,
                tools=tools,
                model_name=model_name,
                provider=provider,
                temperature=temperature,
            )
            predictions = result["predictions"]

            # Execute the predicted tool (only if single prediction)
            tool_result = None
            final_content = None
            final_tags: list[str] = []
            tool_error = None
            prediction = predictions[0] if len(predictions) == 1 else None

            predicted_tool = prediction["tool_name"] if prediction else None
            predicted_args = prediction.get("arguments", {}) if prediction else {}
            tags_provided = _check_tags_provided(prediction) if prediction else False

            if predicted_tool in ("update_item", "edit_content"):
                try:
                    exec_result = await call_tool_with_retry(
                        mcp_manager,
                        predicted_tool,
                        predicted_args,
                    )
                    if not exec_result.isError:
                        tool_result = exec_result.structuredContent

                        # Fetch final state via MCP to verify the change
                        final_get_result = await call_tool_with_retry(
                            mcp_manager,
                            "get_item",
                            {"id": note_id, "type": "note"},
                        )
                        final_content = final_get_result.structuredContent.get("content")
                        final_tags = sorted(final_get_result.structuredContent.get("tags", []))
                    elif exec_result.content:
                        tool_error = exec_result.content[0].text
                    else:
                        tool_error = "Unknown error"
                except Exception as e:
                    tool_error = str(e)

            # Compute tags check (mirrors update_prompt pattern):
            # - If expected is None: LLM should NOT have provided tags
            # - If expected is a list: final tags should match
            if expected_tags is None:
                tags_check = not tags_provided
            else:
                tags_check = sorted(final_tags) == sorted(expected_tags)

            return {
                "note_id": note_id,
                "original_content": content,
                "original_tags": original_tags,
                "prompt": prompt,
                "tool_predictions": predictions,
                "prediction_count": len(predictions),
                "tags_provided": tags_provided,
                "tool_result": tool_result,
                "final_content": final_content,
                "final_tags": final_tags,
                "tags_check": tags_check,
                "tool_error": tool_error,
                "usage": result["usage"],
            }

    finally:
        # Clean up - delete via API (no MCP delete tool)
        if note_id:
            await delete_note_via_api(note_id)


@evaluate(
    test_cases=TEST_CASES,
    checks=CHECKS,
    samples=EVAL_CONFIG["samples"],
    success_threshold=EVAL_CONFIG["success_threshold"],
    max_concurrency=EVAL_CONFIG.get("max_concurrency"),
    output_dir=Path(__file__).parent / "results",
    metadata={
        "eval_name": EVAL_NAME,
        "eval_description": EVAL_DESCRIPTION,
    },
)
@pytest.mark.timeout(180)
@pytest.mark.parametrize("model_config", MODELS, ids=[m["name"] for m in MODELS])
async def test_update_item_notes(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that the LLM correctly uses update_item.

    Checks:
    - Correct tool selection (update_item, not edit_content) for substantial changes
    - Final content contains expected text
    - Tags behavior:
      - If expected_tags is null: LLM should NOT have provided tags
      - If expected_tags is a list: final tags should match
    """
    result = await _run_update_item_eval(
        content=test_case.input["content"],
        instruction=test_case.input["instruction"],
        model_name=model_config["name"],
        provider=model_config["provider"],
        temperature=model_config["temperature"],
        tags=test_case.input.get("tags"),
        expected_tags=test_case.expected.get("expected_tags"),
    )
    result["model_name"] = model_config["name"]
    result["model_provider"] = model_config["provider"]
    result["temperature"] = model_config["temperature"]
    return result
