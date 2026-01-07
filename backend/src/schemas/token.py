"""Pydantic schemas for API token endpoints."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TokenCreate(BaseModel):
    """Schema for creating a new API token."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="User-provided name for the token, e.g., 'CLI', 'MCP Server'",
    )
    expires_in_days: int | None = Field(
        default=None,
        ge=1,
        le=365,
        description="Optional expiration in days (1-365). None means no expiration.",
    )


class TokenCreateResponse(BaseModel):
    """
    Response when creating a new token.

    IMPORTANT: The `token` field contains the plaintext token and is only shown
    once at creation time. It cannot be retrieved again.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    token: str = Field(
        ...,
        description="The plaintext token. Store this securely - it won't be shown again.",
    )
    token_prefix: str
    expires_at: datetime | None
    created_at: datetime


class TokenResponse(BaseModel):
    """
    Schema for token list responses.

    Does NOT include the plaintext token - only metadata for identification.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    token_prefix: str
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
