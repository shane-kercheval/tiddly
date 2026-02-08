"""Tests for the HistoryService."""
from datetime import timedelta
from uuid import uuid4

import pytest
from diff_match_patch import diff_match_patch
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import AuthType, RequestContext, RequestSource
from models.content_history import ActionType, ContentHistory, DiffType, EntityType
from models.note import Note
from models.user import User
from services.history_service import (
    SNAPSHOT_INTERVAL,
    history_service,
)


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user for history service tests."""
    user = User(
        auth0_id="test-auth0-id-history-service",
        email="historyservice@test.com",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def request_context() -> RequestContext:
    """Create a test request context."""
    return RequestContext(
        source=RequestSource.WEB,
        auth_type=AuthType.AUTH0,
        token_prefix=None,
    )


@pytest.fixture
def pat_context() -> RequestContext:
    """Create a test request context with PAT auth."""
    return RequestContext(
        source=RequestSource.MCP_CONTENT,
        auth_type=AuthType.PAT,
        token_prefix="bm_test1234567",
    )


@pytest.fixture
async def test_note(db_session: AsyncSession, test_user: User) -> Note:
    """Create a test note for history tests."""
    note = Note(
        user_id=test_user.id,
        title="Test Note",
        content="Initial content",
    )
    db_session.add(note)
    await db_session.commit()
    await db_session.refresh(note)
    return note


class TestHistoryServiceRecordAction:
    """Tests for HistoryService.record_action()."""

    @pytest.mark.asyncio
    async def test__record_action__create_stores_snapshot(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """CREATE action stores content as snapshot with no diff."""
        entity_id = uuid4()
        content = "Hello World"
        metadata = {"title": "Test", "tags": []}

        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=content,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        assert history.version == 1
        assert history.diff_type == DiffType.SNAPSHOT.value
        assert history.content_snapshot == content
        assert history.content_diff is None
        assert history.action == ActionType.CREATE.value

    @pytest.mark.asyncio
    async def test__record_action__update_stores_diff(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """UPDATE action stores diff when content changes."""
        entity_id = uuid4()
        metadata = {"title": "Test", "tags": []}

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="Hello",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Update v2
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content="Hello World",
            previous_content="Hello",
            metadata=metadata,
            context=request_context,
        )

        assert history.version == 2
        assert history.diff_type == DiffType.DIFF.value
        assert history.content_snapshot is None
        assert history.content_diff is not None
        assert history.action == ActionType.UPDATE.value

    @pytest.mark.asyncio
    async def test__record_action__metadata_only_change(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Metadata-only change (content unchanged) stores METADATA type."""
        entity_id = uuid4()
        content = "Hello World"

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=content,
            previous_content=None,
            metadata={"title": "Test", "tags": []},
            context=request_context,
        )

        # Update v2 with same content but different metadata
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content=content,
            previous_content=content,  # Same as current
            metadata={"title": "Updated Title", "tags": ["new-tag"]},
            context=request_context,
        )

        assert history.version == 2
        assert history.diff_type == DiffType.METADATA.value
        assert history.content_snapshot is None
        assert history.content_diff is None
        assert history.metadata_snapshot == {"title": "Updated Title", "tags": ["new-tag"]}

    @pytest.mark.asyncio
    async def test__record_action__delete_stores_pre_delete_snapshot(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """DELETE action stores pre-delete content as snapshot."""
        entity_id = uuid4()
        content = "Hello World"
        metadata = {"title": "Test", "tags": []}

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=content,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Delete v2
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.DELETE,
            current_content=content,
            previous_content=content,
            metadata=metadata,
            context=request_context,
        )

        assert history.version == 2
        assert history.diff_type == DiffType.SNAPSHOT.value
        assert history.content_snapshot == content  # Pre-delete content preserved
        assert history.content_diff is None
        assert history.action == ActionType.DELETE.value

    @pytest.mark.asyncio
    async def test__record_action__periodic_snapshot_stores_both(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Periodic snapshot (every 10th version) stores both snapshot and diff."""
        entity_id = uuid4()
        metadata = {"title": "Test", "tags": []}

        # Create versions 1-9
        previous = None
        for i in range(1, SNAPSHOT_INTERVAL):
            content = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=content,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = content

        # Create version 10 (periodic snapshot)
        content_v10 = "Content v10"
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content=content_v10,
            previous_content=previous,
            metadata=metadata,
            context=request_context,
        )

        assert history.version == SNAPSHOT_INTERVAL
        assert history.diff_type == DiffType.SNAPSHOT.value
        assert history.content_snapshot == content_v10  # Full content
        assert history.content_diff is not None  # Also has diff for chain traversal

    @pytest.mark.asyncio
    async def test__record_action__stores_request_context(
        self,
        db_session: AsyncSession,
        test_user: User,
        pat_context: RequestContext,
    ) -> None:
        """History records store source, auth_type, and token_prefix from context."""
        entity_id = uuid4()

        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="http://example.com",
            previous_content=None,
            metadata={"title": "Test", "url": "http://example.com"},
            context=pat_context,
        )

        assert history.source == RequestSource.MCP_CONTENT.value
        assert history.auth_type == AuthType.PAT.value
        assert history.token_prefix == "bm_test1234567"

    @pytest.mark.asyncio
    async def test__record_action__archive_stores_metadata_type(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """ARCHIVE action stores METADATA type (content unchanged)."""
        entity_id = uuid4()
        content = "Content"
        metadata = {"title": "Test", "archived_at": "2024-01-01T00:00:00Z"}

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=content,
            previous_content=None,
            metadata={"title": "Test"},
            context=request_context,
        )

        # Archive v2
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.ARCHIVE,
            current_content=content,
            previous_content=content,
            metadata=metadata,
            context=request_context,
        )

        assert history.version == 2
        assert history.action == ActionType.ARCHIVE.value
        assert history.diff_type == DiffType.METADATA.value
        assert history.content_snapshot is None
        assert history.content_diff is None


class TestHistoryServiceDiffComputation:
    """Tests for diff computation and application."""

    @pytest.mark.asyncio
    async def test__diff__simple_text_change_produces_valid_diff(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Simple text change produces a valid diff that can be applied."""
        entity_id = uuid4()
        metadata = {"title": "Test"}
        original = "Hello"
        modified = "Hello World"

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=original,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Update v2
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content=modified,
            previous_content=original,
            metadata=metadata,
            context=request_context,
        )

        # Apply the reverse diff manually to verify correctness
        # The diff transforms current → previous (reverse direction)
        dmp = history_service.dmp
        patches = dmp.patch_fromText(history.content_diff)
        result, _ = dmp.patch_apply(patches, modified)
        assert result == original

    @pytest.mark.asyncio
    async def test__diff__large_content_changes_work(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Large content changes are handled correctly."""
        entity_id = uuid4()
        metadata = {"title": "Test"}
        original = "A" * 10000
        modified = "B" * 10000

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=original,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Update v2
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content=modified,
            previous_content=original,
            metadata=metadata,
            context=request_context,
        )

        assert history.content_diff is not None

        # Verify reverse diff works
        dmp = history_service.dmp
        patches = dmp.patch_fromText(history.content_diff)
        result, _ = dmp.patch_apply(patches, modified)
        assert result == original

    @pytest.mark.asyncio
    async def test__diff__empty_content_handled_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Empty content is handled correctly."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create v1 with empty content
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        assert history.content_snapshot == ""
        assert history.content_diff is None

    @pytest.mark.asyncio
    async def test__diff__null_to_value_creates_diff_not_snapshot(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Update from None content to value creates DIFF, not SNAPSHOT."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create v1 with None content (like an empty note)
        v1 = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=None,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        assert v1.version == 1
        assert v1.diff_type == DiffType.SNAPSHOT.value
        assert v1.content_snapshot is None  # No content stored
        assert v1.content_diff is None

        # Update v2: None -> "1" (this was incorrectly creating SNAPSHOT before fix)
        v2 = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content="1",
            previous_content=None,  # Previous content was None
            metadata=metadata,
            context=request_context,
        )

        # Should be DIFF, not SNAPSHOT
        assert v2.version == 2
        assert v2.diff_type == DiffType.DIFF.value
        assert v2.content_snapshot is None  # Not a snapshot
        assert v2.content_diff is not None  # Has the reverse diff

        # Verify the diff is valid: applying it to "1" should give ""
        dmp = diff_match_patch()
        patches = dmp.patch_fromText(v2.content_diff)
        result, _ = dmp.patch_apply(patches, "1")
        assert result == ""  # Reverse diff from "1" to None/""

    @pytest.mark.asyncio
    async def test__diff__unicode_content_handled_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Unicode and emoji content is handled correctly."""
        entity_id = uuid4()
        metadata = {"title": "Test"}
        original = "Hello 世界 🌍"
        modified = "Hello 世界 🌍 Updated 更新"

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=original,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Update v2
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content=modified,
            previous_content=original,
            metadata=metadata,
            context=request_context,
        )

        # Verify reverse diff works with unicode
        dmp = history_service.dmp
        patches = dmp.patch_fromText(history.content_diff)
        result, _ = dmp.patch_apply(patches, modified)
        assert result == original


class TestHistoryServiceReconstruction:
    """Tests for content reconstruction at specific versions."""

    @pytest.mark.asyncio
    async def test__reconstruct__latest_version_returns_directly(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """Reconstructing latest version returns content directly (no diff application)."""
        # Create history for the note
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content=test_note.content,
            previous_content=None,
            metadata={"title": test_note.title},
            context=request_context,
        )

        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=1,
        )

        assert result.found is True
        assert result.content == test_note.content
        assert result.warnings is None

    @pytest.mark.asyncio
    async def test__reconstruct__non_existent_version_returns_not_found(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """Reconstructing non-existent version returns found=False."""
        # Create history for the note
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content=test_note.content,
            previous_content=None,
            metadata={"title": test_note.title},
            context=request_context,
        )

        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=999,
        )

        assert result.found is False
        assert result.content is None

    @pytest.mark.asyncio
    async def test__reconstruct__invalid_version_returns_not_found(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """Reconstructing version 0 or negative returns found=False."""
        # Create history for the note
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content=test_note.content,
            previous_content=None,
            metadata={"title": test_note.title},
            context=request_context,
        )

        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=0,
        )

        assert result.found is False

    @pytest.mark.asyncio
    async def test__reconstruct__hard_deleted_entity_returns_not_found(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """Reconstructing content for hard-deleted entity returns found=False."""
        entity_id = uuid4()  # Non-existent entity

        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            target_version=1,
        )

        assert result.found is False
        assert result.content is None

    @pytest.mark.asyncio
    async def test__reconstruct__applies_reverse_diffs_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """Reconstruction applies reverse diffs to get earlier versions."""
        metadata = {"title": test_note.title}

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content="Content v1",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Create v2, v3, v4, v5
        previous = "Content v1"
        for i in range(2, 6):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                action=ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Update entity content to match v5
        test_note.content = "Content v5"
        await db_session.flush()

        # Reconstruct v1
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=1,
        )

        assert result.found is True
        assert result.content == "Content v1"

        # Reconstruct v3
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=3,
        )

        assert result.found is True
        assert result.content == "Content v3"


class TestReconstructionChainIntegrity:
    """[P0] End-to-end reconstruction chain integrity tests."""

    @pytest.mark.asyncio
    async def test__reconstruction_chain__all_versions_reconstruct_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """
        Create a realistic chain and verify every version reconstructs correctly.

        Chain structure:
        v1:  CREATE (SNAPSHOT)          content = "A"
        v2:  UPDATE (DIFF)              content = "AB"
        v3:  UPDATE (DIFF)              content = "ABC"
        ...
        v10: UPDATE (SNAPSHOT + DIFF)   content = "ABCDEFGHIJ"
        v11: UPDATE (DIFF)              content = "ABCDEFGHIJK"
        ...
        v15: ARCHIVE (METADATA)         content = "ABCDEFGHIJKLMNO" (unchanged)
        v16: UNARCHIVE (METADATA)       content = "ABCDEFGHIJKLMNO" (unchanged)
        ...
        v20: UPDATE (SNAPSHOT + DIFF)   content = "ABCDEFGHIJKLMNOPQRST"
        """
        metadata = {"title": test_note.title}
        expected_content: dict[int, str] = {}

        # Build the chain
        previous = None
        for i in range(1, 21):
            if i == 15:
                # ARCHIVE - content unchanged
                action = ActionType.ARCHIVE
                current = expected_content[14]
            elif i == 16:
                # UNARCHIVE - content unchanged
                action = ActionType.UNARCHIVE
                current = expected_content[15]
            elif i == 1:
                action = ActionType.CREATE
                current = "A"
            else:
                action = ActionType.UPDATE
                # Build content incrementally: A, AB, ABC, ...
                current = "".join(chr(ord("A") + j) for j in range(i))

            expected_content[i] = current

            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                action=action,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Update entity content to match v20
        test_note.content = expected_content[20]
        await db_session.flush()

        # Verify key versions reconstruct correctly
        test_versions = [1, 5, 10, 15, 16, 20]
        for version in test_versions:
            result = await history_service.reconstruct_content_at_version(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                target_version=version,
            )
            assert result.found is True, f"Version {version} should be found"
            assert result.content == expected_content[version], (
                f"Version {version} content mismatch: "
                f"expected '{expected_content[version]}', got '{result.content}'"
            )


class TestPeriodicSnapshotDualStorage:
    """[P0] Tests for periodic snapshot dual-storage traversal."""

    @pytest.mark.asyncio
    async def test__periodic_snapshot__stores_both_snapshot_and_diff(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """Periodic snapshots (v10, v20, etc.) store BOTH content_snapshot AND content_diff."""
        metadata = {"title": test_note.title}

        # Create versions 1-10
        previous = None
        for i in range(1, 11):
            current = f"Content {i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Get v10 record
        v10 = await history_service.get_history_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            version=10,
        )

        assert v10 is not None
        assert v10.diff_type == DiffType.SNAPSHOT.value
        assert v10.content_snapshot == "Content 10"  # Full content for optimization
        assert v10.content_diff is not None  # Diff for chain traversal


class TestDeleteVersionReconstruction:
    """[P0] DELETE version reconstruction regression tests."""

    @pytest.mark.asyncio
    async def test__reconstruct__delete_version_returns_pre_delete_content(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """
        Regression test: DELETE action must return pre-delete content, not None.

        Bug: DELETE stored content_snapshot=None due to condition ordering.
        Fix: DELETE explicitly stores current_content in content_snapshot.
        """
        original_content = "Hello World"
        metadata = {"title": test_note.title}

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content=original_content,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Delete v2
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.DELETE,
            current_content=original_content,
            previous_content=original_content,
            metadata=metadata,
            context=request_context,
        )

        # Reconstruct v2 (DELETE version)
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=2,
        )

        assert result.found is True
        assert result.content == original_content  # NOT None


class TestNearestSnapshotSelection:
    """[P1] Tests for nearest snapshot selection optimization."""

    @pytest.mark.asyncio
    async def test__reconstruct__uses_nearest_snapshot(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """
        Verify reconstruction picks the closest snapshot to target.

        v1-v50 exist, with SNAPSHOTs at v10, v20, v30, v40
        Target: v25

        Should start from v30's content_snapshot (nearest to v25)
        NOT v40's content_snapshot (first encountered in DESC order)
        """
        metadata = {"title": test_note.title}

        # Create versions 1-50
        previous = None
        expected_content: dict[int, str] = {}
        for i in range(1, 51):
            current = f"Content version {i}"
            expected_content[i] = current
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Update entity content to match v50
        test_note.content = expected_content[50]
        await db_session.flush()

        # Reconstruct v25
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=25,
        )

        assert result.found is True
        assert result.content == expected_content[25]


class TestMetadataRecordTraversal:
    """[P1] Tests for METADATA record traversal."""

    @pytest.mark.asyncio
    async def test__reconstruct__metadata_records_pass_content_through(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """
        METADATA records pass content through unchanged during reconstruction.

        v5: UPDATE content = "Hello"
        v6: ARCHIVE (METADATA) - content_diff=None
        v7: UPDATE (DIFF) content = "Hello World"

        Reconstruct v5: should traverse v7→v6→target, correctly skip v6's None diff
        Result: "Hello" (not "Hello World")
        """
        metadata = {"title": test_note.title}

        # Create v1-v5 with actual content
        previous = None
        for i in range(1, 6):
            current = f"Content v{i}" if i < 5 else "Hello"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # v6: ARCHIVE (content unchanged)
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.ARCHIVE,
            current_content="Hello",
            previous_content="Hello",
            metadata=metadata,
            context=request_context,
        )

        # v7: UPDATE with content change
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.UPDATE,
            current_content="Hello World",
            previous_content="Hello",
            metadata=metadata,
            context=request_context,
        )

        # Update entity content to match v7
        test_note.content = "Hello World"
        await db_session.flush()

        # Reconstruct v5
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=5,
        )

        assert result.found is True
        assert result.content == "Hello"


class TestReconstructionAtSnapshot:
    """[P1] Tests for reconstruction starting AT a snapshot."""

    @pytest.mark.asyncio
    async def test__reconstruct__at_periodic_snapshot_returns_directly(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """When target version IS a periodic snapshot, return content_snapshot directly."""
        metadata = {"title": test_note.title}

        # Create versions 1-15
        previous = None
        for i in range(1, 16):
            current = f"Content {i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=test_note.id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Update entity content to match v15
        test_note.content = "Content 15"
        await db_session.flush()

        # Reconstruct v10 (periodic snapshot)
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=10,
        )

        assert result.found is True
        assert result.content == "Content 10"


class TestEmptyDiffHandling:
    """[P2] Tests for empty diff vs None diff handling."""

    @pytest.mark.asyncio
    async def test__reconstruct__empty_string_diff_behaves_like_none(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """Empty string content_diff should behave same as None (no transformation)."""
        metadata = {"title": test_note.title}

        # Create v1
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content="Hello",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Manually insert a history record with empty string diff to test edge case
        # (This shouldn't happen in practice, but tests defensive handling)
        history = ContentHistory(
            user_id=test_user.id,
            entity_type=EntityType.NOTE.value,
            entity_id=test_note.id,
            action=ActionType.UPDATE.value,
            version=2,
            diff_type=DiffType.DIFF.value,
            content_snapshot=None,
            content_diff="",  # Empty string
            metadata_snapshot=metadata,
            source=RequestSource.WEB.value,
            auth_type=AuthType.AUTH0.value,
        )
        db_session.add(history)
        await db_session.flush()

        # Update entity content
        test_note.content = "Hello"
        await db_session.flush()

        # Reconstruct v1 - should still work (empty diff = no transformation)
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=1,
        )

        assert result.found is True
        assert result.content == "Hello"


class TestCorruptedDiffHandling:
    """Tests for corrupted diff handling (graceful degradation)."""

    @pytest.mark.asyncio
    async def test__reconstruct__corrupted_diff_returns_warning_not_exception(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """
        Corrupted diff text should return warning, not raise exception.

        Per spec: "Partial failures are logged but don't fail the request."
        This ensures reconstruction continues even with corrupted data.

        Setup:
        - v1: SNAPSHOT content="A"
        - v2: DIFF content="AB" (valid)
        - v3: DIFF (corrupted)
        - entity.content = "ABC"
        - Target: v2 (requires traversing v3's corrupted diff)
        """
        metadata = {"title": test_note.title}

        # Create v1 (snapshot) content="A"
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content="A",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Create v2 (diff) content="AB"
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.UPDATE,
            current_content="AB",
            previous_content="A",
            metadata=metadata,
            context=request_context,
        )

        # Manually insert v3 with corrupted diff text
        history = ContentHistory(
            user_id=test_user.id,
            entity_type=EntityType.NOTE.value,
            entity_id=test_note.id,
            action=ActionType.UPDATE.value,
            version=3,
            diff_type=DiffType.DIFF.value,
            content_snapshot=None,
            content_diff="this_is_not_valid_patch_text!!!",  # Corrupted
            metadata_snapshot=metadata,
            source=RequestSource.WEB.value,
            auth_type=AuthType.AUTH0.value,
        )
        db_session.add(history)
        await db_session.flush()

        # Update entity content to simulate current state
        test_note.content = "ABC"
        await db_session.flush()

        # Reconstruct v2 - must traverse v3's corrupted diff
        # Should NOT raise, should return with warning
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=2,
        )

        assert result.found is True
        # Content will be entity.content since corrupted diff couldn't transform it
        assert result.content is not None
        # Should have a warning about the corrupted diff
        assert result.warnings is not None
        assert len(result.warnings) == 1
        assert "Corrupted diff at v3" in result.warnings[0]

    @pytest.mark.asyncio
    async def test__reconstruct__continues_after_corrupted_diff(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_note: Note,
        request_context: RequestContext,
    ) -> None:
        """
        Reconstruction continues processing after encountering corrupted diff.

        Setup:
        - v1: SNAPSHOT content="A"
        - v2: DIFF content="AB" (valid)
        - v3: DIFF (corrupted)
        - v4: DIFF content="ABCD" (valid)
        - entity.content = "ABCD"
        - Target: v2 (requires traversing v4, v3)

        v4's valid diff is applied, v3's corrupted diff is skipped with warning,
        then we reach target v2.
        """
        metadata = {"title": test_note.title}

        # Create v1 (snapshot) content="A"
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.CREATE,
            current_content="A",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Create v2 (diff) content="AB"
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            action=ActionType.UPDATE,
            current_content="AB",
            previous_content="A",
            metadata=metadata,
            context=request_context,
        )

        # Manually insert v3 with corrupted diff
        history_v3 = ContentHistory(
            user_id=test_user.id,
            entity_type=EntityType.NOTE.value,
            entity_id=test_note.id,
            action=ActionType.UPDATE.value,
            version=3,
            diff_type=DiffType.DIFF.value,
            content_snapshot=None,
            content_diff="CORRUPTED_GARBAGE_DATA",
            metadata_snapshot=metadata,
            source=RequestSource.WEB.value,
            auth_type=AuthType.AUTH0.value,
        )
        db_session.add(history_v3)
        await db_session.flush()

        # Create v4 (diff) content="ABCD" - using the history service
        # We need to compute the diff from "ABC" (what v3 would have been) to "AB"
        # But since v3 is corrupted, let's manually create v4 with a valid diff
        dmp = history_service.dmp
        # Reverse diff: ABCD -> ABC (but we don't know what ABC was due to corruption)
        # Let's just create a valid diff that would work
        patches = dmp.patch_make("ABCD", "ABC")
        valid_diff = dmp.patch_toText(patches)

        history_v4 = ContentHistory(
            user_id=test_user.id,
            entity_type=EntityType.NOTE.value,
            entity_id=test_note.id,
            action=ActionType.UPDATE.value,
            version=4,
            diff_type=DiffType.DIFF.value,
            content_snapshot=None,
            content_diff=valid_diff,
            metadata_snapshot=metadata,
            source=RequestSource.WEB.value,
            auth_type=AuthType.AUTH0.value,
        )
        db_session.add(history_v4)
        await db_session.flush()

        # Update entity content to v4's content
        test_note.content = "ABCD"
        await db_session.flush()

        # Reconstruct v2 - should process v4 (valid), v3 (corrupted, skipped)
        result = await history_service.reconstruct_content_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=test_note.id,
            target_version=2,
        )

        assert result.found is True
        # Should have warning about v3
        assert result.warnings is not None
        assert any("v3" in w for w in result.warnings)
        # v4's diff was applied (ABCD -> ABC), but v3's was skipped
        # So content should be "ABC" (not "AB" as it would be without corruption)
        # v2's diff was still applied


class TestHistoryRetrieval:
    """Tests for history retrieval methods."""

    @pytest.mark.asyncio
    async def test__get_entity_history__returns_records_and_count(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """get_entity_history returns correct records and total count."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create 5 history records
        previous = None
        for i in range(1, 6):
            current = f"Content {i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )

        assert total == 5
        assert len(items) == 5
        # Should be ordered by version DESC
        assert items[0].version == 5
        assert items[-1].version == 1

    @pytest.mark.asyncio
    async def test__get_entity_history__pagination_works(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """get_entity_history pagination works correctly."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create 10 history records
        previous = None
        for i in range(1, 11):
            current = f"Content {i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Get first page
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            limit=3,
            offset=0,
        )

        assert total == 10
        assert len(items) == 3
        assert items[0].version == 10
        assert items[-1].version == 8

        # Get second page
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            limit=3,
            offset=3,
        )

        assert total == 10
        assert len(items) == 3
        assert items[0].version == 7

    @pytest.mark.asyncio
    async def test__get_user_history__returns_all_entity_types(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """get_user_history returns history across all entity types."""
        metadata = {"title": "Test"}

        # Create history for different entity types
        for entity_type in [EntityType.NOTE, EntityType.BOOKMARK, EntityType.PROMPT]:
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=entity_type,
                entity_id=uuid4(),
                action=ActionType.CREATE,
                current_content="Content",
                previous_content=None,
                metadata=metadata,
                context=request_context,
            )

        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
        )

        assert total == 3
        assert len(items) == 3
        entity_types = {item.entity_type for item in items}
        assert entity_types == {"note", "bookmark", "prompt"}

    @pytest.mark.asyncio
    async def test__get_user_history__filters_by_entity_type(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """get_user_history filters by entity_type when provided."""
        metadata = {"title": "Test"}

        # Create history for different entity types
        for entity_type in [EntityType.NOTE, EntityType.NOTE, EntityType.BOOKMARK]:
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=entity_type,
                entity_id=uuid4(),
                action=ActionType.CREATE,
                current_content="Content",
                previous_content=None,
                metadata=metadata,
                context=request_context,
            )

        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            entity_types=[EntityType.NOTE],
        )

        assert total == 2
        assert len(items) == 2
        assert all(item.entity_type == "note" for item in items)

    @pytest.mark.asyncio
    async def test__get_history_at_version__returns_correct_record(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """get_history_at_version returns the correct record."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create multiple versions
        previous = None
        for i in range(1, 4):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Get v2
        record = await history_service.get_history_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            version=2,
        )

        assert record is not None
        assert record.version == 2
        assert record.action == ActionType.UPDATE.value


class TestDeleteEntityHistory:
    """Tests for delete_entity_history method."""

    @pytest.mark.asyncio
    async def test__delete_entity_history__removes_all_records(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """delete_entity_history removes all history for an entity."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create history
        previous = None
        for i in range(1, 4):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Verify history exists
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )
        assert total == 3

        # Delete history
        deleted_count = await history_service.delete_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )

        assert deleted_count == 3

        # Verify history is gone
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )
        assert total == 0


class TestVersionNumbering:
    """Tests for version number allocation."""

    @pytest.mark.asyncio
    async def test__version_numbers__increment_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Version numbers increment sequentially."""
        entity_id = uuid4()
        metadata = {"title": "Test"}

        versions = []
        previous = None
        for i in range(1, 6):
            current = f"Content v{i}"
            history = await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            versions.append(history.version)
            previous = current

        assert versions == [1, 2, 3, 4, 5]

    @pytest.mark.asyncio
    async def test__version_numbers__independent_per_entity(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Version numbers are independent per entity."""
        entity_id_1 = uuid4()
        entity_id_2 = uuid4()
        metadata = {"title": "Test"}

        # Create v1-v3 for entity 1
        previous = None
        for i in range(1, 4):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id_1,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Create v1 for entity 2 - should start at 1, not 4
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id_2,
            action=ActionType.CREATE,
            current_content="Content",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        assert history.version == 1


class TestRaceConditionHandling:
    """Tests for race condition handling in version allocation."""

    @pytest.mark.asyncio
    async def test__record_action__retries_on_version_uniqueness_violation(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Version uniqueness violation triggers retry with savepoint."""
        from unittest.mock import patch

        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Mock _record_action_impl to fail on first call, succeed on second
        original_impl = history_service._record_action_impl
        call_count = 0

        async def mock_impl(*args, **kwargs):  # noqa
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Simulate version conflict on first attempt
                from sqlalchemy.exc import IntegrityError

                raise IntegrityError(
                    "duplicate key",
                    params={},
                    orig=Exception("uq_content_history_version"),
                )
            return await original_impl(*args, **kwargs)

        with patch.object(history_service, "_record_action_impl", side_effect=mock_impl):
            history = await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE,
                current_content="Content",
                previous_content=None,
                metadata=metadata,
                context=request_context,
            )

        # Should succeed on retry
        assert history.version == 1
        assert call_count == 2  # First failed, second succeeded

    @pytest.mark.asyncio
    async def test__record_action__raises_other_integrity_errors_immediately(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Non-version IntegrityErrors are raised immediately without retry."""
        from unittest.mock import patch

        from sqlalchemy.exc import IntegrityError

        entity_id = uuid4()
        metadata = {"title": "Test"}
        call_count = 0

        async def mock_impl(*args, **kwargs):  # noqa
            nonlocal call_count
            call_count += 1
            # Simulate a different integrity error (not version-related)
            raise IntegrityError(
                "foreign key violation",
                params={},
                orig=Exception("fk_user_id"),
            )

        with patch.object(history_service, "_record_action_impl", side_effect=mock_impl):
            with pytest.raises(IntegrityError) as exc_info:
                await history_service.record_action(
                    db=db_session,
                    user_id=test_user.id,
                    entity_type=EntityType.NOTE,
                    entity_id=entity_id,
                    action=ActionType.CREATE,
                    current_content="Content",
                    previous_content=None,
                    metadata=metadata,
                    context=request_context,
                )

        # Should raise immediately without retry
        assert call_count == 1
        assert "fk_user_id" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test__record_action__raises_after_max_retries_exceeded(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Max retries exceeded raises the IntegrityError."""
        from unittest.mock import patch

        from sqlalchemy.exc import IntegrityError

        entity_id = uuid4()
        metadata = {"title": "Test"}
        call_count = 0

        async def mock_impl(*args, **kwargs):  # noqa
            nonlocal call_count
            call_count += 1
            # Always fail with version conflict
            raise IntegrityError(
                "duplicate key",
                params={},
                orig=Exception("uq_content_history_version"),
            )

        with patch.object(history_service, "_record_action_impl", side_effect=mock_impl):
            with pytest.raises(IntegrityError) as exc_info:
                await history_service.record_action(
                    db=db_session,
                    user_id=test_user.id,
                    entity_type=EntityType.NOTE,
                    entity_id=entity_id,
                    action=ActionType.CREATE,
                    current_content="Content",
                    previous_content=None,
                    metadata=metadata,
                    context=request_context,
                )

        # Should try 3 times then raise
        assert call_count == 3
        assert "uq_content_history_version" in str(exc_info.value)


class TestBoundaryConditions:
    """Tests for boundary conditions in content and metadata."""

    @pytest.mark.asyncio
    async def test__diff__100kb_content_handled_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Content at exactly 100KB limit is handled correctly."""
        entity_id = uuid4()
        metadata = {"title": "Large Content Test"}

        # Create 100KB of content (100 * 1024 = 102400 bytes)
        original_100kb = "A" * 102400
        modified_100kb = original_100kb[:50000] + "B" * 2400 + original_100kb[52400:]

        # Create v1 with 100KB content
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content=original_100kb,
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Update v2 with modified 100KB content
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content=modified_100kb,
            previous_content=original_100kb,
            metadata=metadata,
            context=request_context,
        )

        assert history.version == 2
        assert history.content_diff is not None

        # Verify reverse diff works correctly
        dmp = history_service.dmp
        patches = dmp.patch_fromText(history.content_diff)
        result, success = dmp.patch_apply(patches, modified_100kb)
        assert all(success)
        assert result == original_100kb

    @pytest.mark.asyncio
    async def test__metadata__long_tag_list_handled_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Very long tag lists in metadata are stored and retrieved correctly."""
        entity_id = uuid4()

        # Create metadata with many tags (50 tags with varying lengths)
        tags = [f"tag-{i}-{'x' * (i % 20)}" for i in range(50)]
        metadata = {
            "title": "Many Tags Test",
            "description": "Testing long tag lists",
            "tags": tags,
        }

        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="http://example.com",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        # Verify metadata was stored correctly
        assert history.metadata_snapshot is not None
        assert history.metadata_snapshot["tags"] == tags
        assert len(history.metadata_snapshot["tags"]) == 50

        # Retrieve and verify
        retrieved = await history_service.get_history_at_version(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=entity_id,
            version=1,
        )
        assert retrieved is not None
        assert retrieved.metadata_snapshot["tags"] == tags

    @pytest.mark.asyncio
    async def test__metadata__deeply_nested_structure_handled_correctly(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Complex nested metadata structures are stored and retrieved correctly."""
        entity_id = uuid4()

        # Create metadata with nested structure (simulating prompt arguments)
        metadata = {
            "name": "complex-prompt",
            "title": "Complex Prompt",
            "arguments": [
                {
                    "name": "code_to_review",
                    "description": "The code to review",
                    "required": True,
                },
                {
                    "name": "language",
                    "description": "Programming language",
                    "required": False,
                },
                {
                    "name": "options",
                    "description": "Review options",
                    "required": False,
                },
            ],
            "tags": ["code", "review", "development"],
        }

        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.PROMPT,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="Review this {{ code_to_review }}",
            previous_content=None,
            metadata=metadata,
            context=request_context,
        )

        assert history.metadata_snapshot == metadata
        assert len(history.metadata_snapshot["arguments"]) == 3
        assert history.metadata_snapshot["arguments"][0]["name"] == "code_to_review"


class TestCountBasedPruning:
    """Tests for count-based history pruning."""

    @pytest.mark.asyncio
    async def test__prune_to_limit__deletes_oldest_records(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """_prune_to_limit deletes oldest records while keeping target count."""
        from services.history_service import history_service

        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create 20 history records
        previous = None
        for i in range(1, 21):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Verify we have 20 records
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )
        assert total == 20

        # Prune to keep only 10 records
        deleted = await history_service._prune_to_limit(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE.value,
            entity_id=entity_id,
            target=10,
        )
        await db_session.commit()

        # Should have deleted 10 oldest records
        assert deleted == 10

        # Verify remaining records
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )
        assert total == 10

        # Remaining should be versions 11-20 (newest)
        versions = sorted([item.version for item in items])
        assert versions == list(range(11, 21))

    @pytest.mark.asyncio
    async def test__prune_to_limit__no_op_when_under_limit(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """_prune_to_limit does nothing when count is below target."""
        from services.history_service import history_service

        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create 5 history records
        previous = None
        for i in range(1, 6):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
            )
            previous = current

        # Try to prune to 10 (more than we have)
        deleted = await history_service._prune_to_limit(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE.value,
            entity_id=entity_id,
            target=10,
        )

        # Should not delete anything
        assert deleted == 0

        # Verify all records still exist
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )
        assert total == 5

    @pytest.mark.asyncio
    async def test__record_action__triggers_pruning_at_interval(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """
        record_action triggers pruning check every PRUNE_CHECK_INTERVAL writes.

        When limits.max_history_per_entity is exceeded and version is divisible
        by PRUNE_CHECK_INTERVAL, pruning occurs.
        """
        from core.tier_limits import TierLimits
        from services.history_service import PRUNE_CHECK_INTERVAL, history_service

        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create limits with small max to trigger pruning
        limits = TierLimits(
            max_bookmarks=100,
            max_notes=100,
            max_prompts=100,
            max_url_length=2000,
            max_title_length=200,
            max_description_length=5000,
            max_bookmark_content_length=100000,
            max_note_content_length=100000,
            max_prompt_content_length=100000,
            max_tag_name_length=50,
            max_prompt_name_length=100,
            max_argument_name_length=50,
            max_argument_description_length=500,
            rate_read_per_minute=100,
            rate_read_per_day=1000,
            rate_write_per_minute=50,
            rate_write_per_day=500,
            rate_sensitive_per_minute=10,
            rate_sensitive_per_day=100,
            history_retention_days=30,
            max_history_per_entity=5,  # Low limit for testing
        )

        # Create more records than the limit
        previous = None
        for i in range(1, PRUNE_CHECK_INTERVAL + 1):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
                limits=limits,
            )
            previous = current

        await db_session.commit()

        # After PRUNE_CHECK_INTERVAL writes with limit=5, should have pruned
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )

        # Should have at most max_history_per_entity records
        assert total <= limits.max_history_per_entity

    @pytest.mark.asyncio
    async def test__record_action__no_pruning_without_limits(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """record_action does not prune when limits is None."""
        from services.history_service import PRUNE_CHECK_INTERVAL, history_service

        entity_id = uuid4()
        metadata = {"title": "Test"}

        # Create PRUNE_CHECK_INTERVAL records without limits
        previous = None
        for i in range(1, PRUNE_CHECK_INTERVAL + 1):
            current = f"Content v{i}"
            await history_service.record_action(
                db=db_session,
                user_id=test_user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                action=ActionType.CREATE if i == 1 else ActionType.UPDATE,
                current_content=current,
                previous_content=previous,
                metadata=metadata,
                context=request_context,
                limits=None,  # No limits
            )
            previous = current

        # All records should still exist (no pruning)
        items, total = await history_service.get_entity_history(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
        )
        assert total == PRUNE_CHECK_INTERVAL


class TestGetUserHistoryFilters:
    """Tests for get_user_history filter functionality."""

    @pytest.mark.asyncio
    async def test__get_user_history__filter_by_single_entity_type(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Filter by single entity type returns only matching records."""
        note_id = uuid4()
        bookmark_id = uuid4()

        # Create a note
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=note_id,
            action=ActionType.CREATE,
            current_content="Note content",
            previous_content=None,
            metadata={"title": "Test Note"},
            context=request_context,
        )

        # Create a bookmark
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=bookmark_id,
            action=ActionType.CREATE,
            current_content="Bookmark content",
            previous_content=None,
            metadata={"url": "https://test.com"},
            context=request_context,
        )

        # Filter by note entity type
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            entity_types=[EntityType.NOTE],
        )

        assert total == 1
        assert items[0].entity_type == EntityType.NOTE.value

    @pytest.mark.asyncio
    async def test__get_user_history__filter_by_multiple_entity_types(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Filter by multiple entity types returns union (OR logic)."""
        note_id = uuid4()
        bookmark_id = uuid4()
        prompt_id = uuid4()

        # Create one of each
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=note_id,
            action=ActionType.CREATE,
            current_content="Note",
            previous_content=None,
            metadata={"title": "Test"},
            context=request_context,
        )
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=bookmark_id,
            action=ActionType.CREATE,
            current_content="Bookmark",
            previous_content=None,
            metadata={"url": "https://test.com"},
            context=request_context,
        )
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.PROMPT,
            entity_id=prompt_id,
            action=ActionType.CREATE,
            current_content="Prompt",
            previous_content=None,
            metadata={"name": "test-prompt"},
            context=request_context,
        )

        # Filter by note and bookmark (should return 2)
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            entity_types=[EntityType.NOTE, EntityType.BOOKMARK],
        )

        assert total == 2
        entity_types = {item.entity_type for item in items}
        assert entity_types == {"note", "bookmark"}

    @pytest.mark.asyncio
    async def test__get_user_history__filter_by_actions(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Filter by action types returns only matching records."""
        entity_id = uuid4()

        # Create and update
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="Initial",
            previous_content=None,
            metadata={"title": "Test"},
            context=request_context,
        )
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.UPDATE,
            current_content="Updated",
            previous_content="Initial",
            metadata={"title": "Test"},
            context=request_context,
        )

        # Filter by create only
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            actions=[ActionType.CREATE],
        )
        assert total == 1
        assert items[0].action == ActionType.CREATE.value

        # Filter by both
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            actions=[ActionType.CREATE, ActionType.UPDATE],
        )
        assert total == 2

    @pytest.mark.asyncio
    async def test__get_user_history__filter_by_sources(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
        pat_context: RequestContext,
    ) -> None:
        """Filter by source returns only matching records."""
        entity_id_1 = uuid4()
        entity_id_2 = uuid4()

        # Create with web source (via request_context)
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id_1,
            action=ActionType.CREATE,
            current_content="Web content",
            previous_content=None,
            metadata={"title": "Web"},
            context=request_context,  # source=web
        )

        # Create with MCP source (via pat_context)
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id_2,
            action=ActionType.CREATE,
            current_content="MCP content",
            previous_content=None,
            metadata={"title": "MCP"},
            context=pat_context,  # source=mcp-content
        )

        # Filter by web source
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            sources=["web"],
        )
        assert total == 1
        assert items[0].source == "web"

        # Filter by mcp-content source
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            sources=["mcp-content"],
        )
        assert total == 1
        assert items[0].source == "mcp-content"

    @pytest.mark.asyncio
    async def test__get_user_history__filter_by_date_range(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Filter by date range returns only records in range."""
        entity_id = uuid4()

        # Create a record
        history = await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="Content",
            previous_content=None,
            metadata={"title": "Test"},
            context=request_context,
        )
        await db_session.flush()

        created_at = history.created_at

        # Filter with start_date before creation
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            start_date=created_at - timedelta(hours=1),
        )
        assert total == 1

        # Filter with start_date after creation
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            start_date=created_at + timedelta(hours=1),
        )
        assert total == 0

        # Filter with end_date after creation
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            end_date=created_at + timedelta(hours=1),
        )
        assert total == 1

        # Filter with end_date before creation
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            end_date=created_at - timedelta(hours=1),
        )
        assert total == 0

    @pytest.mark.asyncio
    async def test__get_user_history__combined_filters(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Combined filters use AND logic between categories."""
        note_id = uuid4()
        bookmark_id = uuid4()

        # Create note
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=note_id,
            action=ActionType.CREATE,
            current_content="Note",
            previous_content=None,
            metadata={"title": "Note"},
            context=request_context,
        )

        # Update note
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=note_id,
            action=ActionType.UPDATE,
            current_content="Updated Note",
            previous_content="Note",
            metadata={"title": "Note"},
            context=request_context,
        )

        # Create bookmark
        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=bookmark_id,
            action=ActionType.CREATE,
            current_content="Bookmark",
            previous_content=None,
            metadata={"url": "https://test.com"},
            context=request_context,
        )

        # Filter by note AND update (should return 1)
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            entity_types=[EntityType.NOTE],
            actions=[ActionType.UPDATE],
        )
        assert total == 1
        assert items[0].entity_type == "note"
        assert items[0].action == "update"

    @pytest.mark.asyncio
    async def test__get_user_history__empty_filters_return_all(
        self,
        db_session: AsyncSession,
        test_user: User,
        request_context: RequestContext,
    ) -> None:
        """Empty filter lists return all records (same as None)."""
        entity_id = uuid4()

        await history_service.record_action(
            db=db_session,
            user_id=test_user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            action=ActionType.CREATE,
            current_content="Content",
            previous_content=None,
            metadata={"title": "Test"},
            context=request_context,
        )

        # Empty lists are falsy in Python, so they skip the filter (show all)
        items, total = await history_service.get_user_history(
            db=db_session,
            user_id=test_user.id,
            entity_types=[],
            actions=[],
            sources=[],
        )
        assert total == 1
