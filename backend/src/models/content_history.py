"""ContentHistory model for tracking changes to bookmarks, notes, and prompts."""
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, UUIDv7Mixin

if TYPE_CHECKING:
    from models.user import User


class ActionType(StrEnum):
    """Type of action that was performed on the entity."""

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    RESTORE = "restore"
    ARCHIVE = "archive"
    UNARCHIVE = "unarchive"


class EntityType(StrEnum):
    """Type of entity that the history record applies to."""

    BOOKMARK = "bookmark"
    NOTE = "note"
    PROMPT = "prompt"


class DiffType(StrEnum):
    """
    Describes how content is stored in a history record.

    Uses dual-storage for SNAPSHOTs:
    - content_snapshot: Full content at this version (for starting reconstruction)
    - content_diff: Diff to previous version (for chain traversal)

    Note: metadata_snapshot is ALWAYS stored as a full snapshot in every record.
    """

    SNAPSHOT = "snapshot"  # Full content + diff (or None for CREATE/DELETE)
    DIFF = "diff"  # content_diff only (diff-match-patch delta)
    METADATA = "metadata"  # No content stored (content unchanged)


class ContentHistory(Base, UUIDv7Mixin):
    """
    Unified history table for tracking changes to bookmarks, notes, and prompts.

    Uses reverse diffs: each diff record stores how to transform the current
    version's content into the previous version's content (going backwards in time).

    Dual storage columns:
    - content_snapshot: Full content at this version (SNAPSHOTs only)
    - content_diff: Reverse diff to previous version (for chain traversal)
    - metadata_snapshot: JSONB of non-content fields - always stored as full snapshot
    """

    __tablename__ = "content_history"

    # User who owns this history record (for multi-tenant isolation)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Entity reference (polymorphic - no DB FK constraint)
    # History is deleted via application-level cascade when entity is hard-deleted
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Action that was performed
    action: Mapped[str] = mapped_column(String(20), nullable=False)

    # Version tracking (sequential per entity, starts at 1)
    version: Mapped[int] = mapped_column(nullable=False)
    diff_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Dual storage for content (see DiffType enum for what each type stores):
    # - content_snapshot: Full content at this version (SNAPSHOTs only)
    # - content_diff: Reverse diff to previous version (for chain traversal)
    content_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_diff: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metadata is always stored as full snapshot (tags, title, description, etc.)
    metadata_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Source tracking (who/what initiated this change)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    auth_type: Mapped[str] = mapped_column(String(10), nullable=False)
    # Token prefix for PAT audit trail (e.g., "bm_a3f8...") - safe to display/log
    token_prefix: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Timestamp (only created_at - history records are immutable)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="content_history")

    __table_args__ = (
        # Unique constraint prevents duplicate versions from race conditions
        UniqueConstraint(
            "user_id",
            "entity_type",
            "entity_id",
            "version",
            name="uq_content_history_version",
        ),
        # Primary query: user's history for an entity (sorted by version)
        Index(
            "ix_content_history_user_entity",
            "user_id",
            "entity_type",
            "entity_id",
            "version",
        ),
        # All user's recent activity (for activity feed)
        Index("ix_content_history_user_created", "user_id", "created_at"),
        # Retention cleanup (delete old records)
        Index("ix_content_history_created", "created_at"),
        # Snapshot lookup index (partial index, low storage cost)
        # Useful for: finding nearest snapshot for reconstruction optimization,
        # analytics/debugging queries, potential error recovery.
        Index(
            "ix_content_history_snapshots",
            "user_id",
            "entity_type",
            "entity_id",
            "version",
            postgresql_where=text("diff_type = 'snapshot'"),
        ),
    )
