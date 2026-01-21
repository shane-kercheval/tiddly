"""
Evaluation tests for the Prompt MCP server's edit_prompt_template tool.

These tests verify that an LLM can correctly use the edit_prompt_template tool
to make changes to prompt templates, including atomic updates to both
content and arguments when adding/removing/renaming variables.
"""

import json
import uuid
from pathlib import Path
from typing import Any

from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from sik_llms.mcp_manager import MCPClientManager

from evals.utils import (
    create_checks_from_config,
    create_prompt_via_api,
    create_test_cases_from_config,
    delete_prompt_via_api,
    get_prompt_mcp_config,
    get_tool_prediction,
    load_yaml_config,
)


# Load configuration at module level
CONFIG_PATH = Path(__file__).parent / "config_edit_prompt_template.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

# Extract configuration values
MODEL_CONFIG = CONFIG["model"]
EVAL_CONFIG = CONFIG["eval"]
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])
CHECKS = create_checks_from_config(CONFIG["checks"])


def _format_prompt_for_llm(prompt_data: dict[str, Any]) -> str:
    """
    Format prompt data as the LLM would see it from get_prompt_template tool.

    The format matches what the get_prompt_template MCP tool returns,
    which is JSON that includes name, title, description, content, arguments, and tags.
    """
    args_formatted = json.dumps(prompt_data.get("arguments", []), indent=2)
    return f"""Name: {prompt_data["name"]}
Title: {prompt_data.get("title") or "(none)"}
Description: {prompt_data.get("description") or "(none)"}

Arguments:
```json
{args_formatted}
```

Content:
```
{prompt_data.get("content", "")}
```"""


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


async def _run_edit_prompt_template_eval(
    prompt_name: str,
    content: str,
    arguments: list[dict[str, Any]],
    instruction: str,
    model_name: str,
    temperature: float,
) -> dict[str, Any]:
    """
    Run a single edit_prompt_template evaluation case end-to-end.

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
        # Get MCP tools and use get_prompt_template to get the context
        config = get_prompt_mcp_config()
        async with MCPClientManager(config) as mcp_manager:
            tools = mcp_manager.get_tools()

            # Call get_prompt_template MCP tool to get the prompt data
            get_template_result = await mcp_manager.call_tool(
                "get_prompt_template",
                {"name": unique_name},
            )

            # Parse the JSON response from get_prompt_template
            prompt_data = json.loads(get_template_result[0].text)

            # Build prompt for LLM
            prompt_display = _format_prompt_for_llm(prompt_data)
            llm_prompt = f"""I want to edit this prompt template.

{prompt_display}

**Instruction:** {instruction}

Use the edit_prompt_template tool to make this change.

CRITICAL RULES:
1. If you ADD, REMOVE, or RENAME a template variable ({{{{ var_name }}}}), you MUST include the `arguments` parameter with the COMPLETE list of arguments that should exist AFTER your edit.
2. If you're only fixing a typo or changing text without touching variables, do NOT include the `arguments` parameter.
3. The `arguments` list REPLACES all existing arguments - include every argument that should remain.
4. Use simple text replacement, NOT Jinja2 conditionals like {{% if %}}.

Example - removing a variable:
- name: "my-prompt"
- old_str: "Hello {{{{ name }}}}, welcome to {{{{ place }}}}!"
- new_str: "Hello, welcome to {{{{ place }}}}!"
- arguments: [{{"name": "place", "description": "The place name"}}]  # name is removed

Example - adding a variable:
- name: "my-prompt"
- old_str: "Generate a summary."
- new_str: "Generate a {{{{ length }}}} summary."
- arguments: [{{"name": "length", "description": "Summary length", "required": false}}]

Example - simple typo fix (no variable change):
- name: "my-prompt"
- old_str: "Anaylze this"
- new_str: "Analyze this"
- (no arguments parameter needed)"""

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
async def test_edit_prompt_template(test_case: TestCase) -> dict[str, Any]:
    """
    Test that the LLM correctly uses edit_prompt_template to modify prompts.

    Each test case:
    1. Creates a prompt with specific content and arguments
    2. Gets the prompt data via MCP get_prompt_template tool
    3. Asks the LLM to make a specific change
    4. Computes final_content by applying the predicted edit
    5. Extracts argument_names from prediction

    The checks verify:
    - Correct tool was selected (edit_prompt_template)
    - Final content contains expected text (variables preserved)
    - Final content does not contain forbidden text (variables removed)
    - Argument names exactly match expected (sorted list comparison)
    """
    return await _run_edit_prompt_template_eval(
        prompt_name=test_case.input["prompt_name"],
        content=test_case.input["content"],
        arguments=test_case.input["arguments"],
        instruction=test_case.input["instruction"],
        model_name=MODEL_CONFIG["name"],
        temperature=MODEL_CONFIG["temperature"],
    )
