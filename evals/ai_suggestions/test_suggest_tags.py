"""
Evaluation tests for tag suggestion quality.

Calls suggest_tags() directly with curated context — no HTTP server or database
needed. Tests verify that the LLM produces relevant, well-formatted tags given
realistic content with various input field combinations.

Checks:
- Per-test-case: subset (expected tags present), disjoint (excluded tags absent),
  threshold (tag count bounds) — defined in YAML using built-in flex-evals types
- Global: is_empty with negate (tags non-empty), llm_judge (semantic relevance)
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
from schemas.ai import TagVocabularyEntry
from services.suggestion_service import suggest_tags

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).parent / "config_suggest_tags.yaml"
CONFIG = load_yaml_config(CONFIG_PATH)

MODELS = CONFIG["models"]
EVAL_CONFIG = CONFIG["eval"]
EVAL_NAME = CONFIG.get("name", "")
EVAL_DESCRIPTION = CONFIG.get("description", "")
TEST_CASES = create_test_cases_from_config(CONFIG["test_cases"])


# ---------------------------------------------------------------------------
# Judge response model
# ---------------------------------------------------------------------------


class TagJudgeResult(BaseModel):
    """Structured response from the LLM judge for tag relevance."""

    relevant_count: int
    total_count: int
    passed: bool
    reasoning: str


# ---------------------------------------------------------------------------
# Checks — deterministic from YAML (built-in types), judge checks injected
# ---------------------------------------------------------------------------

# Global checks: split deterministic (no injection) from judge (needs injection)
_global_checks = CONFIG.get("checks", [])
_judge_llm_function = create_judge_llm_function(EVAL_CONFIG["judge_model"])
DETERMINISTIC_CHECKS = create_checks_from_config(
    [s for s in _global_checks if s["type"] != "llm_judge"],
)
JUDGE_CHECKS = create_suggestion_checks(
    check_specs=[s for s in _global_checks if s["type"] == "llm_judge"],
    llm_function=_judge_llm_function,
    judge_response_models={"tags": TagJudgeResult},
)
GLOBAL_CHECKS = DETERMINISTIC_CHECKS + JUDGE_CHECKS

# Per-test-case checks are defined in YAML and loaded by create_test_cases_from_config


# ---------------------------------------------------------------------------
# Curated test data — loaded from YAML config
# ---------------------------------------------------------------------------

TAG_VOCABULARY = [
    TagVocabularyEntry(**entry) for entry in CONFIG["tag_vocabulary"]
]

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
    success_threshold=EVAL_CONFIG["success_threshold"],
    max_concurrency=EVAL_CONFIG.get("max_concurrency"),
    output_dir=Path(__file__).parent / "results",
    metadata={
        "eval_name": EVAL_NAME,
        "eval_description": EVAL_DESCRIPTION,
    },
)
@pytest.mark.timeout(300)
@pytest.mark.parametrize("model_config", MODELS, ids=[m["name"] for m in MODELS])
async def test_suggest_tags(
    test_case: TestCase,
    model_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Test that suggest_tags produces relevant, well-formatted tags.

    Each test case provides item context (title, description, content, etc.)
    and expected tag behavior. Per-test-case checks verify structural correctness
    (subset, disjoint, threshold). Global checks verify non-empty and semantic
    relevance (LLM judge).
    """
    config = create_eval_config(_llm_service, model_config["name"])
    # Temperature is informational — records the LLMService default (0.7) for the viewer.
    # The service layer controls temperature internally; it's not overridable per-call.
    temperature = model_config.get("temperature", 0.7)
    input_data = test_case.input

    # Allow per-test-case vocabulary overrides (e.g., replace "javascript" with "js")
    vocab = TAG_VOCABULARY
    overrides = input_data.get("tag_vocabulary_overrides")
    if overrides:
        override_map = {o["replace"]: o for o in overrides}
        vocab = [
            TagVocabularyEntry(name=override_map[e.name]["with"], count=e.count)
            if e.name in override_map
            else e
            for e in TAG_VOCABULARY
            if e.name not in override_map or override_map[e.name].get("with")
        ]

    tags, cost = await suggest_tags(
        title=input_data.get("title"),
        url=input_data.get("url"),
        description=input_data.get("description"),
        content_snippet=input_data.get("content_snippet"),
        content_type=input_data["content_type"],
        current_tags=input_data.get("current_tags", []),
        tag_vocabulary=vocab,
        llm_service=_llm_service,
        config=config,
    )

    return {
        "tags": tags,
        "tag_count": len(tags),
        "vocabulary_names": [v.name for v in vocab],
        "model_name": config.model,
        "temperature": temperature,
        "usage": {
            "total_cost": cost,
        },
    }
