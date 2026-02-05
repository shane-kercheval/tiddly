"""Service layer for content history recording and reconstruction."""
import logging
from dataclasses import dataclass
from uuid import UUID

from diff_match_patch import diff_match_patch
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import RequestContext
from models.bookmark import Bookmark
from models.content_history import ActionType, ContentHistory, DiffType, EntityType
from models.note import Note
from models.prompt import Prompt

logger = logging.getLogger(__name__)

# Full snapshot every N versions (enables reconstruction optimization)
SNAPSHOT_INTERVAL = 10


@dataclass
class ReconstructionResult:
    """Result of content reconstruction at a version."""

    found: bool  # Whether the version exists
    content: str | None  # Content at that version (None is valid for some actions)
    warnings: list[str] | None = None  # Warnings if reconstruction had issues


class HistoryService:
    """Service for recording and retrieving content history."""

    def __init__(self) -> None:
        """Initialize the history service with diff-match-patch."""
        self.dmp = diff_match_patch()

    async def record_action(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
        action: ActionType | str,
        current_content: str | None,
        previous_content: str | None,
        metadata: dict,
        context: RequestContext,
    ) -> ContentHistory:
        """
        Record a history entry for an action.

        Uses savepoint-based retry for race conditions on version allocation.
        This ensures the parent entity change is not rolled back if history
        insert fails due to version uniqueness violation.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity (bookmark, note, prompt).
            entity_id: ID of the entity.
            action: Action performed (create, update, delete, etc.).
            current_content: Current content after the action.
            previous_content: Content before the action (None for CREATE).
            metadata: Non-content metadata (title, tags, etc.).
            context: Request context with source/auth info.

        Returns:
            The created ContentHistory record.

        Raises:
            IntegrityError: If max retries exceeded on version collision.
        """
        max_retries = 3
        last_error: IntegrityError | None = None

        for attempt in range(max_retries):
            try:
                async with db.begin_nested():  # Creates savepoint
                    return await self._record_action_impl(
                        db,
                        user_id,
                        entity_type,
                        entity_id,
                        action,
                        current_content,
                        previous_content,
                        metadata,
                        context,
                    )
            except IntegrityError as e:
                last_error = e
                # Only retry on version uniqueness violations
                if "uq_content_history_version" not in str(e):
                    raise  # Re-raise other integrity errors immediately
                # Savepoint automatically rolled back, parent transaction intact
                if attempt == max_retries - 1:
                    raise
                # Continue to retry with new version number

        # Should not reach here, but satisfy type checker
        if last_error:
            raise last_error
        raise RuntimeError("Unexpected state in record_action")

    async def _record_action_impl(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
        action: ActionType | str,
        current_content: str | None,
        previous_content: str | None,
        metadata: dict,
        context: RequestContext,
    ) -> ContentHistory:
        """Internal implementation of record_action."""
        # Convert enums to strings if needed
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )
        action_value = action.value if isinstance(action, ActionType) else action

        version = await self._get_next_version(db, user_id, entity_type_value, entity_id)

        # Determine diff_type, content_snapshot, and content_diff
        # Uses dual storage: SNAPSHOTs store both full content AND diff (when applicable)
        content_snapshot: str | None = None
        content_diff: str | None = None

        if action_value == ActionType.DELETE.value:
            # DELETE: Store pre-delete content as snapshot for audit trail
            # No diff because content doesn't change (just deleted_at is set)
            diff_type = DiffType.SNAPSHOT
            content_snapshot = current_content
            content_diff = None
        elif action_value == ActionType.CREATE.value or previous_content is None:
            # CREATE: Store initial content as snapshot, no diff (no previous version)
            diff_type = DiffType.SNAPSHOT
            content_snapshot = current_content
            content_diff = None
        elif previous_content == current_content:
            # Content unchanged - metadata-only change (tags, title, etc.)
            # Also covers RESTORE, ARCHIVE, UNARCHIVE which don't change content
            diff_type = DiffType.METADATA
            content_snapshot = None
            content_diff = None
        elif version % SNAPSHOT_INTERVAL == 0:
            # Periodic snapshot: Store BOTH full content AND diff
            # This enables reconstruction optimization (start from nearest snapshot)
            # while maintaining chain traversal (can still apply diff to continue)
            diff_type = DiffType.SNAPSHOT
            content_snapshot = current_content
            # Compute reverse diff: current → previous (how to go backwards)
            patches = self.dmp.patch_make(current_content or "", previous_content or "")
            content_diff = self.dmp.patch_toText(patches)
        else:
            # Normal update: Store diff only (no snapshot)
            diff_type = DiffType.DIFF
            content_snapshot = None
            # Compute reverse diff: current → previous
            patches = self.dmp.patch_make(current_content or "", previous_content or "")
            content_diff = self.dmp.patch_toText(patches)

        history = ContentHistory(
            user_id=user_id,
            entity_type=entity_type_value,
            entity_id=entity_id,
            action=action_value,
            version=version,
            diff_type=diff_type.value if isinstance(diff_type, DiffType) else diff_type,
            content_snapshot=content_snapshot,
            content_diff=content_diff,
            metadata_snapshot=metadata,
            source=context.source.value,
            auth_type=context.auth_type.value,
            token_prefix=context.token_prefix,
        )
        db.add(history)
        await db.flush()
        return history

    async def get_entity_history(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ContentHistory], int]:
        """
        Get history for a specific entity.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.
            limit: Maximum records to return.
            offset: Number of records to skip.

        Returns:
            Tuple of (history records, total count).
        """
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )

        # Count query
        count_stmt = (
            select(func.count())
            .select_from(ContentHistory)
            .where(
                ContentHistory.user_id == user_id,
                ContentHistory.entity_type == entity_type_value,
                ContentHistory.entity_id == entity_id,
            )
        )
        total = (await db.execute(count_stmt)).scalar_one()

        # Data query
        stmt = (
            select(ContentHistory)
            .where(
                ContentHistory.user_id == user_id,
                ContentHistory.entity_type == entity_type_value,
                ContentHistory.entity_id == entity_id,
            )
            .order_by(ContentHistory.version.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(stmt)
        return list(result.scalars().all()), total

    async def get_user_history(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ContentHistory], int]:
        """
        Get all history for a user.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Optional filter by entity type.
            limit: Maximum records to return.
            offset: Number of records to skip.

        Returns:
            Tuple of (history records, total count).
        """
        # Build base conditions
        conditions = [ContentHistory.user_id == user_id]
        if entity_type:
            entity_type_value = (
                entity_type.value if isinstance(entity_type, EntityType) else entity_type
            )
            conditions.append(ContentHistory.entity_type == entity_type_value)

        # Count query
        count_stmt = select(func.count()).select_from(ContentHistory).where(*conditions)
        total = (await db.execute(count_stmt)).scalar_one()

        # Data query
        stmt = (
            select(ContentHistory)
            .where(*conditions)
            .order_by(ContentHistory.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(stmt)
        return list(result.scalars().all()), total

    async def reconstruct_content_at_version(  # noqa: PLR0911, PLR0912
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
        target_version: int,
    ) -> ReconstructionResult:
        """
        Reconstruct content at a specific version by applying reverse diffs.

        Uses OPTIMIZED ENTITY-ANCHORED reconstruction:
        1. Get current content from entity table as fallback anchor
        2. Fetch all history records from latest down to AND INCLUDING target
        3. Check if target is a SNAPSHOT - if so, return directly (optimization)
        4. Find the nearest snapshot above target (lowest version in fetched records)
        5. Start from snapshot's content_snapshot (or entity.content if no snapshot)
        6. Apply content_diff from each record to traverse backwards
        7. Return content when we reach target version

        With dual-storage SNAPSHOTs (content_snapshot + content_diff), we can:
        - Start from any snapshot (using content_snapshot)
        - Traverse through snapshots (using content_diff)

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.
            target_version: Version to reconstruct.

        Returns:
            ReconstructionResult with:
            - found=False if version doesn't exist or entity is hard-deleted
            - found=True with content (may be None for some edge cases)
        """
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )

        # Step 1: Get current content from the entity as fallback anchor
        entity = await self._get_entity(
            db, user_id, entity_type_value, entity_id, include_deleted=True,
        )
        if entity is None:
            # Entity was hard-deleted - no reconstruction possible
            return ReconstructionResult(found=False, content=None)

        # Step 2: Get the latest version number
        latest_version = await self._get_latest_version(
            db, user_id, entity_type_value, entity_id,
        )
        if latest_version is None or target_version > latest_version:
            # No history exists or target is beyond latest version
            return ReconstructionResult(found=False, content=None)

        if target_version < 1:
            # Invalid version number
            return ReconstructionResult(found=False, content=None)

        # Step 3: Handle target == latest (common case, no reconstruction needed)
        if target_version == latest_version:
            latest_record = await self.get_history_at_version(
                db, user_id, entity_type_value, entity_id, target_version,
            )
            if latest_record and latest_record.content_snapshot is not None:
                # SNAPSHOT record (CREATE/DELETE/periodic) - use stored snapshot
                return ReconstructionResult(found=True, content=latest_record.content_snapshot)
            # DIFF or METADATA record - entity.content is current
            return ReconstructionResult(found=True, content=entity.content)

        # Step 4: Fetch all history records from latest down to AND INCLUDING target
        # Including target allows us to check if target is a SNAPSHOT (optimization)
        records_stmt = (
            select(ContentHistory)
            .where(
                ContentHistory.user_id == user_id,
                ContentHistory.entity_type == entity_type_value,
                ContentHistory.entity_id == entity_id,
                ContentHistory.version >= target_version,  # Include target
                ContentHistory.version <= latest_version,
            )
            .order_by(ContentHistory.version.desc())  # Descending: latest first
        )
        records_result = await db.execute(records_stmt)
        records = list(records_result.scalars().all())

        if not records:
            return ReconstructionResult(found=False, content=None)

        # Step 5: Check if target is a SNAPSHOT - return directly (optimization)
        # Target is always the last record (lowest version in DESC order)
        target_record = records[-1]
        if target_record.version != target_version:
            # Target record not found (shouldn't happen, but defensive)
            return ReconstructionResult(found=False, content=None)

        if target_record.content_snapshot is not None:
            # Target is a SNAPSHOT - return directly, no traversal needed
            return ReconstructionResult(found=True, content=target_record.content_snapshot)

        # Step 6: Remove target from processing list (we don't apply target's diff)
        # Target's diff transforms target content → target-1 content, which we don't want
        records_to_traverse = records[:-1]  # Exclude target record

        # Step 7: Find nearest snapshot (lowest version = closest to target)
        # Records are DESC, so "last" snapshot in iteration = lowest version
        snapshot_indices = [
            i
            for i, r in enumerate(records_to_traverse)
            if r.diff_type == DiffType.SNAPSHOT.value and r.content_snapshot is not None
        ]

        if snapshot_indices:
            # Start from nearest snapshot (lowest version, last in DESC order)
            last_snapshot_idx = snapshot_indices[-1]
            content = records_to_traverse[last_snapshot_idx].content_snapshot
            # Only process records FROM the snapshot onwards (it and lower versions)
            records_to_process = records_to_traverse[last_snapshot_idx:]
        else:
            # No snapshot found - start from entity.content
            content = entity.content
            records_to_process = records_to_traverse

        # Step 8: Apply reverse diffs to reach target version
        warnings: list[str] = []

        for record in records_to_process:
            # Apply content_diff to traverse backwards
            # content_diff transforms version N content → version N-1 content
            if record.content_diff:
                try:
                    patches = self.dmp.patch_fromText(record.content_diff)
                    new_content, results = self.dmp.patch_apply(patches, content or "")
                    if not all(results):
                        warning_msg = f"Partial patch failure at v{record.version}"
                        warnings.append(warning_msg)
                        logger.warning(
                            "Diff application partial failure for %s/%s v%d: %s",
                            entity_type_value,
                            entity_id,
                            record.version,
                            results,
                        )
                    content = new_content
                except (ValueError, Exception) as e:
                    # Corrupted diff text - log warning and continue with current content
                    warning_msg = f"Corrupted diff at v{record.version}: {e}"
                    warnings.append(warning_msg)
                    logger.warning(
                        "Corrupted diff for %s/%s v%d: %s",
                        entity_type_value,
                        entity_id,
                        record.version,
                        e,
                    )
                    # Content passes through unchanged when diff is corrupted
            # If content_diff is None (CREATE, DELETE, METADATA), no transformation needed
            # Content passes through unchanged

        return ReconstructionResult(
            found=True,
            content=content,
            warnings=warnings if warnings else None,
        )

    async def get_history_at_version(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
        version: int,
    ) -> ContentHistory | None:
        """
        Get the history record at a specific version.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.
            version: Version number to retrieve.

        Returns:
            ContentHistory record if found, None otherwise.
        """
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )
        stmt = select(ContentHistory).where(
            ContentHistory.user_id == user_id,
            ContentHistory.entity_type == entity_type_value,
            ContentHistory.entity_id == entity_id,
            ContentHistory.version == version,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def delete_entity_history(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
    ) -> int:
        """
        Delete all history for an entity.

        Called during hard delete to cascade-delete history at application level.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.

        Returns:
            Number of deleted records.
        """
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )
        stmt = delete(ContentHistory).where(
            ContentHistory.user_id == user_id,
            ContentHistory.entity_type == entity_type_value,
            ContentHistory.entity_id == entity_id,
        )
        result = await db.execute(stmt)
        return result.rowcount

    async def _get_entity(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: str,
        entity_id: UUID,
        include_deleted: bool = False,
    ) -> Bookmark | Note | Prompt | None:
        """
        Get entity by type and ID for reconstruction anchor.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity (string value).
            entity_id: ID of the entity.
            include_deleted: If True, returns soft-deleted entities too.

        Returns:
            Entity if found, None otherwise.
        """
        model_map: dict[str, type[Bookmark] | type[Note] | type[Prompt]] = {
            "bookmark": Bookmark,
            "note": Note,
            "prompt": Prompt,
        }
        model = model_map.get(entity_type)
        if model is None:
            return None

        filters = [model.user_id == user_id, model.id == entity_id]
        if not include_deleted:
            filters.append(model.deleted_at.is_(None))

        stmt = select(model).where(*filters)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_latest_version(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: str,
        entity_id: UUID,
    ) -> int | None:
        """
        Get the latest version number for an entity.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.

        Returns:
            Latest version number, or None if no history exists.
        """
        stmt = select(func.max(ContentHistory.version)).where(
            ContentHistory.user_id == user_id,
            ContentHistory.entity_type == entity_type,
            ContentHistory.entity_id == entity_id,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_next_version(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: str,
        entity_id: UUID,
    ) -> int:
        """
        Get the next version number for an entity.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.

        Returns:
            Next version number (1 if no history exists).
        """
        max_version = await self._get_latest_version(
            db, user_id, entity_type, entity_id,
        )
        return (max_version or 0) + 1


# Singleton instance for use throughout the application
history_service = HistoryService()
