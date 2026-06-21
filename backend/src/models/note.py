"""Note model for storing user notes with markdown content."""
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import ArchivableMixin, Base, TimestampMixin, UUIDv7Mixin
from models.tag import note_tags

if TYPE_CHECKING:
    from models.tag import Tag
    from models.user import User


class Note(Base, UUIDv7Mixin, TimestampMixin, ArchivableMixin):
    """Note model - stores user notes with markdown content and tags."""

    __tablename__ = "notes"
    __table_args__ = (
        # Partial unique index: a published item's share token is unique within
        # the table; unpublished items (token IS NULL) are exempt and may be many.
        # This is the sole index for public_token lookups (the only access path is
        # `public_token == token`, always non-NULL) — no separate plain index.
        # The predicate intentionally omits `deleted_at IS NULL`: a soft-deleted
        # row keeps its (random, unguessable) token claimed only until the 30-day
        # cleanup cron hard-deletes it. Revisit only if user-chosen vanity slugs
        # are ever added (then add `AND deleted_at IS NULL` to free names on trash).
        Index(
            "uq_note_public_token",
            "public_token",
            unique=True,
            postgresql_where=text("public_token IS NOT NULL"),
        ),
        # A published item must always have a token (else it has no usable URL).
        CheckConstraint(
            "NOT is_public OR public_token IS NOT NULL",
            name="ck_note_public_requires_token",
        ),
    )

    # id provided by UUIDv7Mixin
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)  # Required
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)  # Markdown, up to 2MB

    # Public sharing. is_public toggles the share on/off; public_token is the
    # stable, unguessable plaintext URL component, generated on first publish and
    # changed only by an explicit rotate. See uq_note_public_token above.
    is_public: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    public_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Stamped with the publish time on each publish, left in place on unpublish.
    # Powers the owner's "Shared content" view. Writing it does NOT bump
    # updated_at — sharing is not a content change.
    shared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    # Trigger-maintained tsvector for full-text search (see migration for trigger definition)
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR, nullable=True, default=None, deferred=True,
    )

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
