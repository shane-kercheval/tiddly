"""Pydantic schemas for MCP context endpoints."""
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from schemas.content_filter import FilterExpression
from schemas.prompt import PromptArgument
from schemas.validators import normalize_preview


# =============================================================================
# Shared schemas
# =============================================================================


class EntityCounts(BaseModel):
    """Active and archived counts for a single entity type."""

    active: int
    archived: int


class ContextTag(BaseModel):
    """Tag with usage counts for context endpoints."""

    name: str
    content_count: int
    filter_count: int


class SidebarContextFilter(BaseModel):
    """A filter in the sidebar tree (root-level or inside a collection)."""

    type: Literal["filter"] = "filter"
    id: UUID
    name: str


class SidebarContextCollection(BaseModel):
    """A collection in the sidebar tree containing filters."""

    type: Literal["collection"] = "collection"
    name: str
    items: list[SidebarContextFilter]


SidebarContextItem = Annotated[
    SidebarContextFilter | SidebarContextCollection,
    Field(discriminator="type"),
]


# =============================================================================
# Content context schemas
# =============================================================================


class ContentContextCounts(BaseModel):
    """Counts for bookmarks and notes."""

    bookmarks: EntityCounts
    notes: EntityCounts


class ContextItem(BaseModel):
    """A bookmark or note item in the context response."""

    type: str
    id: UUID
    title: str | None
    description: str | None
    content_preview: str | None
    tags: list[str]
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_validator("content_preview", mode="before")
    @classmethod
    def strip_preview_whitespace(cls, v: str | None) -> str | None:
        """Collapse whitespace in content preview for clean display."""
        return normalize_preview(v)


class ContentContextFilter(BaseModel):
    """A filter with its top items for the content context response."""

    id: UUID
    name: str
    content_types: list[str]
    filter_expression: FilterExpression
    items: list[ContextItem]


class ContentContextResponse(BaseModel):
    """Response schema for GET /mcp/context/content."""

    generated_at: datetime
    counts: ContentContextCounts
    top_tags: list[ContextTag]
    filters: list[ContentContextFilter]
    sidebar_items: list[SidebarContextItem]
    recently_used: list[ContextItem]
    recently_created: list[ContextItem]
    recently_modified: list[ContextItem]


# =============================================================================
# Prompt context schemas
# =============================================================================


class ContextPrompt(BaseModel):
    """A prompt item in the context response."""

    id: UUID
    name: str
    title: str | None
    description: str | None
    content_preview: str | None
    arguments: list[PromptArgument]
    tags: list[str]
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_validator("content_preview", mode="before")
    @classmethod
    def strip_preview_whitespace(cls, v: str | None) -> str | None:
        """Collapse whitespace in content preview for clean display."""
        return normalize_preview(v)


class PromptContextFilter(BaseModel):
    """A filter with its top items for the prompt context response."""

    id: UUID
    name: str
    content_types: list[str]
    filter_expression: FilterExpression
    items: list[ContextPrompt]


class PromptContextResponse(BaseModel):
    """Response schema for GET /mcp/context/prompts."""

    generated_at: datetime
    counts: EntityCounts
    top_tags: list[ContextTag]
    filters: list[PromptContextFilter]
    sidebar_items: list[SidebarContextItem]
    recently_used: list[ContextPrompt]
    recently_created: list[ContextPrompt]
    recently_modified: list[ContextPrompt]
