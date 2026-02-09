"""SQLAlchemy declarative base with common mixins."""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import DateTime, and_, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql.elements import BinaryExpression
from uuid6 import uuid7


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""

    pass


class UUIDv7Mixin:
    """
    Mixin that provides a UUIDv7 primary key.

    UUIDv7 is time-sortable (embeds Unix timestamp) and globally unique.
    Uses native PostgreSQL uuid type for efficient storage and indexing.
    """

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid7,
    )


class TimestampMixin:
    """
    Mixin that adds created_at and updated_at columns.

    All timestamps are timezone-aware (stored as TIMESTAMP WITH TIME ZONE in PostgreSQL).

    Uses clock_timestamp() instead of now() to get actual wall-clock time rather than
    transaction start time. This ensures accurate timestamps when multiple operations
    occur within the same database transaction.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        nullable=False,
        index=True,  # Index for "sort by recently updated" queries
    )


class ArchivableMixin:
    """
    Mixin that adds soft-delete and archive functionality.

    Provides:
    - deleted_at: Timestamp for soft deletion (NULL = not deleted)
    - archived_at: Timestamp for archiving (NULL = not archived, future = scheduled)
    - is_archived: Hybrid property that checks if currently archived

    The is_archived property handles scheduled archiving:
    - Returns False if archived_at is NULL or in the future
    - Returns True if archived_at is in the past or present
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        index=True,
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        index=True,
    )

    @hybrid_property
    def is_archived(self) -> bool:
        """
        Check if entity is currently archived (past or present archived_at).

        Returns False if:
        - archived_at is None (not scheduled for archive)
        - archived_at is in the future (scheduled but not yet archived)

        Returns True if:
        - archived_at is in the past or present (currently archived)
        """
        if self.archived_at is None:
            return False
        # Handle both timezone-aware and naive datetimes
        now = datetime.now(UTC)
        archived_at = self.archived_at
        if archived_at.tzinfo is None:
            archived_at = archived_at.replace(tzinfo=UTC)
        return archived_at <= now

    @is_archived.expression
    def is_archived(cls) -> BinaryExpression:  # noqa: N805
        """SQL expression for archived check - used in queries."""
        return and_(
            cls.archived_at.is_not(None),
            cls.archived_at <= func.now(),
        )
