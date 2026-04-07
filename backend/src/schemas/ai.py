"""Request/response schemas for AI suggestion endpoints."""
from pydantic import BaseModel, Field


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
    """Request for title/description suggestions."""

    model: str | None = None
    url: str | None = Field(None, max_length=2000)
    title: str | None = Field(None, max_length=500)
    content_snippet: str | None = Field(None, max_length=2500)


class SuggestMetadataResponse(BaseModel):
    """Response with suggested title and description."""

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
    """A suggested argument with name and description."""

    name: str
    description: str


class SuggestArgumentsResponse(BaseModel):
    """Response with suggested arguments."""

    arguments: list[ArgumentSuggestion]
