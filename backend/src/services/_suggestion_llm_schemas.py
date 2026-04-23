"""
Internal Pydantic models used as LiteLLM `response_format` schemas.

These are NOT part of the public API surface. They exist only to constrain
LLM structured output so `suggestion_service.py` can reliably parse results.
Keeping them separate from `schemas/ai.py` prevents them from leaking into
the OpenAPI spec and from being confused with request/response DTOs.

If you find yourself tempted to expose one of these, reconsider — the API
shape should be defined by the public models in `schemas/ai.py`, with the
service layer mapping LLM output onto that public shape.
"""
from pydantic import BaseModel


class TitleOnly(BaseModel):
    """LLM response format when only `title` is requested in suggest-metadata."""

    title: str


class DescriptionOnly(BaseModel):
    """LLM response format when only `description` is requested in suggest-metadata."""

    description: str


class TitleAndDescription(BaseModel):
    """LLM response format when both fields are requested in suggest-metadata."""

    title: str
    description: str


class ArgumentNameSuggestion(BaseModel):
    """LLM response format for single-field name refine in suggest-prompt-argument-fields."""

    name: str


class ArgumentDescriptionSuggestion(BaseModel):
    """LLM response format for single-field description refine on the fields endpoint."""

    description: str


class _BothArgumentFieldsSuggestion(BaseModel):
    """
    LLM response format for the two-field refine case.

    Includes `required` so the two-field path matches generate-all's
    template-aware inference. Single-field refine does not include
    `required` (pre-existing behavior preserved — single-field patches
    one field and doesn't touch the row's required flag).
    """

    name: str
    description: str
    required: bool = False


class _LLMGeneratedArgument(BaseModel):
    """One entry in the generate-all LLM response."""

    name: str
    description: str
    required: bool = False


class _GenerateAllArgumentsResult(BaseModel):
    """
    LLM response format for the plural generate-all endpoint.

    Decouples the LLM structured-output schema from the public HTTP
    response model so the two contracts can evolve independently.
    """

    arguments: list[_LLMGeneratedArgument]
