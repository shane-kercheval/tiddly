"""Pydantic schemas for history endpoints."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.content_history import ActionType, EntityType


class HistoryResponse(BaseModel):
    """Schema for a single history record."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: EntityType
    entity_id: UUID
    action: ActionType
    version: int | None  # None for audit events (lifecycle state transitions)
    metadata_snapshot: dict | None
    source: str
    auth_type: str
    token_prefix: str | None
    created_at: datetime


class HistoryListResponse(BaseModel):
    """Schema for paginated history list responses."""

    items: list[HistoryResponse]
    total: int  # Total count of history records matching the query (before pagination)
    offset: int  # Current pagination offset
    limit: int  # Current pagination limit
    has_more: bool  # True if there are more results beyond this page


class ContentAtVersionResponse(BaseModel):
    """Schema for reconstructed content at a specific version."""

    entity_id: UUID
    version: int
    content: str | None  # None is valid for DELETE actions
    metadata: dict | None  # metadata_snapshot from the history record
    warnings: list[str] | None = None  # Reconstruction warnings if any issues occurred


class RestoreResponse(BaseModel):
    """Schema for restore operation response."""

    message: str
    version: int  # Version that was restored to
    warnings: list[str] | None = None  # Reconstruction warnings if any issues occurred
