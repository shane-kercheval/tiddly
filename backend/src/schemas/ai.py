"""Request/response schemas for AI suggestion endpoints."""
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Context models (passed from router → service → prompt builder)
# ---------------------------------------------------------------------------


class TagVocabularyEntry(BaseModel):
    """A tag from the user's vocabulary with usage count."""

    name: str
    count: int


class RelationshipCandidateContext(BaseModel):
    """
    A candidate item passed to the relationship suggestion service.

    Distinct from RelationshipCandidate (the public API response schema)
    — this includes description and content_preview for prompt building.
    """

    entity_id: str
    entity_type: str
    title: str
    description: str
    content_preview: str


# ---------------------------------------------------------------------------
# Validate Key
# ---------------------------------------------------------------------------


class ValidateKeyRequest(BaseModel):
    """Request for key validation. Model determines which provider to test against."""

    model: str | None = None


# ---------------------------------------------------------------------------
# Suggest Tags
# ---------------------------------------------------------------------------


class SuggestTagsRequest(BaseModel):
    """Request for tag suggestions."""

    model: str | None = None
    content_type: Literal["bookmark", "note", "prompt"]
    title: str | None = Field(None, max_length=500)
    url: str | None = Field(None, max_length=2048)
    description: str | None = Field(None, max_length=2000)
    content_snippet: str | None = Field(None, max_length=10_000)
    current_tags: list[str] = []


class SuggestTagsResponse(BaseModel):
    """Response with suggested tags."""

    tags: list[str]


# ---------------------------------------------------------------------------
# Suggest Metadata
# ---------------------------------------------------------------------------


class SuggestMetadataRequest(BaseModel):
    """
    Request for title/description suggestions.

    The `fields` parameter controls which fields are generated.
    Existing field values (title, description) are used as context
    for generating the requested fields, not overwritten.
    """

    model: str | None = None
    fields: list[Literal["title", "description"]] = ["title", "description"]
    url: str | None = Field(None, max_length=2048)

    @field_validator("fields")
    @classmethod
    def fields_not_empty(cls, v: list) -> list:
        """At least one field must be requested."""
        if not v:
            raise ValueError("fields must contain at least one of 'title' or 'description'")
        return v
    title: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=2000)
    content_snippet: str | None = Field(None, max_length=10_000)


class SuggestMetadataResponse(BaseModel):
    """
    Response with suggested title and/or description.

    Only requested fields are populated; others are None.
    """

    title: str | None = None
    description: str | None = None


# Internal response models for structured output — each tells the LLM
# exactly which field(s) to generate.

class _TitleOnly(BaseModel):
    """Internal: LLM response format when only title is requested."""

    title: str


class _DescriptionOnly(BaseModel):
    """Internal: LLM response format when only description is requested."""

    description: str


class _TitleAndDescription(BaseModel):
    """Internal: LLM response format when both fields are requested."""

    title: str
    description: str


# ---------------------------------------------------------------------------
# Suggest Relationships
# ---------------------------------------------------------------------------


class SuggestRelationshipsRequest(BaseModel):
    """Request for relationship suggestions."""

    model: str | None = None
    source_id: str | None = None
    title: str | None = Field(None, max_length=500)
    url: str | None = Field(None, max_length=2048)
    description: str | None = Field(None, max_length=2000)
    content_snippet: str | None = Field(None, max_length=10_000)
    current_tags: list[str] = []
    existing_relationship_ids: list[str] = []


class RelationshipCandidate(BaseModel):
    """A candidate item for a relationship suggestion."""

    entity_id: str
    entity_type: str
    title: str


class SuggestRelationshipsResponse(BaseModel):
    """Response with relationship candidates."""

    candidates: list[RelationshipCandidate]


# ---------------------------------------------------------------------------
# Suggest Arguments
# ---------------------------------------------------------------------------


class ArgumentInput(BaseModel):
    """An existing argument provided for context."""

    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=500)


class SuggestArgumentsRequest(BaseModel):
    """
    Request for prompt argument suggestions.

    Two modes:
    - Generate all (target_index=None): Extract and describe all new placeholders.
    - Individual (target_index=N): Suggest name or description for arguments[N].
      The backend determines which field to suggest based on which is missing.
    """

    model: str | None = None
    prompt_content: str | None = Field(None, max_length=50_000)
    arguments: list[ArgumentInput] = []
    target_index: int | None = Field(None, ge=0)


class ArgumentSuggestion(BaseModel):
    """A suggested argument with name, description, and required flag."""

    name: str
    description: str
    required: bool = False


class SuggestArgumentsResponse(BaseModel):
    """Response with suggested arguments."""

    arguments: list[ArgumentSuggestion]


# Internal response models for individual mode — each tells the LLM
# exactly which field to generate (like _TitleOnly/_DescriptionOnly for metadata).

class _ArgumentNameSuggestion(BaseModel):
    """Internal: LLM response format when suggesting a name for an argument."""

    name: str


class _ArgumentDescriptionSuggestion(BaseModel):
    """Internal: LLM response format when suggesting a description for an argument."""

    description: str
