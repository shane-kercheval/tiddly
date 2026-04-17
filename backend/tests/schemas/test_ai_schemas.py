"""Unit tests for AI schema types."""
import typing

from schemas.ai import AIUseCaseKey
from services.llm_service import AIUseCase


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
