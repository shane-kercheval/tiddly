"""
Evaluation tests for metadata (title/description) suggestion quality.

Calls suggest_metadata() directly with curated context — no HTTP server
or database needed. Tests verify the fields parameter logic (only requested
fields are generated) and that generated content is relevant and well-formatted.

Checks:
- Per-test-case: attribute_exists (requested fields present, unrequested null),
  threshold (title length) — defined in YAML
- Global: llm_judge (quality of generated title/description)
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
from services.suggestion_service import suggest_metadata

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).parent / "config_suggest_metadata.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

MODELS = CONFIG["models"]
EVAL_CONFIG = CONFIG["eval"]
EVAL_NAME = CONFIG.get("name", "")
EVAL_DESCRIPTION = CONFIG.get("description", "")
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])


# ---------------------------------------------------------------------------
# Judge response model
# ---------------------------------------------------------------------------


class MetadataJudgeResult(BaseModel):
    """Structured response from the LLM judge for metadata quality."""

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
    judge_response_models={"metadata": MetadataJudgeResult},
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
async def test_suggest_metadata(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that suggest_metadata generates appropriate titles and descriptions.

    Each test case specifies which fields to generate and provides context.
    Per-test-case checks verify the fields parameter logic (requested fields
    present, unrequested null, title length). Global judge verifies quality.
    """
    config = create_eval_config(_llm_service, model_config["name"])
    # Temperature is informational — records the LLMService default (0.7) for the viewer.
    # The service layer controls temperature internally; it's not overridable per-call.
    temperature = model_config.get("temperature", 0.7)
    input_data = test_case.input

    result, cost = await suggest_metadata(
        fields=input_data["fields"],
        url=input_data.get("url"),
        title=input_data.get("title"),
        description=input_data.get("description"),
        content_snippet=input_data.get("content_snippet"),
        llm_service=_llm_service,
        config=config,
    )

    return {
        "title": result.title,
        "description": result.description,
        "title_length": len(result.title) if result.title else 0,
        "model_name": config.model,
        "temperature": temperature,
        "usage": {
            "total_cost": cost,
        },
    }
