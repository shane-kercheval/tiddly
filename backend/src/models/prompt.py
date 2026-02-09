"""Prompt model for storing user prompt templates."""
from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import ArchivableMixin, Base, TimestampMixin, UUIDv7Mixin
from models.tag import prompt_tags

if TYPE_CHECKING:
    from models.tag import Tag
    from models.user import User


class Prompt(Base, UUIDv7Mixin, TimestampMixin, ArchivableMixin):
    """Prompt model - stores user prompt templates with Jinja2 content and tags."""

    __tablename__ = "prompts"
    __table_args__ = (
        # Partial unique index: name must be unique per user for active (non-deleted) prompts
        Index(
            "uq_prompt_user_name_active",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    # id provided by UUIDv7Mixin
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Arguments for Jinja2 template variables.
    # Note: Python-side default is handled by the Pydantic schema (PromptCreate).
    # The server_default ensures database-level default for direct inserts.
    arguments: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        server_default="[]",
    )

    # Usage tracking timestamp (defaults to current time on creation)
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        server_default=func.clock_timestamp(),
    )

    # deleted_at and archived_at provided by ArchivableMixin

    user: Mapped["User"] = relationship(back_populates="prompts")
    tag_objects: Mapped[list["Tag"]] = relationship(
        secondary=prompt_tags,
        back_populates="prompts",
    )
