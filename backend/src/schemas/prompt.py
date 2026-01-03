"""Pydantic schemas for prompt endpoints."""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.config import get_settings
from schemas.validators import (
    check_duplicate_argument_names,
    validate_and_normalize_tags,
    validate_argument_name,
    validate_description_length,
    validate_prompt_name,
    validate_title_length,
)


def validate_prompt_content_length(content: str | None) -> str | None:
    """Validate that prompt content doesn't exceed maximum length (100KB)."""
    settings = get_settings()
    if content is not None and len(content) > settings.max_prompt_content_length:
        raise ValueError(
            f"Content exceeds maximum length of {settings.max_prompt_content_length:,} characters "
            f"(got {len(content):,} characters).",
        )
    return content


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
    content: str | None = None  # Jinja2 template
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

    @field_validator("title")
    @classmethod
    def check_title_length(cls, v: str | None) -> str | None:
        """Validate title length."""
        return validate_title_length(v)

    @field_validator("description")
    @classmethod
    def check_description_length(cls, v: str | None) -> str | None:
        """Validate description length."""
        return validate_description_length(v)

    @field_validator("content")
    @classmethod
    def check_content_length(cls, v: str | None) -> str | None:
        """Validate content length."""
        return validate_prompt_content_length(v)

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

    @field_validator("name")
    @classmethod
    def check_name_format(cls, v: str | None) -> str | None:
        """Validate prompt name format if provided."""
        if v is not None:
            return validate_prompt_name(v)
        return v

    @field_validator("title")
    @classmethod
    def check_title_length(cls, v: str | None) -> str | None:
        """Validate title length."""
        return validate_title_length(v)

    @field_validator("description")
    @classmethod
    def check_description_length(cls, v: str | None) -> str | None:
        """Validate description length."""
        return validate_description_length(v)

    @field_validator("content")
    @classmethod
    def check_content_length(cls, v: str | None) -> str | None:
        """Validate content length."""
        return validate_prompt_content_length(v)

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

    id: int
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

    @model_validator(mode="before")
    @classmethod
    def extract_tag_names(cls, data: Any) -> Any:
        """
        Extract tag names from tag_objects relationship.

        Only accesses tag_objects if it's already loaded (not lazy) to avoid
        triggering database queries outside async context.
        """
        # Handle SQLAlchemy model objects
        if hasattr(data, "__dict__"):
            data_dict = {}
            for key in [
                "id", "name", "title", "description", "arguments",
                "created_at", "updated_at", "last_used_at",
                "deleted_at", "archived_at", "content",
            ]:
                if hasattr(data, key):
                    data_dict[key] = getattr(data, key)

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
    """

    content: str | None


class PromptListResponse(BaseModel):
    """Schema for paginated prompt list responses with search/filter metadata."""

    items: list[PromptListItem]
    total: int  # Total count of prompts matching the query (before pagination)
    offset: int  # Current pagination offset
    limit: int  # Current pagination limit
    has_more: bool  # True if there are more results beyond this page
