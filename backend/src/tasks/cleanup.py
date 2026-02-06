"""
Scheduled history cleanup task.

This module provides time-based cleanup of history records that exceed
retention limits. Designed to run as a cron job (e.g., daily at 3 AM).

Usage:
    python -m tasks.cleanup

The task:
1. Iterates through all users
2. For each user, applies their tier's retention limits
3. Deletes history records older than retention_days
4. Also cleans up orphaned history (entities that no longer exist)
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.tier_limits import TIER_LIMITS, get_tier_safely
from db.session import async_session_factory
from models.bookmark import Bookmark
from models.content_history import ContentHistory, EntityType
from models.note import Note
from models.prompt import Prompt
from models.user import User

logger = logging.getLogger(__name__)


@dataclass
class CleanupStats:
    """Statistics from a cleanup run."""

    users_processed: int = 0
    expired_deleted: int = 0
    orphaned_deleted: int = 0

    # Detailed breakdowns for verification
    expired_by_user: dict[UUID, int] = field(default_factory=dict)
    orphaned_by_entity_type: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, int]:
        """Convert to simple dict for logging/return."""
        return {
            "users_processed": self.users_processed,
            "expired_deleted": self.expired_deleted,
            "orphaned_deleted": self.orphaned_deleted,
        }


async def cleanup_expired_history(
    db: AsyncSession,
    now: datetime | None = None,
) -> CleanupStats:
    """
    Delete history records older than retention period for all users.

    For each user:
    1. Look up their tier limits
    2. Delete history records older than history_retention_days

    Args:
        db: Database session.
        now: Current time for cutoff calculation. Defaults to datetime.now(UTC).
             Inject a specific time for testing boundary conditions.

    Returns:
        CleanupStats with detailed breakdown.
    """
    if now is None:
        now = datetime.now(UTC)

    stats = CleanupStats()

    # Process users in batches to avoid memory issues
    batch_size = 100
    offset = 0

    while True:
        result = await db.execute(
            select(User.id, User.tier)
            .order_by(User.id)
            .offset(offset)
            .limit(batch_size),
        )
        users = result.all()

        if not users:
            break

        for user_id, tier_str in users:
            tier = get_tier_safely(tier_str)
            limits = TIER_LIMITS[tier]
            cutoff = now - timedelta(days=limits.history_retention_days)

            # Delete old history for this user
            delete_stmt = delete(ContentHistory).where(
                ContentHistory.user_id == user_id,
                ContentHistory.created_at < cutoff,
            )
            result = await db.execute(delete_stmt)
            deleted = result.rowcount

            if deleted > 0:
                stats.expired_by_user[user_id] = deleted
                stats.expired_deleted += deleted
                logger.info(
                    "Cleaned %d expired history records for user %s (tier=%s, cutoff=%s)",
                    deleted,
                    user_id,
                    tier.value,
                    cutoff.isoformat(),
                )

            stats.users_processed += 1

        await db.commit()
        offset += batch_size

    return stats


async def cleanup_orphaned_history(db: AsyncSession) -> CleanupStats:
    """
    Delete history records for entities that no longer exist.

    This handles edge cases where:
    - Entity was permanently deleted but history records remain
    - Entity-history relationship becomes inconsistent

    With entity-anchored reconstruction, orphaned history is useless.

    Note: Soft-deleted entities (deleted_at IS NOT NULL) are NOT considered
    orphaned - their history should be preserved until permanent deletion.

    Returns:
        CleanupStats with orphan breakdown by entity type.
    """
    stats = CleanupStats()

    # Map entity types to their models
    entity_models = {
        EntityType.BOOKMARK.value: Bookmark,
        EntityType.NOTE.value: Note,
        EntityType.PROMPT.value: Prompt,
    }

    for entity_type, model in entity_models.items():
        # Find history records where entity doesn't exist at all
        # (not even soft-deleted). Using NOT EXISTS subquery for efficiency.
        entity_exists_subquery = (
            select(model.id).where(model.id == ContentHistory.entity_id).exists()
        )

        delete_stmt = delete(ContentHistory).where(
            ContentHistory.entity_type == entity_type,
            ~entity_exists_subquery,
        )

        result = await db.execute(delete_stmt)
        deleted = result.rowcount

        if deleted > 0:
            stats.orphaned_by_entity_type[entity_type] = deleted
            stats.orphaned_deleted += deleted
            logger.info(
                "Cleaned %d orphaned history records for entity_type=%s",
                deleted,
                entity_type,
            )

    await db.commit()

    return stats


async def run_cleanup(
    db: AsyncSession | None = None,
    now: datetime | None = None,
) -> CleanupStats:
    """
    Run all cleanup tasks.

    Args:
        db: Database session. If None, creates one from async_session_factory.
        now: Current time for cutoff calculation. Defaults to datetime.now(UTC).

    Returns:
        Combined CleanupStats from all cleanup operations.
    """
    logger.info("Starting history cleanup task")

    async def _run(session: AsyncSession) -> CleanupStats:
        # Time-based cleanup
        expired_stats = await cleanup_expired_history(session, now=now)

        # Orphan cleanup
        orphan_stats = await cleanup_orphaned_history(session)

        # Combine stats
        return CleanupStats(
            users_processed=expired_stats.users_processed,
            expired_deleted=expired_stats.expired_deleted,
            orphaned_deleted=orphan_stats.orphaned_deleted,
            expired_by_user=expired_stats.expired_by_user,
            orphaned_by_entity_type=orphan_stats.orphaned_by_entity_type,
        )

    if db is not None:
        stats = await _run(db)
    else:
        async with async_session_factory() as session:
            stats = await _run(session)

    logger.info("History cleanup complete: %s", stats.to_dict())
    return stats


def main() -> None:
    """Entry point for running cleanup as a script."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    asyncio.run(run_cleanup())


if __name__ == "__main__":
    main()
