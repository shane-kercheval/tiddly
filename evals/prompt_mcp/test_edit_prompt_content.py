"""
Evaluation tests for the Prompt MCP server's edit_prompt_content tool.

These tests verify that an LLM can correctly use the edit_prompt_content tool
to make changes to prompt templates, including atomic updates to both
content and arguments when adding/removing/renaming variables.

The eval uses minimal prompting - just the raw tool output and an instruction.
This tests whether the tool descriptions and server instructions are sufficient
for an LLM to use the tools correctly without hand-holding.
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any
from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from sik_llms.mcp_manager import MCPClientManager
from evals.utils import (
    MCP_CONCURRENCY_LIMIT,
    create_checks_from_config,
    create_prompt_via_api,
    create_test_cases_from_config,
    delete_prompt_via_api,
    get_prompt_mcp_config,
    get_tool_prediction,
    load_yaml_config,
)

_MCP_SEMAPHORE = asyncio.Semaphore(MCP_CONCURRENCY_LIMIT)

# Load configuration at module level
CONFIG_PATH = Path(__file__).parent / "config_edit_prompt_content.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

# Extract configuration values
MODEL_CONFIG = CONFIG["model"]
EVAL_CONFIG = CONFIG["eval"]
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])
CHECKS = create_checks_from_config(CONFIG["checks"])


def _extract_argument_names(prediction: dict[str, Any]) -> list[str]:
    """
    Extract argument names from the tool prediction.

    Returns a sorted list for order-independent comparison with expected values.
    """
    args = prediction.get("arguments", {}).get("arguments", [])
    if not args:
        return []
    names = [arg.get("name") for arg in args if isinstance(arg, dict) and arg.get("name")]
    return sorted(names)


async def _run_edit_prompt_content_eval(
    prompt_name: str,
    content: str,
    arguments: list[dict[str, Any]],
    instruction: str,
    model_name: str,
    temperature: float,
) -> dict[str, Any]:
    """
    Run a single edit_prompt_content evaluation case end-to-end.

    Steps:
    1. Create prompt via API (unique name to avoid conflicts)
    2. Get prompt template via MCP tool to show the LLM
    3. Get LLM tool prediction
    4. Compute final_content by applying the predicted edit
    5. Extract argument_names from prediction (sorted for comparison)
    6. Clean up (delete prompt)
    """
    # Create unique prompt name to avoid conflicts in parallel runs
    unique_name = f"{prompt_name}-{uuid.uuid4().hex[:8]}"

    # Create the prompt via API
    created_prompt = await create_prompt_via_api(
        name=unique_name,
        content=content,
        arguments=arguments,
    )
    prompt_id = created_prompt["id"]

    try:
        # Get MCP tools and use get_prompt_content to get the context
        config = get_prompt_mcp_config()
        # Acquire semaphore to limit concurrent MCP connections
        async with _MCP_SEMAPHORE, MCPClientManager(config) as mcp_manager:
            print(".", end="", flush=True)
            tools = mcp_manager.get_tools()

            # Call get_prompt_content MCP tool to get the prompt data
            get_template_result = await mcp_manager.call_tool(
                "get_prompt_content",
                {"name": unique_name},
            )

            # Parse the JSON response from get_prompt_content
            # call_tool returns CallToolResult with .content attribute
            prompt_data = json.loads(get_template_result.content[0].text)

            # Build minimal prompt - just the raw tool output and instruction
            # No hand-holding about how to use the tool - the LLM should figure
            # that out from the tool descriptions and server instructions
            llm_prompt = f"""I want to edit this prompt template.

`get_prompt_content` tool result:
```json
{json.dumps(prompt_data, indent=2)}
```

**Instruction:** {instruction}"""

            # Get tool prediction
            prediction = await get_tool_prediction(
                prompt=llm_prompt,
                tools=tools,
                model_name=model_name,
                temperature=temperature,
            )

            # Compute final content by applying the edit
            original_content = content
            old_str = prediction.get("arguments", {}).get("old_str", "")
            new_str = prediction.get("arguments", {}).get("new_str", "")
            if old_str and old_str in original_content:
                final_content = original_content.replace(old_str, new_str)
            else:
                # old_str not found - final content unchanged (edit would fail)
                final_content = original_content

            # Extract argument names (sorted for order-independent comparison)
            argument_names = _extract_argument_names(prediction)

            return {
                "prompt_id": prompt_id,
                "prompt_name": unique_name,
                "prompt_data": prompt_data,
                "llm_prompt": llm_prompt,
                "tool_prediction": prediction,
                "final_content": final_content,
                "argument_names": argument_names,
            }

    finally:
        # Clean up
        await delete_prompt_via_api(prompt_id)


@evaluate(
    test_cases=TEST_CASES,
    checks=CHECKS,
    samples=EVAL_CONFIG["samples"],
    success_threshold=EVAL_CONFIG["success_threshold"],
)
async def test_edit_prompt_content(test_case: TestCase) -> dict[str, Any]:
    """
    Test that the LLM correctly uses edit_prompt_content to modify prompts.

    Each test case:
    1. Creates a prompt with specific content and arguments
    2. Gets the prompt data via MCP get_prompt_content tool
    3. Asks the LLM to make a specific change
    4. Computes final_content by applying the predicted edit
    5. Extracts argument_names from prediction

    The checks verify:
    - Correct tool was selected (edit_prompt_content)
    - Final content contains expected text (variables preserved)
    - Final content does not contain forbidden text (variables removed)
    - Argument names exactly match expected (sorted list comparison)
    """
    return await _run_edit_prompt_content_eval(
        prompt_name=test_case.input["prompt_name"],
        content=test_case.input["content"],
        arguments=test_case.input["arguments"],
        instruction=test_case.input["instruction"],
        model_name=MODEL_CONFIG["name"],
        temperature=MODEL_CONFIG["temperature"],
    )
