"""Pydantic schemas for bookmark endpoints."""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from schemas.content_metadata import ContentMetadata
from schemas.relationship import RelationshipInput, RelationshipWithContentResponse
from schemas.validators import normalize_preview, validate_and_normalize_tags


class BookmarkCreate(BaseModel):
    """Schema for creating a new bookmark."""

    # HttpUrl normalizes root domains with trailing slash (example.com -> example.com/)
    # but preserves paths as-is (example.com/page stays example.com/page)
    url: HttpUrl
    title: str | None = None
    description: str | None = None
    content: str | None = None  # User-provided or scraped content
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


class BookmarkUpdate(BaseModel):
    """Schema for updating an existing bookmark."""

    # See BookmarkCreate for HttpUrl normalization behavior
    url: HttpUrl | None = None
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
        description="For optimistic locking. If provided and the bookmark was modified after "
                    "this timestamp, returns 409 Conflict with current server state.",
    )

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: list[str] | None) -> list[str] | None:
        """Normalize and validate tags if provided."""
        if v is None:
            return None
        return validate_and_normalize_tags(v)


class BookmarkListItem(BaseModel):
    """
    Schema for bookmark list items (excludes content for performance).

    The content field can be up to 500KB per bookmark, making list responses
    unnecessarily large. Use GET /bookmarks/:id to fetch full bookmark with content.

    Note: Uses model_validator to extract tag names from the tag_objects
    relationship when eagerly loaded.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    url: str
    title: str | None
    description: str | None
    summary: str | None  # AI-generated summary (Phase 2)
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

        Passes dicts through unchanged (used when constructing from ContentListItem
        mappings or keyword args). Only activates ORM extraction for SQLAlchemy objects.
        """
        if isinstance(data, dict):
            return data
        # Handle SQLAlchemy model objects
        if hasattr(data, "__dict__"):
            field_names = set(cls.model_fields.keys()) - {"tags"}
            data_dict = {key: getattr(data, key) for key in field_names if hasattr(data, key)}
            if "tag_objects" in data.__dict__ and data.__dict__["tag_objects"] is not None:
                data_dict["tags"] = [tag.name for tag in data.__dict__["tag_objects"]]
            else:
                data_dict["tags"] = []
            return data_dict
        return data


class BookmarkResponse(BookmarkListItem):
    """
    Schema for full bookmark responses (includes content).

    Returned by GET /bookmarks/:id and mutation endpoints.

    The content_metadata field is included whenever content is non-null,
    providing line count information and indicating whether the response
    contains partial or full content.
    """

    content: str | None
    content_metadata: ContentMetadata | None = None
    relationships: list[RelationshipWithContentResponse] = Field(default_factory=list)


class BookmarkListResponse(BaseModel):
    """Schema for paginated bookmark list responses with search/filter metadata."""

    items: list[BookmarkListItem]
    total: int  # Total count of bookmarks matching the query (before pagination)
    offset: int  # Current pagination offset
    limit: int  # Current pagination limit
    has_more: bool  # True if there are more results beyond this page


class MetadataPreviewResponse(BaseModel):
    """Schema for URL metadata preview (before saving bookmark)."""

    url: str  # Original URL requested
    final_url: str  # URL after following redirects
    title: str | None
    description: str | None
    content: str | None = None  # Extracted page content (when include_content=True)
    error: str | None = None  # Error message if fetch failed
