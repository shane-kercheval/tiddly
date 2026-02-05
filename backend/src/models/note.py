"""Note model for storing user notes with markdown content."""
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import ArchivableMixin, Base, TimestampMixin, UUIDv7Mixin
from models.tag import note_tags

if TYPE_CHECKING:
    from models.tag import Tag
    from models.user import User


class Note(Base, UUIDv7Mixin, TimestampMixin, ArchivableMixin):
    """Note model - stores user notes with markdown content and tags."""

    __tablename__ = "notes"

    # id provided by UUIDv7Mixin
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)  # Required
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)  # Markdown, up to 2MB

    # Usage tracking timestamp (defaults to current time on creation)
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        server_default=func.clock_timestamp(),
    )

    # deleted_at and archived_at provided by ArchivableMixin

    user: Mapped["User"] = relationship(back_populates="notes")
    tag_objects: Mapped[list["Tag"]] = relationship(
        secondary=note_tags,
        back_populates="notes",
    )
