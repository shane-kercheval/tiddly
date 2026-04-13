"""
Evaluation tests for prompt argument suggestion quality.

Calls suggest_arguments() directly — no HTTP server or database needed.
Covers generate-all mode (extract and describe placeholders from a template)
and individual mode (suggest name/description for a specific argument).

Checks:
- Per-test-case: subset (expected arguments present), threshold (argument count),
  is_empty — defined in YAML
- Global: llm_judge (description quality)
"""
from pathlib import Path
from typing import Any

import pytest
from flex_evals import TestCase
from flex_evals.pytest_decorator import evaluate
from pydantic import BaseModel

from evals.ai_suggestions.helpers import (
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
from services.suggestion_service import suggest_arguments

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).parent / "config_suggest_arguments.yaml"
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
    """Structured response from the LLM judge for argument description quality."""

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
async def test_suggest_arguments(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that suggest_arguments produces useful argument suggestions.

    Each test case provides a prompt template and mode (generate-all or individual).
    Per-test-case checks verify argument names and counts.
    Global judge verifies description quality.
    """
    config = create_eval_config(_llm_service, model_config["name"])
    # Temperature is informational — records the LLMService default (0.7) for the viewer.
    # The service layer controls temperature internally; it's not overridable per-call.
    temperature = model_config.get("temperature", 0.7)
    input_data = test_case.input

    # Build existing arguments from YAML
    existing_args = [
        ArgumentInput(**a) for a in input_data.get("arguments", [])
    ]

    result, cost = await suggest_arguments(
        prompt_content=input_data.get("prompt_content"),
        arguments=existing_args,
        target_index=input_data.get("target_index"),
        llm_service=_llm_service,
        config=config,
    )

    argument_names = [a.name for a in result]
    arguments_detail = "\n".join(
        f"- {a.name}: \"{a.description}\" (required: {a.required})"
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
