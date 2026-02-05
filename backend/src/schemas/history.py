"""Pydantic schemas for history endpoints."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class HistoryResponse(BaseModel):
    """Schema for a single history record."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: str
    entity_id: UUID
    action: str
    version: int
    diff_type: str
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
