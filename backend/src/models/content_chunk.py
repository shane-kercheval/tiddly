"""ContentChunk model for storing chunked content embeddings."""
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, UUIDv7Mixin

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from models.user import User


class ContentChunk(Base, UUIDv7Mixin):
    """
    Stores chunked content with vector embeddings for semantic search.

    Two chunk types per entity:
    - 'metadata': title + description + name (one per entity, index 0)
    - 'content': one per paragraph (index 0..N)

    Chunks are only inserted with embeddings ready — embedding is NOT NULL.
    """

    __tablename__ = "content_chunks"
    __table_args__ = (
        UniqueConstraint(
            "entity_type", "entity_id", "chunk_type", "chunk_index",
            name="uq_content_chunks_entity_chunk",
        ),
        Index("ix_content_chunks_entity", "entity_type", "entity_id"),
        Index("ix_content_chunks_user_id", "user_id"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    chunk_type: Mapped[str] = mapped_column(String(20), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_hash: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    embedding = mapped_column(Vector(1536), nullable=False)

    user: Mapped["User"] = relationship(back_populates="content_chunks")
