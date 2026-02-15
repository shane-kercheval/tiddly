"""Service layer for content history recording and reconstruction."""
import logging
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from diff_match_patch import diff_match_patch
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import RequestContext
from core.tier_limits import TierLimits
from models.bookmark import Bookmark
from models.content_history import ActionType, ContentHistory, EntityType
from models.note import Note
from models.prompt import Prompt

logger = logging.getLogger(__name__)

# Full snapshot every N versions (enables reconstruction optimization)
SNAPSHOT_INTERVAL = 10

# Check count-based pruning every N writes to avoid per-write COUNT overhead
PRUNE_CHECK_INTERVAL = 10


@dataclass
class ReconstructionResult:
    """Result of content reconstruction at a version."""

    found: bool  # Whether the version exists
    content: str | None  # Content at that version (None is valid for some actions)
    warnings: list[str] | None = None  # Warnings if reconstruction had issues


@dataclass
class DiffResult:
    """Result of version diff computation."""

    found: bool
    before_content: str | None = None
    after_content: str | None = None
    before_metadata: dict | None = None
    after_metadata: dict | None = None
    warnings: list[str] | None = None


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
        limits: TierLimits | None = None,
        changed_fields: list[str] | None = None,
    ) -> ContentHistory:
        """
        Record a history entry for an action.

        Uses savepoint-based retry for race conditions on version allocation.
        This ensures the parent entity change is not rolled back if history
        insert fails due to version uniqueness violation.

        After successful insert, performs count-based pruning if limits are
        provided and the version number triggers a check (every 10th write).

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
            limits: User's tier limits for count-based pruning. If None, pruning is skipped.
            changed_fields: List of field names that changed (e.g. ["content", "title"]).

        Returns:
            The created ContentHistory record.

        Raises:
            IntegrityError: If max retries exceeded on version collision.
        """
        max_retries = 3
        last_error: IntegrityError | None = None
        history: ContentHistory | None = None

        for attempt in range(max_retries):
            try:
                async with db.begin_nested():  # Creates savepoint
                    history = await self._record_action_impl(
                        db,
                        user_id,
                        entity_type,
                        entity_id,
                        action,
                        current_content,
                        previous_content,
                        metadata,
                        context,
                        changed_fields,
                    )
                    break  # Success - exit retry loop
            except IntegrityError as e:
                last_error = e
                # Only retry on version uniqueness violations
                if "uq_content_history_version" not in str(e):
                    raise  # Re-raise other integrity errors immediately
                # Savepoint automatically rolled back, parent transaction intact
                if attempt == max_retries - 1:
                    raise
                # Continue to retry with new version number

        if history is None:
            # Should not reach here, but satisfy type checker
            if last_error:
                raise last_error
            raise RuntimeError("Unexpected state in record_action")

        # Count-based pruning: check every 10th write (only for versioned records)
        if (
            limits is not None
            and history.version is not None
            and history.version % PRUNE_CHECK_INTERVAL == 0
        ):
            entity_type_value = (
                entity_type.value if isinstance(entity_type, EntityType) else entity_type
            )
            count = await self._get_entity_history_count(
                db, user_id, entity_type_value, entity_id,
            )
            if count > limits.max_history_per_entity:
                await self._prune_to_limit(
                    db, user_id, entity_type_value, entity_id,
                    target=limits.max_history_per_entity,
                )

        return history

    # Audit actions: lifecycle state transitions that don't affect content
    AUDIT_ACTIONS = frozenset({
        ActionType.DELETE.value,
        ActionType.UNDELETE.value,
        ActionType.ARCHIVE.value,
        ActionType.UNARCHIVE.value,
    })

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
        changed_fields: list[str] | None = None,
    ) -> ContentHistory:
        """Internal implementation of record_action."""
        # Convert enums to strings if needed
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )
        action_value = action.value if isinstance(action, ActionType) else action

        # Determine version, content_snapshot, and content_diff
        # The change type is derived from these columns:
        #   version IS NULL → audit action
        #   action = 'create' → create (content_snapshot set, no diff)
        #   content_diff IS NOT NULL → content change
        #   else → metadata-only change
        content_snapshot: str | None = None
        content_diff: str | None = None

        if action_value in self.AUDIT_ACTIONS:
            # Audit actions: lifecycle state transitions (no content, no version)
            version: int | None = None
        elif action_value == ActionType.CREATE.value:
            # CREATE: Store initial content as snapshot, no diff (no previous version)
            content_snapshot = current_content
            version = await self._get_next_version(db, user_id, entity_type_value, entity_id)
        elif previous_content == current_content:
            # Content unchanged - metadata-only change (tags, title, etc.)
            version = await self._get_next_version(db, user_id, entity_type_value, entity_id)
            if version % SNAPSHOT_INTERVAL == 0:
                content_snapshot = current_content  # Guarantee bounded reconstruction
        else:
            # UPDATE/RESTORE with content change
            version = await self._get_next_version(db, user_id, entity_type_value, entity_id)
            patches = self.dmp.patch_make(current_content or "", previous_content or "")
            content_diff = self.dmp.patch_toText(patches)
            if version % SNAPSHOT_INTERVAL == 0:
                content_snapshot = current_content  # Periodic snapshot

        history = ContentHistory(
            user_id=user_id,
            entity_type=entity_type_value,
            entity_id=entity_id,
            action=action_value,
            version=version,
            content_snapshot=content_snapshot,
            content_diff=content_diff,
            metadata_snapshot=metadata,
            changed_fields=changed_fields,
            source=context.source,
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

        # Data query (order by created_at since audit events have NULL version)
        stmt = (
            select(ContentHistory)
            .where(
                ContentHistory.user_id == user_id,
                ContentHistory.entity_type == entity_type_value,
                ContentHistory.entity_id == entity_id,
            )
            .order_by(ContentHistory.created_at.desc(), ContentHistory.id.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(stmt)
        return list(result.scalars().all()), total

    async def get_user_history(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_types: list[EntityType | str] | None = None,
        actions: list[ActionType | str] | None = None,
        sources: list[str] | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ContentHistory], int]:
        """
        Get all history for a user.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_types: Optional filter by entity types (OR logic within).
            actions: Optional filter by action types (OR logic within).
            sources: Optional filter by sources (OR logic within).
            start_date: Optional filter for records on or after this datetime.
            end_date: Optional filter for records on or before this datetime.
            limit: Maximum records to return.
            offset: Number of records to skip.

        Returns:
            Tuple of (history records, total count).

        Note:
            Empty lists are treated as "no filter" (show all) since bool([]) is False.
        """
        # Build base conditions
        conditions = [ContentHistory.user_id == user_id]

        if entity_types:
            entity_type_values = [
                e.value if isinstance(e, EntityType) else e for e in entity_types
            ]
            conditions.append(ContentHistory.entity_type.in_(entity_type_values))

        if actions:
            action_values = [
                a.value if isinstance(a, ActionType) else a for a in actions
            ]
            conditions.append(ContentHistory.action.in_(action_values))

        if sources:
            conditions.append(ContentHistory.source.in_(sources))

        if start_date:
            conditions.append(ContentHistory.created_at >= start_date)

        if end_date:
            conditions.append(ContentHistory.created_at <= end_date)

        # Count query
        count_stmt = select(func.count()).select_from(ContentHistory).where(*conditions)
        total = (await db.execute(count_stmt)).scalar_one()

        # Data query
        stmt = (
            select(ContentHistory)
            .where(*conditions)
            .order_by(ContentHistory.created_at.desc(), ContentHistory.id.desc())
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
                # SNAPSHOT record (CREATE/periodic) - use stored snapshot
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
        # Any record with content_snapshot set can serve as an anchor point
        snapshot_indices = [
            i
            for i, r in enumerate(records_to_traverse)
            if r.content_snapshot is not None
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
                except ValueError as e:
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

    async def get_version_diff(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
        version: int,
    ) -> DiffResult:
        """
        Compute diff between version N and its predecessor N-1.

        Returns before/after content and metadata. For CREATE (v1), before fields
        are None. For metadata-only changes, content fields are both None.

        Invariant: content_diff at version N is a reverse diff (N -> N-1),
        produced by patch_make(current_content, previous_content). Applying
        it to version N's content yields version N-1's content.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity.
            entity_id: ID of the entity.
            version: Version number to compute diff for.

        Returns:
            DiffResult with before/after content and metadata.
        """
        # 1. Get version N's history record
        # Audit records (DELETE, UNDELETE, etc.) have NULL versions, so they
        # are naturally excluded — get_history_at_version filters by int version.
        after_history = await self.get_history_at_version(
            db, user_id, entity_type, entity_id, version,
        )
        if after_history is None:
            return DiffResult(found=False)

        content_diff_exists = after_history.content_diff is not None
        is_create = after_history.action == ActionType.CREATE.value
        # Reconstruct content when it changed OR for CREATE (initial content, no diff)
        needs_content = content_diff_exists or is_create

        after_content: str | None = None
        before_content: str | None = None
        warnings: list[str] | None = None

        if needs_content:
            # 2. Reuse existing tested reconstruction for "after" content
            after_result = await self.reconstruct_content_at_version(
                db, user_id, entity_type, entity_id, version,
            )
            if not after_result.found:
                return DiffResult(found=False)
            after_content = after_result.content
            warnings = after_result.warnings

            # 3. Derive "before" content from version N's reverse diff
            #    (only when content actually changed — not for CREATE)
            if content_diff_exists and version > 1:
                try:
                    patches = self.dmp.patch_fromText(after_history.content_diff)
                    patched_content, results = self.dmp.patch_apply(
                        patches, after_content or "",
                    )
                    if not all(results):
                        warning_msg = (
                            f"Partial patch failure deriving before-content at v{version}"
                        )
                        if warnings is None:
                            warnings = []
                        warnings.append(warning_msg)
                        logger.warning(
                            "Before-content derivation partial failure for v%d: %s",
                            version,
                            results,
                        )
                    before_content = patched_content
                except ValueError as e:
                    warning_msg = (
                        f"Corrupted diff at v{version}, cannot derive before-content: {e}"
                    )
                    if warnings is None:
                        warnings = []
                    warnings.append(warning_msg)
                    logger.warning(
                        "Corrupted diff deriving before-content for v%d: %s",
                        version,
                        e,
                    )
                    # before_content remains None — after_content still valid

        # 4. Get "before" metadata from version N-1's record
        before_metadata: dict | None = None
        if version > 1:
            before_history = await self.get_history_at_version(
                db, user_id, entity_type, entity_id, version - 1,
            )
            before_metadata = before_history.metadata_snapshot if before_history else None

        return DiffResult(
            found=True,
            after_content=after_content,
            before_content=before_content,
            after_metadata=after_history.metadata_snapshot,
            before_metadata=before_metadata,
            warnings=warnings,
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

    async def get_latest_version(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: EntityType | str,
        entity_id: UUID,
    ) -> int | None:
        """
        Get the latest version number for an entity.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity (EntityType enum or string).
            entity_id: ID of the entity.

        Returns:
            Latest version number, or None if no history exists.
        """
        entity_type_value = (
            entity_type.value if isinstance(entity_type, EntityType) else entity_type
        )
        stmt = select(func.max(ContentHistory.version)).where(
            ContentHistory.user_id == user_id,
            ContentHistory.entity_type == entity_type_value,
            ContentHistory.entity_id == entity_id,
            ContentHistory.version.isnot(None),
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    # Keep private alias for backward compatibility with internal callers
    _get_latest_version = get_latest_version

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

    async def _get_entity_history_count(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: str,
        entity_id: UUID,
    ) -> int:
        """
        Count versioned history records for an entity.

        Only counts records with non-null versions (content versions).
        Audit events (NULL version) are excluded since they don't count
        toward retention limits.

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity (string value).
            entity_id: ID of the entity.

        Returns:
            Number of versioned history records for this entity.
        """
        stmt = (
            select(func.count())
            .select_from(ContentHistory)
            .where(
                ContentHistory.user_id == user_id,
                ContentHistory.entity_type == entity_type,
                ContentHistory.entity_id == entity_id,
                ContentHistory.version.isnot(None),
            )
        )
        return (await db.execute(stmt)).scalar_one()

    async def _prune_to_limit(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_type: str,
        entity_id: UUID,
        target: int,
    ) -> int:
        """
        Prune oldest history records to reach target count.

        With REVERSE diffs and entity-anchored reconstruction, cleanup is simple:
        - We use entity.content as the reconstruction anchor (not snapshots in history)
        - Just delete the oldest records beyond the target count
        - No need to preserve any specific snapshots

        Args:
            db: Database session.
            user_id: ID of the user.
            entity_type: Type of entity (string value).
            entity_id: ID of the entity.
            target: Target number of records to keep (most recent).

        Returns:
            Number of records deleted.
        """
        # Find the version number at the cutoff point (keep 'target' most recent)
        # Only consider versioned records (audit events pruned by time only)
        cutoff_stmt = (
            select(ContentHistory.version)
            .where(
                ContentHistory.user_id == user_id,
                ContentHistory.entity_type == entity_type,
                ContentHistory.entity_id == entity_id,
                ContentHistory.version.isnot(None),
            )
            .order_by(ContentHistory.version.desc())
            .offset(target - 1)  # Keep 'target' most recent
            .limit(1)
        )
        result = await db.execute(cutoff_stmt)
        cutoff_version = result.scalar_one_or_none()

        if cutoff_version is None:
            return 0  # Not enough records to prune

        # Delete only versioned records older than cutoff
        # Audit events (NULL version) are not affected
        delete_stmt = delete(ContentHistory).where(
            ContentHistory.user_id == user_id,
            ContentHistory.entity_type == entity_type,
            ContentHistory.entity_id == entity_id,
            ContentHistory.version.isnot(None),
            ContentHistory.version < cutoff_version,
        )

        result = await db.execute(delete_stmt)
        return result.rowcount


# Singleton instance for use throughout the application
history_service = HistoryService()
