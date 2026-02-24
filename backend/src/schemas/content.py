"""Pydantic schemas for unified content endpoints."""
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from schemas.validators import normalize_preview

ViewOption = Literal["active", "archived", "deleted"]


class ContentListItem(BaseModel):
    """
    Unified content item for list views.

    This schema represents bookmarks, notes, and prompts in a unified format.
    The `type` field indicates the content type, and type-specific fields
    may be None for other types.
    """

    type: Literal["bookmark", "note", "prompt"]
    id: UUID
    title: str | None
    description: str | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime
    deleted_at: datetime | None = None
    archived_at: datetime | None = None

    # Content size metrics (available for all types)
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

    # Bookmark-specific (None for notes/prompts)
    summary: str | None = None
    url: str | None = None

    # Prompt-specific (None for bookmarks/notes)
    name: str | None = None
    arguments: list[dict[str, Any]] | None = None


class ContentListResponse(BaseModel):
    """Schema for paginated unified content list responses."""

    items: list[ContentListItem]
    total: int  # Total count of items matching the query (before pagination)
    offset: int  # Current pagination offset
    limit: int  # Current pagination limit
    has_more: bool  # True if there are more results beyond this page
