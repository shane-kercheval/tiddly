"""Pydantic schemas for note endpoints."""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.content_metadata import ContentMetadata
from schemas.relationship import RelationshipInput, RelationshipWithContentResponse
from schemas.validators import normalize_preview, validate_and_normalize_tags


class NoteCreate(BaseModel):
    """Schema for creating a new note."""

    title: str  # Required for notes
    description: str | None = None
    content: str | None = None  # Markdown content, up to 2MB
    tags: list[str] = []
    relationships: list[RelationshipInput] = Field(default_factory=list)
    archived_at: datetime | None = Field(
        default=None,
        description="Schedule auto-archive at this time. Accepts ISO 8601 format with timezone "
                    "(e.g., '2025-02-01T16:00:00Z'). Stored as UTC. "
                    "Future dates schedule auto-archive; past dates archive immediately.",
    )

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: list[str]) -> list[str]:
        """Normalize and validate tags."""
        if v is None:
            return []
        return validate_and_normalize_tags(v)

    @field_validator("title")
    @classmethod
    def check_title_not_empty(cls, v: str) -> str:
        """Validate title is not empty."""
        if not v or not v.strip():
            raise ValueError("Title cannot be empty")
        return v


class NoteUpdate(BaseModel):
    """Schema for updating an existing note."""

    title: str | None = None
    description: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    relationships: list[RelationshipInput] | None = None
    archived_at: datetime | None = Field(
        default=None,
        description="Schedule auto-archive at this time. Omit to leave unchanged; "
                    "set to null to cancel a scheduled archive. "
                    "Accepts ISO 8601 format (e.g., '2025-02-01T16:00:00Z'). "
                    "Future dates schedule auto-archive; past dates archive immediately.",
    )
    expected_updated_at: datetime | None = Field(
        default=None,
        description="For optimistic locking. If provided and the note was modified after "
                    "this timestamp, returns 409 Conflict with current server state.",
    )

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: list[str] | None) -> list[str] | None:
        """Normalize and validate tags if provided."""
        if v is None:
            return None
        return validate_and_normalize_tags(v)

    @field_validator("title")
    @classmethod
    def check_title_not_empty(cls, v: str | None) -> str | None:
        """Validate title is not empty (if provided)."""
        if v is not None and not v.strip():
            raise ValueError("Title cannot be empty")
        return v


class NoteListItem(BaseModel):
    """
    Schema for note list items (excludes content for performance).

    The content field can be up to 2MB per note, making list responses
    unnecessarily large. Use GET /notes/:id to fetch full note with content.

    Note: Uses model_validator to extract tag names from the tag_objects
    relationship when eagerly loaded.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: str | None
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


class NoteResponse(NoteListItem):
    """
    Schema for full note responses (includes content).

    Returned by GET /notes/:id and mutation endpoints.

    The content_metadata field is included whenever content is non-null,
    providing line count information and indicating whether the response
    contains partial or full content.
    """

    content: str | None
    content_metadata: ContentMetadata | None = None
    relationships: list[RelationshipWithContentResponse] = Field(default_factory=list)


class NoteListResponse(BaseModel):
    """Schema for paginated note list responses with search/filter metadata."""

    items: list[NoteListItem]
    total: int  # Total count of notes matching the query (before pagination)
    offset: int  # Current pagination offset
    limit: int  # Current pagination limit
    has_more: bool  # True if there are more results beyond this page
