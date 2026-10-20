"""
Stall check for prompt-argument suggestions at production settings (run 2026-10-20).

Why: in the 2026-10-20 suggestion-eval run, four prompt-argument calls took about
61 s (three gpt-6-luna, one gpt-5.4-nano), on the test cases
`objective-jinja-conditional` and `generate-all-mixed-short-and-long`. The eval
allows 60 s per attempt and 3 retries; production allows 15 s and no retries, so
in production those calls would have been timeouts. This check repeats those two
cases the way production calls them.

What it does: calls the backend's own `suggest_prompt_arguments` with its
production defaults (neither `timeout` nor `num_retries` is passed: 15 s, no
retries) for both models on both cases, 20 calls per model and case, one call at
a time, alternating the two models call by call so both see the same provider
conditions. No judge. Writes every call to `calls.json` next to this file
(case, model, call number, outcome, seconds, cost) and prints a summary.

Run from the repo root (costs about $0.01 with the platform keys in `.env`):

    PYTHONPATH=backend/src uv run --env-file .env python \
        evals/ai_suggestions/results/2026-10-20-prompt-arguments-stall-check/run_stall_check.py

The committed `calls.json` is the output of the 2026-10-20 run; running this
again overwrites it.
"""
import asyncio
import json
import statistics
import time
from pathlib import Path

import yaml

from core.config import Settings
from schemas.ai import ArgumentInput
from services.llm_service import KeySource, LLMConfig, LLMService, _resolve_platform_key
from services.suggestion_service import suggest_prompt_arguments

CASES = ["objective-jinja-conditional", "generate-all-mixed-short-and-long"]
MODELS = ["openai/gpt-6-luna", "openai/gpt-5.4-nano"]
CALLS = 20
BUDGET_USD = 0.10
CONFIG = Path("evals/ai_suggestions/config_suggest_prompt_arguments.yaml")
OUTPUT = Path(__file__).with_name("calls.json")


def load_inputs() -> dict[str, dict]:
    """Return the eval inputs for the two test cases, keyed by test case ID."""
    config_yaml = yaml.safe_load(CONFIG.read_text())
    return {c["id"]: c["input"] for c in config_yaml["test_cases"] if c["id"] in CASES}


async def run_calls(inputs: dict[str, dict]) -> list[dict]:
    """Make the calls one at a time and return one record per call."""
    settings = Settings(database_url="postgresql://unused:unused@localhost/unused", dev_mode=True)
    service = LLMService(settings)
    configs = {
        m: LLMConfig(
            model=m, api_key=_resolve_platform_key(m, settings), key_source=KeySource.PLATFORM,
        )
        for m in MODELS
    }
    records: list[dict] = []
    total = 0.0
    for case in CASES:
        data = inputs[case]
        for i in range(1, CALLS + 1):
            for model in MODELS:
                if total > BUDGET_USD:
                    print(f"BUDGET STOP at ${total:.4f}")
                    return records
                started = time.monotonic()
                try:
                    _, cost = await suggest_prompt_arguments(
                        prompt_content=data["prompt_content"],
                        arguments=[ArgumentInput(**a) for a in data.get("arguments", [])],
                        llm_service=service,
                        config=configs[model],
                    )
                    outcome = "ok"
                    total += cost or 0.0
                except Exception as exc:
                    # Record every failure (a timeout is the point) and keep going.
                    cost = None
                    outcome = type(exc).__name__
                elapsed = time.monotonic() - started
                records.append({
                    "case": case, "model": model, "call": i, "outcome": outcome,
                    "seconds": round(elapsed, 2), "cost": cost,
                })
                print(f"{case:35} {model:22} call {i:2}: {outcome:16} {elapsed:6.2f}s cost={cost}")
    print(f"TOTAL recorded cost: ${total:.4f}")
    return records


def summarize(records: list[dict]) -> None:
    """Print timeouts and the latency spread of completed calls, per case and model."""
    for case in CASES:
        for model in MODELS:
            rows = [r for r in records if r["case"] == case and r["model"] == model]
            done = sorted(r["seconds"] for r in rows if r["outcome"] == "ok")
            timeouts = sum(1 for r in rows if r["outcome"] == "Timeout")
            if done:
                p90 = done[max(0, -(-len(done) * 9 // 10) - 1)]
                spread = (
                    f"{done[0]:.2f} / {statistics.median(done):.2f} / {p90:.2f} / {done[-1]:.2f} s"
                )
            else:
                spread = "-"
            print(
                f"{case} | {model} | {len(rows)} calls | {timeouts} timed out | "
                f"min/median/p90/max {spread}",
            )


def main() -> None:
    """Run the check, write calls.json next to this file, and print the summary."""
    records = asyncio.run(run_calls(load_inputs()))
    OUTPUT.write_text(json.dumps(records, indent=1))
    summarize(records)


if __name__ == "__main__":
    main()
