"""ContentRelationship model for linking content items (bookmarks, notes, prompts)."""
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin, UUIDv7Mixin


class ContentRelationship(Base, UUIDv7Mixin, TimestampMixin):
    """
    Polymorphic relationship between any two content items.

    For bidirectional types (e.g., 'related'), source/target are normalized
    to canonical order at insert time so the unique constraint prevents
    both A->B and B->A from being stored.
    """

    __tablename__ = "content_relationships"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    # Source content (polymorphic — no FK to entity tables)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[UUID] = mapped_column(nullable=False)

    # Target content (polymorphic — no FK to entity tables)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[UUID] = mapped_column(nullable=False)

    # Relationship metadata
    relationship_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # Prevent duplicate relationships.
        # For bidirectional types (e.g., 'related'), the service layer normalizes
        # source/target to canonical order before insert, so this constraint
        # naturally prevents both A->B and B->A from being stored.
        UniqueConstraint(
            'user_id', 'source_type', 'source_id',
            'target_type', 'target_id', 'relationship_type',
            name='uq_content_relationship',
        ),
        # Validate content types (add 'todo' when implementing todos)
        CheckConstraint(
            "source_type IN ('bookmark', 'note', 'prompt')",
            name='ck_source_type',
        ),
        CheckConstraint(
            "target_type IN ('bookmark', 'note', 'prompt')",
            name='ck_target_type',
        ),
        # Validate relationship types (add 'references', 'subtask', 'blocks' later)
        CheckConstraint(
            "relationship_type IN ('related')",
            name='ck_relationship_type',
        ),
        # Prevent self-references
        CheckConstraint(
            "NOT (source_type = target_type AND source_id = target_id)",
            name='ck_no_self_reference',
        ),
        # Indexes for common queries
        Index('ix_content_rel_source', 'user_id', 'source_type', 'source_id'),
        Index('ix_content_rel_target', 'user_id', 'target_type', 'target_id'),
    )
