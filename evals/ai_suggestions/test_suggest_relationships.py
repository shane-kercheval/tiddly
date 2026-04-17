"""
Evaluation tests for relationship suggestion quality.

Calls suggest_relationships() directly with curated candidates — no HTTP
server or database needed. Tests verify that the LLM selects genuinely
related items and rejects unrelated ones.

Checks:
- Per-test-case: subset (expected candidates selected), disjoint (unrelated
  excluded), is_empty — defined in YAML
- Global: threshold (max 5 candidates), llm_judge (semantic relevance)
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
from schemas.ai import RelationshipCandidateContext
from services.suggestion_service import suggest_relationships

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).parent / "config_suggest_relationships.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

MODELS = CONFIG["models"]
EVAL_CONFIG = CONFIG["eval"]
EVAL_NAME = CONFIG.get("name", "")
EVAL_DESCRIPTION = CONFIG.get("description", "")
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])


# ---------------------------------------------------------------------------
# Judge response model
# ---------------------------------------------------------------------------


class RelationshipJudgeResult(BaseModel):
    """Structured response from the LLM judge for relationship relevance."""

    relevant_count: int
    total_selected: int
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
    judge_response_models={"relationships": RelationshipJudgeResult},
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
async def test_suggest_relationships(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that suggest_relationships selects genuinely related candidates.

    Each test case provides source item context and a curated candidate list.
    Per-test-case checks verify correct selections (subset, disjoint).
    Global checks verify candidate count bounds and semantic relevance (judge).
    """
    config = create_eval_config(_llm_service, model_config["name"])
    # Temperature is informational — records the LLMService default (0.7) for the viewer.
    # The service layer controls temperature internally; it's not overridable per-call.
    temperature = model_config.get("temperature", 0.7)
    input_data = test_case.input

    # Build candidates from YAML (KeyError on missing key — fail fast on typos)
    candidates = [
        RelationshipCandidateContext(**c)
        for c in input_data["candidates"]
    ]

    # Build candidate summaries for the judge prompt (includes content_preview
    # so the judge sees the same context the suggestion model saw)
    candidate_summaries = "\n".join(
        f"- {c.entity_id}: \"{c.title}\" — {c.description} | Content: {c.content_preview}"
        for c in candidates
    )

    result, cost = await suggest_relationships(
        title=input_data.get("title"),
        url=input_data.get("url"),
        description=input_data.get("description"),
        content_snippet=input_data.get("content_snippet"),
        candidates=candidates,
        llm_service=_llm_service,
        config=config,
    )

    candidate_ids = [c.entity_id for c in result]

    return {
        "candidate_ids": candidate_ids,
        "candidate_count": len(candidate_ids),
        "all_candidate_summaries": candidate_summaries,
        "model_name": config.model,
        "temperature": temperature,
        "usage": {
            "total_cost": cost,
        },
    }
