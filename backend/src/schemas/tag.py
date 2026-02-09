"""Pydantic schemas for tag endpoints."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from schemas.validators import validate_and_normalize_tag


class TagCount(BaseModel):
    """Schema for a tag with its usage counts."""

    name: str
    content_count: int  # Count of bookmarks + notes + prompts
    filter_count: int  # Count of filters using this tag


class TagListResponse(BaseModel):
    """Schema for the tags list response."""

    tags: list[TagCount]


class TagResponse(BaseModel):
    """Schema for full tag response (used by rename endpoint)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    created_at: datetime


class TagRenameRequest(BaseModel):
    """Schema for renaming a tag."""

    new_name: str = Field(..., min_length=1, max_length=100)

    @field_validator("new_name", mode="before")
    @classmethod
    def normalize_and_validate(cls, v: str) -> str:
        """Normalize and validate the new tag name."""
        if not isinstance(v, str):
            raise ValueError("Tag name must be a string")
        return validate_and_normalize_tag(v)
