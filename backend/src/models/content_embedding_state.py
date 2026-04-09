"""ContentEmbeddingState model for tracking per-entity embedding lifecycle."""
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, UUIDv7Mixin

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from models.user import User


class ContentEmbeddingState(Base, UUIDv7Mixin):
    """
    Tracks per-entity embedding lifecycle (one row per entity).

    Enables fast-path skip checks:
    - metadata_hash unchanged → skip metadata chunk re-embedding
    - content_hash unchanged → skip all content chunk processing
    - model matches current → embeddings are compatible
    - All three match → entire job is a no-op

    Status is 'embedded' or 'failed' — transitions atomically in same
    transaction as chunk writes.
    """

    __tablename__ = "content_embedding_state"
    __table_args__ = (
        UniqueConstraint(
            "entity_type", "entity_id",
            name="uq_content_embedding_state_entity",
        ),
        Index("ix_content_embedding_state_user_id", "user_id"),
        Index("ix_content_embedding_state_status", "status"),
        CheckConstraint(
            "status IN ('embedded', 'failed')",
            name="ck_content_embedding_state_status",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    metadata_hash: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="content_embedding_states")
