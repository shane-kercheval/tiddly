"""
Comprehensive tests for the history cleanup task.

These tests verify the cleanup logic handles all edge cases correctly
since this is critical code that deletes production user data.
"""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import AuthType, RequestSource
from core.tier_limits import TIER_LIMITS, Tier
from models.bookmark import Bookmark
from models.content_history import ActionType, ContentHistory, DiffType, EntityType
from models.note import Note
from models.user import User
from tasks.cleanup import (
    CleanupStats,
    cleanup_expired_history,
    cleanup_orphaned_history,
    run_cleanup,
)


# Get retention days from actual config for accurate boundary testing
FREE_RETENTION_DAYS = TIER_LIMITS[Tier.FREE].history_retention_days


def create_history_record(
    user_id,
    entity_type: EntityType,
    entity_id,
    version: int = 1,
    created_at: datetime | None = None,
) -> ContentHistory:
    """Helper to create a ContentHistory record with minimal required fields."""
    return ContentHistory(
        user_id=user_id,
        entity_type=entity_type.value,
        entity_id=entity_id,
        action=ActionType.CREATE.value,
        version=version,
        diff_type=DiffType.SNAPSHOT.value,
        content_snapshot=f"Content v{version}",
        metadata_snapshot={"title": f"Test v{version}"},
        source=RequestSource.WEB.value,
        auth_type=AuthType.AUTH0.value,
        created_at=created_at,
    )


async def count_history_records(db: AsyncSession, user_id=None) -> int:
    """Count history records, optionally filtered by user."""
    stmt = select(func.count()).select_from(ContentHistory)
    if user_id:
        stmt = stmt.where(ContentHistory.user_id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one()


class TestCleanupExpiredHistoryBoundaryConditions:
    """
    Test precise boundary conditions for time-based cleanup.

    With retention_days=30:
    - Day 29: KEEP (within retention window)
    - Day 30: KEEP (exactly at boundary, created_at < cutoff means strictly less than)
    - Day 31: DELETE (outside retention window)
    """

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-boundary-{uuid4()}",
            email=f"boundary-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__day_29__record_is_kept(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Record created 29 days ago should be kept (inside retention window)."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record 29 days ago
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=now - timedelta(days=29),
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record was NOT deleted
        assert stats.expired_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__day_30_exactly__record_is_kept(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """
        Record created exactly 30 days ago should be kept.

        The cutoff is `now - 30 days`, and we delete where `created_at < cutoff`.
        A record created exactly at cutoff (created_at == cutoff) is NOT deleted.
        """
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record exactly 30 days ago
        exactly_30_days = now - timedelta(days=FREE_RETENTION_DAYS)
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=exactly_30_days,
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record was NOT deleted (exactly at boundary is kept)
        assert stats.expired_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__day_30_plus_1_second__record_is_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Record created 30 days + 1 second ago should be deleted."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record 30 days + 1 second ago
        just_past_cutoff = now - timedelta(days=FREE_RETENTION_DAYS, seconds=1)
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=just_past_cutoff,
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record WAS deleted
        assert stats.expired_deleted == 1
        assert stats.expired_by_user[user.id] == 1
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__day_31__record_is_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Record created 31 days ago should be deleted (clearly outside window)."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record 31 days ago
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=now - timedelta(days=31),
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record WAS deleted
        assert stats.expired_deleted == 1
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__mixed_ages__only_old_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """With mixed record ages, only records past retention are deleted."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create records at various ages
        ages_and_expected = [
            (1, True),     # 1 day ago - keep
            (15, True),    # 15 days ago - keep
            (29, True),    # 29 days ago - keep
            (30, True),    # 30 days ago - keep (exactly at boundary)
            (31, False),   # 31 days ago - delete
            (60, False),   # 60 days ago - delete
            (365, False),  # 365 days ago - delete
        ]

        for version, (days_ago, should_keep) in enumerate(ages_and_expected, 1):
            record = create_history_record(
                user_id=user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                version=version,
                created_at=now - timedelta(days=days_ago),
            )
            db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify: 3 deleted (days 31, 60, 365), 4 kept
        assert stats.expired_deleted == 3
        assert await count_history_records(db_session, user.id) == 4


class TestCleanupExpiredHistoryMultiUser:
    """Test cleanup behavior with multiple users."""

    @pytest.mark.asyncio
    async def test__multiple_users__each_processed_independently(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Each user's history is processed independently."""
        now = datetime.now(UTC)

        # Create 3 users
        users = []
        for i in range(3):
            user = User(
                auth0_id=f"test-multi-{uuid4()}",
                email=f"multi-{uuid4()}@test.com",
                tier=Tier.FREE.value,
            )
            db_session.add(user)
            users.append(user)
        await db_session.commit()
        for user in users:
            await db_session.refresh(user)

        # User 0: 2 old records (delete both)
        # User 1: 1 old, 1 new record (delete 1)
        # User 2: 2 new records (delete none)
        entity_ids = [uuid4() for _ in range(3)]

        # User 0: all old
        for v in [1, 2]:
            db_session.add(create_history_record(
                user_id=users[0].id,
                entity_type=EntityType.NOTE,
                entity_id=entity_ids[0],
                version=v,
                created_at=now - timedelta(days=60),
            ))

        # User 1: mixed
        db_session.add(create_history_record(
            user_id=users[1].id,
            entity_type=EntityType.NOTE,
            entity_id=entity_ids[1],
            version=1,
            created_at=now - timedelta(days=60),  # old - delete
        ))
        db_session.add(create_history_record(
            user_id=users[1].id,
            entity_type=EntityType.NOTE,
            entity_id=entity_ids[1],
            version=2,
            created_at=now - timedelta(days=5),  # new - keep
        ))

        # User 2: all new
        for v in [1, 2]:
            db_session.add(create_history_record(
                user_id=users[2].id,
                entity_type=EntityType.NOTE,
                entity_id=entity_ids[2],
                version=v,
                created_at=now - timedelta(days=5),
            ))

        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify totals
        assert stats.users_processed == 3
        assert stats.expired_deleted == 3  # 2 from user0 + 1 from user1

        # Verify per-user breakdown
        assert stats.expired_by_user[users[0].id] == 2
        assert stats.expired_by_user[users[1].id] == 1
        assert users[2].id not in stats.expired_by_user  # No deletions

        # Verify remaining records
        assert await count_history_records(db_session, users[0].id) == 0
        assert await count_history_records(db_session, users[1].id) == 1
        assert await count_history_records(db_session, users[2].id) == 2

    @pytest.mark.asyncio
    async def test__user_with_no_history__processes_without_error(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Users with no history records are processed without error."""
        # Create user with no history
        user = User(
            auth0_id=f"test-empty-{uuid4()}",
            email=f"empty-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=datetime.now(UTC))

        # User was processed, nothing deleted
        assert stats.users_processed >= 1
        assert user.id not in stats.expired_by_user


class TestCleanupExpiredHistoryBatchProcessing:
    """Test batch processing with more than 100 users."""

    @pytest.mark.asyncio
    async def test__more_than_100_users__all_processed(
        self,
        db_session: AsyncSession,
    ) -> None:
        """
        With >100 users, batch processing handles all users correctly.

        The cleanup processes users in batches of 100 to avoid memory issues.
        This test verifies all users are processed across multiple batches.
        """
        now = datetime.now(UTC)
        num_users = 150  # More than one batch (100)

        # Create users with one old record each
        user_ids = []
        for i in range(num_users):
            user = User(
                auth0_id=f"test-batch-{uuid4()}",
                email=f"batch-{uuid4()}@test.com",
                tier=Tier.FREE.value,
            )
            db_session.add(user)
            await db_session.flush()
            user_ids.append(user.id)

            # Each user has one old record
            db_session.add(create_history_record(
                user_id=user.id,
                entity_type=EntityType.NOTE,
                entity_id=uuid4(),
                created_at=now - timedelta(days=60),
            ))

        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # All users processed, all records deleted
        assert stats.users_processed == num_users
        assert stats.expired_deleted == num_users
        assert len(stats.expired_by_user) == num_users


class TestCleanupExpiredHistoryEntityTypes:
    """Test cleanup handles all entity types correctly."""

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-entity-{uuid4()}",
            email=f"entity-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__all_entity_types__cleaned_correctly(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Cleanup applies to bookmark, note, and prompt history equally."""
        now = datetime.now(UTC)

        # Create old records for each entity type
        for entity_type in [EntityType.BOOKMARK, EntityType.NOTE, EntityType.PROMPT]:
            db_session.add(create_history_record(
                user_id=user.id,
                entity_type=entity_type,
                entity_id=uuid4(),
                created_at=now - timedelta(days=60),
            ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # All 3 records deleted
        assert stats.expired_deleted == 3
        assert await count_history_records(db_session, user.id) == 0


class TestCleanupOrphanedHistory:
    """Test orphaned history cleanup."""

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-orphan-{uuid4()}",
            email=f"orphan-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__orphaned_bookmark_history__deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for non-existent bookmark is deleted."""
        # Create orphaned history (no corresponding bookmark)
        orphan_id = uuid4()
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=orphan_id,
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # Orphan deleted
        assert stats.orphaned_deleted == 1
        assert stats.orphaned_by_entity_type[EntityType.BOOKMARK.value] == 1
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__orphaned_note_history__deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for non-existent note is deleted."""
        orphan_id = uuid4()
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=orphan_id,
        ))
        await db_session.commit()

        stats = await cleanup_orphaned_history(db_session)

        assert stats.orphaned_deleted == 1
        assert stats.orphaned_by_entity_type[EntityType.NOTE.value] == 1

    @pytest.mark.asyncio
    async def test__orphaned_prompt_history__deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for non-existent prompt is deleted."""
        orphan_id = uuid4()
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.PROMPT,
            entity_id=orphan_id,
        ))
        await db_session.commit()

        stats = await cleanup_orphaned_history(db_session)

        assert stats.orphaned_deleted == 1
        assert stats.orphaned_by_entity_type[EntityType.PROMPT.value] == 1

    @pytest.mark.asyncio
    async def test__existing_entity_history__not_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for existing entity is NOT deleted."""
        # Create a real note
        note = Note(
            user_id=user.id,
            title="Real Note",
            content="Real content",
        )
        db_session.add(note)
        await db_session.flush()

        # Create history for the real note
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # Nothing deleted - entity exists
        assert stats.orphaned_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__soft_deleted_entity_history__not_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """
        History for soft-deleted entity is NOT deleted.

        Soft-deleted entities still exist in the database (deleted_at IS NOT NULL).
        Their history should be preserved until permanent deletion.
        """
        # Create a note and soft-delete it
        note = Note(
            user_id=user.id,
            title="Soft Deleted Note",
            content="Will be soft deleted",
        )
        db_session.add(note)
        await db_session.flush()

        # Create history for the note
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))

        # Soft delete the note
        note.deleted_at = datetime.now(UTC)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # Nothing deleted - soft-deleted entity still exists in DB
        assert stats.orphaned_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__mixed_orphaned_and_valid__only_orphans_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """With mixed records, only orphaned history is deleted."""
        # Create real entities
        note = Note(user_id=user.id, title="Real", content="Content")
        bookmark = Bookmark(user_id=user.id, url="https://example.com")
        db_session.add(note)
        db_session.add(bookmark)
        await db_session.flush()

        # Create history for real entities
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=bookmark.id,
        ))

        # Create orphaned history
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=uuid4(),  # Non-existent
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.PROMPT,
            entity_id=uuid4(),  # Non-existent
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # 2 orphans deleted, 2 valid kept
        assert stats.orphaned_deleted == 2
        assert await count_history_records(db_session, user.id) == 2

    @pytest.mark.asyncio
    async def test__no_orphans__nothing_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """When there are no orphans, nothing is deleted."""
        # Create real note with history
        note = Note(user_id=user.id, title="Real", content="Content")
        db_session.add(note)
        await db_session.flush()

        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        assert stats.orphaned_deleted == 0
        assert len(stats.orphaned_by_entity_type) == 0


class TestCleanupEmptyScenarios:
    """Test cleanup handles empty scenarios correctly."""

    @pytest.mark.asyncio
    async def test__no_users__completes_without_error(
        self,
        db_session: AsyncSession,
    ) -> None:
        """
        Cleanup completes successfully when there are no users.

        Note: In practice there will always be users, but the code should
        handle empty tables gracefully.
        """
        # Delete all users for this test
        # (Not recommended in shared test DB, but tests are isolated via transactions)

        # Run cleanup on empty-ish database
        stats = await cleanup_expired_history(db_session, now=datetime.now(UTC))

        # Should complete without error
        assert stats.expired_deleted == 0

    @pytest.mark.asyncio
    async def test__no_history_records__completes_without_error(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Cleanup completes successfully when there's no history."""
        # Create user but no history
        user = User(
            auth0_id=f"test-nohistory-{uuid4()}",
            email=f"nohistory-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()

        # Run both cleanups
        expired_stats = await cleanup_expired_history(db_session, now=datetime.now(UTC))
        orphan_stats = await cleanup_orphaned_history(db_session)

        assert expired_stats.expired_deleted == 0
        assert orphan_stats.orphaned_deleted == 0


class TestRunCleanupIntegration:
    """Integration tests for the full cleanup flow."""

    @pytest.mark.asyncio
    async def test__run_cleanup__combines_expired_and_orphan_cleanup(
        self,
        db_session: AsyncSession,
    ) -> None:
        """run_cleanup executes both cleanup types and combines stats."""
        now = datetime.now(UTC)

        # Create user
        user = User(
            auth0_id=f"test-integration-{uuid4()}",
            email=f"integration-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.flush()

        # Create real note
        note = Note(user_id=user.id, title="Real", content="Content")
        db_session.add(note)
        await db_session.flush()

        # Create: 1 old record (expired), 1 new record (keep), 1 orphan
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
            version=1,
            created_at=now - timedelta(days=60),  # Old - delete
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
            version=2,
            created_at=now - timedelta(days=5),  # New - keep
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=uuid4(),  # Orphan - delete
        ))
        await db_session.commit()

        # Run full cleanup
        stats = await run_cleanup(db=db_session, now=now)

        # Verify combined results
        assert stats.users_processed >= 1
        assert stats.expired_deleted == 1  # One old record
        assert stats.orphaned_deleted == 1  # One orphan

        # Only the new, valid record remains
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__run_cleanup__stats_breakdown_is_accurate(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Verify detailed breakdown in stats matches actual deletions."""
        now = datetime.now(UTC)

        # Create 2 users
        users = []
        for i in range(2):
            user = User(
                auth0_id=f"test-breakdown-{uuid4()}",
                email=f"breakdown-{uuid4()}@test.com",
                tier=Tier.FREE.value,
            )
            db_session.add(user)
            users.append(user)
        await db_session.flush()

        # User 0: 3 old records
        for v in range(1, 4):
            db_session.add(create_history_record(
                user_id=users[0].id,
                entity_type=EntityType.NOTE,
                entity_id=uuid4(),
                version=v,
                created_at=now - timedelta(days=60),
            ))

        # User 1: 2 old records
        for v in range(1, 3):
            db_session.add(create_history_record(
                user_id=users[1].id,
                entity_type=EntityType.BOOKMARK,
                entity_id=uuid4(),
                version=v,
                created_at=now - timedelta(days=60),
            ))

        # Add orphans of different types
        db_session.add(create_history_record(
            user_id=users[0].id,
            entity_type=EntityType.PROMPT,
            entity_id=uuid4(),
        ))
        db_session.add(create_history_record(
            user_id=users[0].id,
            entity_type=EntityType.PROMPT,
            entity_id=uuid4(),
        ))
        await db_session.commit()

        # Run full cleanup
        stats = await run_cleanup(db=db_session, now=now)

        # Verify expired breakdown
        assert stats.expired_by_user[users[0].id] == 3
        assert stats.expired_by_user[users[1].id] == 2
        assert stats.expired_deleted == 5

        # Verify orphan breakdown
        assert stats.orphaned_by_entity_type[EntityType.PROMPT.value] == 2
        assert stats.orphaned_deleted == 2


class TestCleanupStatsDataclass:
    """Tests for the CleanupStats dataclass."""

    def test__to_dict__returns_summary(self) -> None:
        """to_dict returns a simple summary dict."""
        stats = CleanupStats(
            users_processed=10,
            expired_deleted=5,
            orphaned_deleted=3,
            expired_by_user={uuid4(): 2, uuid4(): 3},
            orphaned_by_entity_type={"note": 2, "bookmark": 1},
        )

        result = stats.to_dict()

        assert result == {
            "users_processed": 10,
            "expired_deleted": 5,
            "orphaned_deleted": 3,
        }
        # Detailed breakdowns not in summary
        assert "expired_by_user" not in result
        assert "orphaned_by_entity_type" not in result

    def test__default_values__are_empty(self) -> None:
        """Default CleanupStats has zero counts and empty dicts."""
        stats = CleanupStats()

        assert stats.users_processed == 0
        assert stats.expired_deleted == 0
        assert stats.orphaned_deleted == 0
        assert stats.expired_by_user == {}
        assert stats.orphaned_by_entity_type == {}
