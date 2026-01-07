"""API Token model for Personal Access Tokens (PATs)."""
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UUIDv7Mixin

if TYPE_CHECKING:
    from models.user import User


class ApiToken(Base, UUIDv7Mixin, TimestampMixin):
    """
    API Token model for programmatic access (CLI, MCP, scripts).

    Tokens are stored hashed - plaintext is only shown once at creation.
    The token_prefix allows identification without exposing the full token.
    """

    __tablename__ = "api_tokens"

    # id provided by UUIDv7Mixin
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(100),
        comment="User-provided name, e.g., 'CLI', 'MCP Server'",
    )
    token_hash: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        comment="SHA-256 hash of the token",
    )
    token_prefix: Mapped[str] = mapped_column(
        String(12),
        comment="First 12 chars for identification, e.g., 'bm_abc12345'",
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Optional expiration date",
    )

    user: Mapped["User"] = relationship(back_populates="api_tokens")
