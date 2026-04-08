"""Request/response schemas for AI suggestion endpoints."""
from typing import Literal

from pydantic import BaseModel, Field, field_validator


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
    title: str | None = Field(None, max_length=500)
    url: str | None = Field(None, max_length=2000)
    description: str | None = Field(None, max_length=1000)
    content_snippet: str | None = Field(None, max_length=2500)
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
    url: str | None = Field(None, max_length=2000)

    @field_validator("fields")
    @classmethod
    def fields_not_empty(cls, v: list) -> list:
        """At least one field must be requested."""
        if not v:
            raise ValueError("fields must contain at least one of 'title' or 'description'")
        return v
    title: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=1000)
    content_snippet: str | None = Field(None, max_length=2500)


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
    url: str | None = Field(None, max_length=2000)
    description: str | None = Field(None, max_length=1000)
    content_snippet: str | None = Field(None, max_length=2500)
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
    """Request for prompt argument suggestions."""

    model: str | None = None
    prompt_content: str | None = Field(None, max_length=5000)
    arguments: list[ArgumentInput] = []
    target: str | None = None


class ArgumentSuggestion(BaseModel):
    """A suggested argument with name, description, and required flag."""

    name: str
    description: str
    required: bool = False


class SuggestArgumentsResponse(BaseModel):
    """Response with suggested arguments."""

    arguments: list[ArgumentSuggestion]
