"""Tag model for storing user tags."""
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Table,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, UUIDv7Mixin

if TYPE_CHECKING:
    from models.bookmark import Bookmark
    from models.note import Note
    from models.prompt import Prompt
    from models.user import User


# Junction table for many-to-many relationship between bookmarks and tags
bookmark_tags = Table(
    "bookmark_tags",
    Base.metadata,
    Column(
        "bookmark_id",
        PG_UUID(as_uuid=True),
        ForeignKey("bookmarks.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        PG_UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    # Index for lookups by tag (composite PK already indexes bookmark_id first)
    Index("ix_bookmark_tags_tag_id", "tag_id"),
)


# Junction table for many-to-many relationship between notes and tags
note_tags = Table(
    "note_tags",
    Base.metadata,
    Column(
        "note_id",
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        PG_UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    # Index for lookups by tag (composite PK already indexes note_id first)
    Index("ix_note_tags_tag_id", "tag_id"),
)


# Junction table for many-to-many relationship between prompts and tags
prompt_tags = Table(
    "prompt_tags",
    Base.metadata,
    Column(
        "prompt_id",
        PG_UUID(as_uuid=True),
        ForeignKey("prompts.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        PG_UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    # Index for lookups by tag (composite PK already indexes prompt_id first)
    Index("ix_prompt_tags_tag_id", "tag_id"),
)


class Tag(Base, UUIDv7Mixin):
    """Tag model - stores unique tags per user for cross-entity tagging."""

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_tags_user_id_name"),
    )

    # id provided by UUIDv7Mixin
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="tags")
    bookmarks: Mapped[list["Bookmark"]] = relationship(
        secondary=bookmark_tags,
        back_populates="tag_objects",
    )
    notes: Mapped[list["Note"]] = relationship(
        secondary=note_tags,
        back_populates="tag_objects",
    )
    prompts: Mapped[list["Prompt"]] = relationship(
        secondary=prompt_tags,
        back_populates="tag_objects",
    )
