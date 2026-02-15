"""
Orphan relationship detection and cleanup.

Detects content_relationships rows where the source or target entity no longer
exists in the database. This can happen if cleanup in BaseEntityService.delete()
fails to remove all associated relationships (e.g., race condition, bug).

Usage:
    python -m tasks.orphan_relationships           # Report only (default)
    python -m tasks.orphan_relationships --delete   # Report and delete orphans
"""
import argparse
import asyncio
import logging
from dataclasses import dataclass, field

from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.session import async_session_factory
from models.content_relationship import ContentRelationship
from services.relationship_service import MODEL_MAP

logger = logging.getLogger(__name__)


@dataclass
class OrphanStats:
    """Statistics from an orphan relationship cleanup run."""

    orphaned_source: int = 0
    orphaned_target: int = 0
    total_deleted: int = 0
    by_content_type: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, int]:
        """Convert to simple dict for logging/return."""
        return {
            "orphaned_source": self.orphaned_source,
            "orphaned_target": self.orphaned_target,
            "total_deleted": self.total_deleted,
        }


async def find_orphaned_relationships(db: AsyncSession) -> list[ContentRelationship]:
    """
    Find relationships where source or target entity no longer exists.

    Uses NOT EXISTS subqueries per content type to find relationship rows
    pointing to non-existent entities. Soft-deleted entities still exist
    in the database, so they are NOT considered orphaned.

    A relationship orphaned on both sides is returned once (deduplicated).

    Returns:
        Deduplicated list of orphaned ContentRelationship objects.
    """
    orphan_ids: set = set()
    all_orphans: list[ContentRelationship] = []

    for content_type, model in MODEL_MAP.items():
        # Source orphans: source entity doesn't exist for this user
        source_exists = select(model.id).where(
            model.id == ContentRelationship.source_id,
            model.user_id == ContentRelationship.user_id,
        ).exists()
        source_stmt = select(ContentRelationship).where(
            ContentRelationship.source_type == content_type,
            ~source_exists,
        )
        result = await db.execute(source_stmt)
        for rel in result.scalars().all():
            if rel.id not in orphan_ids:
                orphan_ids.add(rel.id)
                all_orphans.append(rel)

        # Target orphans: target entity doesn't exist for this user
        target_exists = select(model.id).where(
            model.id == ContentRelationship.target_id,
            model.user_id == ContentRelationship.user_id,
        ).exists()
        target_stmt = select(ContentRelationship).where(
            ContentRelationship.target_type == content_type,
            ~target_exists,
        )
        result = await db.execute(target_stmt)
        for rel in result.scalars().all():
            if rel.id not in orphan_ids:
                orphan_ids.add(rel.id)
                all_orphans.append(rel)

    return all_orphans


async def cleanup_orphaned_relationships(
    db: AsyncSession,
    delete: bool = False,
) -> OrphanStats:
    """
    Find and optionally delete orphaned relationships.

    Uses bulk DELETE/COUNT statements per content type per side, following
    the same NOT EXISTS pattern as cleanup_orphaned_history in cleanup.py.

    In delete mode, total_deleted accurately reflects actual rows removed.
    There is no double-counting because already-deleted rows are not found
    by subsequent queries within the same transaction.

    In report mode, orphaned_source + orphaned_target may exceed the unique
    orphan count if a relationship has both sides missing (counted per side).

    Args:
        db: Database session.
        delete: If True, delete orphaned relationships. If False (default),
                only report them.

    Returns:
        OrphanStats with breakdown of orphans found/deleted.
    """
    stats = OrphanStats()

    for content_type, model in MODEL_MAP.items():
        # Source orphans: source entity of this type doesn't exist for this user
        source_exists = select(model.id).where(
            model.id == ContentRelationship.source_id,
            model.user_id == ContentRelationship.user_id,
        ).exists()

        if delete:
            result = await db.execute(
                sa_delete(ContentRelationship).where(
                    ContentRelationship.source_type == content_type,
                    ~source_exists,
                ),
            )
            source_count = result.rowcount
        else:
            source_count = await db.scalar(
                select(func.count(ContentRelationship.id)).where(
                    ContentRelationship.source_type == content_type,
                    ~source_exists,
                ),
            ) or 0

        if source_count > 0:
            stats.orphaned_source += source_count
            stats.by_content_type[content_type] = (
                stats.by_content_type.get(content_type, 0) + source_count
            )
            logger.info(
                "%s %d orphaned relationships with missing source "
                "content_type=%s",
                "Deleted" if delete else "Found",
                source_count,
                content_type,
            )

        # Target orphans: target entity of this type doesn't exist for this user
        target_exists = select(model.id).where(
            model.id == ContentRelationship.target_id,
            model.user_id == ContentRelationship.user_id,
        ).exists()

        if delete:
            result = await db.execute(
                sa_delete(ContentRelationship).where(
                    ContentRelationship.target_type == content_type,
                    ~target_exists,
                ),
            )
            target_count = result.rowcount
        else:
            target_count = await db.scalar(
                select(func.count(ContentRelationship.id)).where(
                    ContentRelationship.target_type == content_type,
                    ~target_exists,
                ),
            ) or 0

        if target_count > 0:
            stats.orphaned_target += target_count
            stats.by_content_type[content_type] = (
                stats.by_content_type.get(content_type, 0) + target_count
            )
            logger.info(
                "%s %d orphaned relationships with missing target "
                "content_type=%s",
                "Deleted" if delete else "Found",
                target_count,
                content_type,
            )

    stats.total_deleted = stats.orphaned_source + stats.orphaned_target if delete else 0

    if delete:
        await db.commit()

    return stats


async def run_orphan_cleanup(
    db: AsyncSession | None = None,
    delete: bool = False,
) -> OrphanStats:
    """
    Entry point for orphan relationship cleanup.

    Args:
        db: Database session. If None, creates one from async_session_factory.
        delete: If True, delete orphaned relationships.

    Returns:
        OrphanStats with results.
    """
    logger.info("Starting orphan relationship cleanup (delete=%s)", delete)

    async def _run(session: AsyncSession) -> OrphanStats:
        return await cleanup_orphaned_relationships(session, delete=delete)

    if db is not None:
        stats = await _run(db)
    else:
        async with async_session_factory() as session:
            stats = await _run(session)

    logger.info("Orphan relationship cleanup complete: %s", stats.to_dict())
    return stats


def main() -> None:
    """CLI entry point with --delete flag."""
    parser = argparse.ArgumentParser(
        description="Detect and optionally remove orphaned content relationships.",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Delete orphaned relationships (default: report only)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    asyncio.run(run_orphan_cleanup(delete=args.delete))


if __name__ == "__main__":
    main()
