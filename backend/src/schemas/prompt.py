"""Pydantic schemas for prompt endpoints."""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.content_metadata import ContentMetadata
from schemas.validators import (
    check_duplicate_argument_names,
    normalize_preview,
    validate_and_normalize_tags,
    validate_argument_name,
    validate_prompt_name,
)


class PromptArgument(BaseModel):
    """Schema for a prompt template argument definition."""

    name: str
    description: str | None = None
    required: bool | None = None  # None treated as False

    @field_validator("name")
    @classmethod
    def check_name_format(cls, v: str) -> str:
        """Validate argument name format."""
        return validate_argument_name(v)


class PromptCreate(BaseModel):
    """Schema for creating a new prompt."""

    name: str
    title: str | None = None
    description: str | None = None
    content: str  # Jinja2 template (required)
    arguments: list[PromptArgument] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    archived_at: datetime | None = Field(
        default=None,
        description="Schedule auto-archive at this time. Accepts ISO 8601 format with timezone "
                    "(e.g., '2025-02-01T16:00:00Z'). Stored as UTC. "
                    "Future dates schedule auto-archive; past dates archive immediately.",
    )

    @field_validator("name")
    @classmethod
    def check_name_format(cls, v: str) -> str:
        """Validate prompt name format."""
        return validate_prompt_name(v)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: list[str]) -> list[str]:
        """Normalize and validate tags."""
        if v is None:
            return []
        return validate_and_normalize_tags(v)

    @model_validator(mode="after")
    def check_duplicate_arguments(self) -> "PromptCreate":
        """Ensure no duplicate argument names."""
        check_duplicate_argument_names(self.arguments)
        return self


class PromptUpdate(BaseModel):
    """Schema for updating an existing prompt."""

    name: str | None = None
    title: str | None = None
    description: str | None = None
    content: str | None = None
    arguments: list[PromptArgument] | None = None
    tags: list[str] | None = None
    archived_at: datetime | None = Field(
        default=None,
        description="Schedule auto-archive at this time. Omit to leave unchanged; "
                    "set to null to cancel a scheduled archive. "
                    "Accepts ISO 8601 format (e.g., '2025-02-01T16:00:00Z'). "
                    "Future dates schedule auto-archive; past dates archive immediately.",
    )
    expected_updated_at: datetime | None = Field(
        default=None,
        description="For optimistic locking. If provided and the prompt was modified after "
                    "this timestamp, returns 409 Conflict with current server state.",
    )

    @field_validator("name")
    @classmethod
    def check_name_format(cls, v: str | None) -> str | None:
        """Validate prompt name format if provided."""
        if v is not None:
            return validate_prompt_name(v)
        return v

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: list[str] | None) -> list[str] | None:
        """Normalize and validate tags if provided."""
        if v is None:
            return None
        return validate_and_normalize_tags(v)

    @model_validator(mode="after")
    def check_duplicate_arguments(self) -> "PromptUpdate":
        """Ensure no duplicate argument names if arguments provided."""
        check_duplicate_argument_names(self.arguments)
        return self


class PromptListItem(BaseModel):
    """
    Schema for prompt list items (excludes content for performance).

    The content field can be large, making list responses unnecessarily large.
    Use GET /prompts/:id to fetch full prompt with content.

    Note: Uses model_validator to extract tag names from the tag_objects
    relationship when eagerly loaded.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    title: str | None
    description: str | None
    arguments: list[PromptArgument]
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime
    deleted_at: datetime | None = None
    archived_at: datetime | None = None
    content_length: int | None = Field(
        default=None,
        description="Total character count of content field.",
    )
    content_preview: str | None = Field(
        default=None,
        description="First 500 characters of content.",
    )

    @field_validator("content_preview", mode="before")
    @classmethod
    def strip_preview_whitespace(cls, v: str | None) -> str | None:
        """Collapse whitespace in content preview for clean display."""
        return normalize_preview(v)

    @model_validator(mode="before")
    @classmethod
    def extract_from_sqlalchemy(cls, data: Any) -> Any:
        """
        Extract fields from SQLAlchemy model and tag names from tag_objects.

        Uses model introspection to automatically extract all schema fields,
        eliminating the need to maintain a hardcoded field list.

        Only accesses tag_objects if it's already loaded (not lazy) to avoid
        triggering database queries outside async context.
        """
        # Handle SQLAlchemy model objects
        if hasattr(data, "__dict__"):
            # Get all field names from the Pydantic model, excluding 'tags' which we handle
            field_names = set(cls.model_fields.keys()) - {"tags"}
            data_dict = {key: getattr(data, key) for key in field_names if hasattr(data, key)}

            # Check if tag_objects is already loaded (not lazy)
            # SQLAlchemy sets __dict__ entry when relationship is loaded
            if "tag_objects" in data.__dict__ and data.__dict__["tag_objects"] is not None:
                data_dict["tags"] = [tag.name for tag in data.__dict__["tag_objects"]]
            else:
                data_dict["tags"] = []

            return data_dict
        return data


class PromptResponse(PromptListItem):
    """
    Schema for full prompt responses (includes content).

    Returned by GET /prompts/:id and mutation endpoints.

    The content_metadata field is included whenever content is non-null,
    providing line count information and indicating whether the response
    contains partial or full content.
    """

    content: str | None
    content_metadata: ContentMetadata | None = None


class PromptListResponse(BaseModel):
    """Schema for paginated prompt list responses with search/filter metadata."""

    items: list[PromptListItem]
    total: int  # Total count of prompts matching the query (before pagination)
    offset: int  # Current pagination offset
    limit: int  # Current pagination limit
    has_more: bool  # True if there are more results beyond this page


class PromptRenderRequest(BaseModel):
    """Request schema for rendering a prompt with arguments."""

    arguments: dict[str, Any] = Field(
        default_factory=dict,
        description="Argument values keyed by argument name. Values can be strings, "
        "lists, dicts, or other JSON-serializable types for use with Jinja2 features "
        "like {% for %} loops.",
    )


class PromptRenderResponse(BaseModel):
    """Response schema for rendered prompt content."""

    rendered_content: str = Field(
        description="The rendered template with arguments applied",
    )
