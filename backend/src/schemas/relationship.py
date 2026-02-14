"""Pydantic schemas for relationship endpoints."""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from schemas.validators import validate_relationship_description


class RelationshipInput(BaseModel):
    """
    Schema for relationship data in entity create/update payloads.

    The saving entity is the implicit source; only target is specified
    (like how tags are just strings in entity payloads).
    """

    target_type: Literal['bookmark', 'note', 'prompt']
    target_id: UUID
    relationship_type: Literal['related'] = 'related'
    description: str | None = None

    @field_validator('description')
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        """Validate description is at most 500 characters."""
        return validate_relationship_description(v)


class RelationshipCreate(BaseModel):
    """Schema for creating a new relationship between content items."""

    source_type: Literal['bookmark', 'note', 'prompt']
    source_id: UUID
    target_type: Literal['bookmark', 'note', 'prompt']
    target_id: UUID
    relationship_type: Literal['related']
    description: str | None = None

    @field_validator('description')
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        """Validate description is at most 500 characters."""
        return validate_relationship_description(v)


class RelationshipUpdate(BaseModel):
    """Schema for updating relationship metadata."""

    description: str | None = None

    @field_validator('description')
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        """Validate description is at most 500 characters."""
        return validate_relationship_description(v)


class RelationshipResponse(BaseModel):
    """Schema for a single relationship response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_type: str
    source_id: UUID
    target_type: str
    target_id: UUID
    relationship_type: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class RelationshipWithContentResponse(RelationshipResponse):
    """Extended response with basic content info for display."""

    source_title: str | None = None
    source_url: str | None = None
    target_title: str | None = None
    target_url: str | None = None
    source_deleted: bool = False
    target_deleted: bool = False
    source_archived: bool = False
    target_archived: bool = False


class RelationshipListResponse(BaseModel):
    """Schema for paginated relationship list responses."""

    items: list[RelationshipWithContentResponse]
    total: int
    offset: int
    limit: int
    has_more: bool
