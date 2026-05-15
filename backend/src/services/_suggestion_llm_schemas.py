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


class MetadataSuggestionResult(BaseModel):
    """
    Unified LLM response format for `/ai/suggest-metadata`.

    All three fields are required: the LLM is instructed to either generate
    a new value (for fields the caller requested) or echo the current value
    (for fields used as context only). The service layer discards echoed
    values for non-requested fields so user-typed content can't drift via
    subtle LLM rewording.
    """

    name: str
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
