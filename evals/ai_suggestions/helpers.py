"""Shared helpers for AI suggestion evaluations."""
from collections.abc import Callable
from typing import Any

from flex_evals import Check
from litellm import acompletion
from pydantic import BaseModel

from core.config import Settings
from services.llm_service import KeySource, LLMConfig, LLMService, _resolve_platform_key

# Eval-tuned overrides for the suggestion LLM calls. The service defaults are
# tight (15s / 0 retries) because the UI wants fail-fast latency. Evals run
# hundreds of calls in a batch and benefit from tolerating transient provider
# slowdowns — a 30s burp from OpenAI shouldn't fail an eval run.
EVAL_LLM_TIMEOUT = 60
EVAL_LLM_NUM_RETRIES = 3


def create_llm_service() -> LLMService:
    """
    Create an LLMService for eval use.

    Uses a dummy database_url since evals never touch the database.
    Reads LLM API keys from environment/.env.
    """
    settings = Settings(
        database_url="postgresql://unused:unused@localhost/unused",
        dev_mode=True,  # bypass auth validation — evals don't touch auth
    )
    return LLMService(settings)


def create_eval_config(llm_service: LLMService, model_name: str) -> LLMConfig:
    """Create an LLMConfig for the specified model."""
    return LLMConfig(
        model=model_name,
        api_key=_resolve_platform_key(model_name, llm_service._settings),
        key_source=KeySource.PLATFORM,
    )


def create_judge_llm_function(
    judge_model: str,
) -> Callable:
    """
    Create a judge LLM function bound to a specific model.

    Returns an async callable with signature (prompt, response_format) -> (parsed, metadata)
    as required by LLMJudgeCheck.
    """

    async def judge_llm_function(
        prompt: str,
        response_format: type[BaseModel],
    ) -> tuple[BaseModel, dict[str, Any]]:
        response = await acompletion(
            model=judge_model,
            messages=[{"role": "user", "content": prompt}],
            response_format=response_format,
            temperature=0,
            num_retries=2,
        )
        content = response.choices[0].message.content
        parsed = response_format.model_validate_json(content)
        metadata = {
            "model": judge_model,
            "usage": {
                "input_tokens": response.usage.prompt_tokens if response.usage else None,
                "output_tokens": response.usage.completion_tokens if response.usage else None,
            },
        }
        return parsed, metadata

    return judge_llm_function


def create_suggestion_checks(
    check_specs: list[dict[str, Any]],
    llm_function: Callable,
    judge_response_models: dict[str, type[BaseModel]],
) -> list[Check]:
    """
    Create checks from YAML specs, injecting runtime objects for llm_judge checks.

    For llm_judge checks, injects llm_function and response_format into arguments
    at load time. All other check types pass through unchanged.

    Args:
        check_specs: Check specifications from YAML config.
        llm_function: Async callable for LLM judge calls.
        judge_response_models: Maps model keys to Pydantic classes
            (e.g. {"tags": TagJudgeResult}).
    """
    checks = []
    for raw_spec in check_specs:
        if raw_spec["type"] == "llm_judge":
            spec = {**raw_spec, "arguments": {**raw_spec["arguments"]}}
            spec["arguments"]["llm_function"] = llm_function
            model_key = spec["arguments"].pop("response_model", "default")
            spec["arguments"]["response_format"] = judge_response_models[model_key]
        else:
            spec = raw_spec
        checks.append(Check(
            type=spec["type"],
            arguments=spec["arguments"],
            metadata=spec.get("metadata"),
        ))
    return checks
