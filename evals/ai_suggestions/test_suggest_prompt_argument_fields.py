"""
Evaluation tests for the refine-fields prompt-argument endpoint.

Calls suggest_prompt_argument_fields() directly — no HTTP server or
database needed. `target_fields` makes caller intent explicit: one or
both of `name` / `description` on a specific argument row is regenerated.

Checks:
- Per-test-case: threshold (exactly one argument returned), subset
  (preserved opposite field / template-match) — defined in YAML.
- Global: llm_judge (description quality, target_fields-aware).
"""
from pathlib import Path
from typing import Any

import pytest
from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from pydantic import BaseModel

from evals.ai_suggestions.helpers import (
    EVAL_LLM_NUM_RETRIES,
    EVAL_LLM_TIMEOUT,
    create_eval_config,
    create_judge_llm_function,
    create_llm_service,
    create_suggestion_checks,
)
from evals.utils import (
    create_checks_from_config,
    create_test_cases_from_config,
    load_yaml_config,
)
from schemas.ai import ArgumentInput
from services.suggestion_service import suggest_prompt_argument_fields

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).parent / "config_suggest_prompt_argument_fields.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

MODELS = CONFIG["models"]
EVAL_CONFIG = CONFIG["eval"]
EVAL_NAME = CONFIG.get("name", "")
EVAL_DESCRIPTION = CONFIG.get("description", "")
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])


# ---------------------------------------------------------------------------
# Judge response model
# ---------------------------------------------------------------------------


class ArgumentJudgeResult(BaseModel):
    """Structured response from the LLM judge for argument refine quality."""

    passed: bool
    reasoning: str


# ---------------------------------------------------------------------------
# Checks — deterministic from YAML (built-in types), judge checks injected
# ---------------------------------------------------------------------------

_global_checks = CONFIG.get("checks", [])
_judge_llm_function = create_judge_llm_function(EVAL_CONFIG["judge_model"])
DETERMINISTIC_CHECKS = create_checks_from_config(
    [s for s in _global_checks if s["type"] != "llm_judge"],
)
JUDGE_CHECKS = create_suggestion_checks(
    check_specs=[s for s in _global_checks if s["type"] == "llm_judge"],
    llm_function=_judge_llm_function,
    judge_response_models={"arguments": ArgumentJudgeResult},
)
GLOBAL_CHECKS = DETERMINISTIC_CHECKS + JUDGE_CHECKS


# ---------------------------------------------------------------------------
# LLM service (module-level — shared across all model configs)
# ---------------------------------------------------------------------------

_llm_service = create_llm_service()


# ---------------------------------------------------------------------------
# Eval test
# ---------------------------------------------------------------------------


@evaluate(
    test_cases=TEST_CASES,
    checks=GLOBAL_CHECKS,
    samples=EVAL_CONFIG["samples"],
    pass_threshold=EVAL_CONFIG["pass_threshold"],
    max_concurrency=EVAL_CONFIG.get("max_concurrency"),
    output_dir=Path(__file__).parent / "results",
    metadata={
        "eval_name": EVAL_NAME,
        "eval_description": EVAL_DESCRIPTION,
    },
)
@pytest.mark.timeout(300)
@pytest.mark.parametrize("model_config", MODELS, ids=[m["name"] for m in MODELS])
async def test_suggest_prompt_argument_fields(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that suggest_prompt_argument_fields produces a single refined
    argument whose populated fields match the `target_fields` contract.

    Per-test-case checks verify argument count and name alignment.
    Global judge verifies description quality with target_fields awareness.
    """
    config = create_eval_config(_llm_service, model_config["name"])
    # Temperature is informational — records the LLMService default (0.7) for the viewer.
    # The service layer controls temperature internally; it's not overridable per-call.
    temperature = model_config.get("temperature", 0.7)
    input_data = test_case.input

    existing_args = [ArgumentInput(**a) for a in input_data.get("arguments", [])]

    result, cost = await suggest_prompt_argument_fields(
        prompt_content=input_data.get("prompt_content"),
        arguments=existing_args,
        target_index=input_data["target_index"],
        target_fields=input_data["target_fields"],
        llm_service=_llm_service,
        config=config,
        timeout=EVAL_LLM_TIMEOUT,
        num_retries=EVAL_LLM_NUM_RETRIES,
    )

    argument_names = [a.name for a in result]
    # Render without outer quotes around the description — descriptions can
    # legitimately contain quoted examples (e.g. Example: "Spanish"), and
    # wrapping them in outer quotes produces ambiguous nested-quote text that
    # the judge reads as malformed.
    arguments_detail = "\n".join(
        f"- name: {a.name} | description: {a.description} | required: {a.required}"
        for a in result
    ) if result else "No arguments returned."

    return {
        "argument_names": argument_names,
        "argument_count": len(argument_names),
        "arguments_detail": arguments_detail,
        "model_name": config.model,
        "temperature": temperature,
        "usage": {
            "total_cost": cost,
        },
    }
