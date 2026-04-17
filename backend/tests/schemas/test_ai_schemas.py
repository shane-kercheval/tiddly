"""Unit tests for AI schema types."""
import typing

from schemas.ai import AIModelEntry, AIUseCaseKey
from services.llm_service import _SUPPORTED_MODEL_DEFS, AIUseCase


class TestAIUseCaseKeyDriftGuard:
    """
    Guards against drift between `schemas.ai.AIUseCaseKey` (the hand-written
    Literal exposed in the OpenAPI spec) and `services.llm_service.AIUseCase`
    (the runtime enum). Python's type system can't unify these, so a runtime
    test is the last line of defense.
    """

    def test__ai_use_case_key__matches_ai_use_case_enum_values(self) -> None:
        literal_values = set(typing.get_args(AIUseCaseKey))
        enum_values = {uc.value for uc in AIUseCase}
        assert literal_values == enum_values, (
            f"AIUseCaseKey Literal and AIUseCase enum drifted. "
            f"Literal has {literal_values}, enum has {enum_values}. "
            f"Add/remove values on both sides (see schemas/ai.py and "
            f"services/llm_service.py)."
        )


class TestAIModelEntryDriftGuard:
    """
    Guards against drift between the hand-written `Literal`s on
    `AIModelEntry.provider` / `.tier` (exposed in OpenAPI as enums) and the
    runtime catalog `services.llm_service._SUPPORTED_MODEL_DEFS`.

    Without these guards, adding a new provider or tier to `_SUPPORTED_MODEL_DEFS`
    without updating the Literal would cause Pydantic `ValidationError` at
    `/ai/models` response-build time — i.e., in production, not at import time
    or in CI.
    """

    def test__ai_model_entry_provider__covers_every_catalog_provider(self) -> None:
        literal_values = set(
            typing.get_args(AIModelEntry.model_fields["provider"].annotation),
        )
        catalog_providers = {defn["provider"] for defn in _SUPPORTED_MODEL_DEFS}
        missing = catalog_providers - literal_values
        assert not missing, (
            f"AIModelEntry.provider Literal is missing providers present in "
            f"_SUPPORTED_MODEL_DEFS: {missing}. Add them to the Literal in "
            f"schemas/ai.py."
        )

    def test__ai_model_entry_tier__covers_every_catalog_tier(self) -> None:
        literal_values = set(
            typing.get_args(AIModelEntry.model_fields["tier"].annotation),
        )
        catalog_tiers = {defn["tier"] for defn in _SUPPORTED_MODEL_DEFS}
        missing = catalog_tiers - literal_values
        assert not missing, (
            f"AIModelEntry.tier Literal is missing tiers present in "
            f"_SUPPORTED_MODEL_DEFS: {missing}. Add them to the Literal in "
            f"schemas/ai.py."
        )
