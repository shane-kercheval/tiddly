"""
Base service class for entity CRUD operations.

Provides shared logic for Bookmark, Note, and future entity types (Todo).
Entity-specific behavior is defined via abstract methods and class attributes.
"""
import secrets
from abc import ABC, abstractmethod
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, Protocol, TypeVar
from uuid import UUID

from sqlalchemy import Column, Table, and_, exists, func, or_, select
from sqlalchemy.sql import Select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, selectinload

from core.request_context import RequestContext
from core.tier_limits import TierLimits
from models.content_history import ActionType, EntityType
from models.tag import Tag
from schemas.content import ViewOption
from schemas.validators import validate_and_normalize_tags
from services import relationship_service
from services.exceptions import InvalidStateError

if TYPE_CHECKING:
    from services.history_service import HistoryService


# Preview length for content_preview field (characters)
CONTENT_PREVIEW_LENGTH = 500


def _generate_public_token() -> str:
    """
    Generate an unguessable share token (256 bits of entropy), stored plaintext.

    Unlike PATs (hashed at rest, see ``token_service``), the public token IS the
    URL — an unguessable URL component, not a credential — so lookups are a
    plaintext equality match on ``public_token`` (see ``public_item_service``).
    ``token_urlsafe(32)`` yields a ~43-char url-safe string, well within the
    column's 64-char limit. Lives here, beside the publish/rotate writers that
    are its only callers, so the foundational base service needn't import the
    public-read feature module.
    """
    return secrets.token_urlsafe(32)


class TaggableEntity(Protocol):
    """Protocol defining the interface for entities that support tagging and soft-delete."""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime
    deleted_at: datetime | None
    archived_at: datetime | None
    is_public: bool
    public_token: str | None
    shared_at: datetime | None
    tag_objects: list

    @property
    def is_archived(self) -> bool:
        """Check if entity is currently archived."""
        ...


T = TypeVar("T", bound=TaggableEntity)


class BaseEntityService[T: TaggableEntity](ABC):
    """
    Abstract base class for entity CRUD operations.

    Subclasses must define:
    - model: The SQLAlchemy model class
    - junction_table: The tag junction table (e.g., bookmark_tags)
    - entity_name: Human-readable name for error messages (e.g., "Bookmark")

    Search is handled by search_all_content() in content_service.py.
    Individual list endpoints route through it with content_types=[type].

    Note: create() is NOT in base class - it has entity-specific logic
    (e.g., bookmark URL uniqueness checks).
    """

    # Class attributes to be defined by subclasses
    model: type[T]
    junction_table: Table
    entity_name: str  # For error messages: "Bookmark", "Note", etc.

    # --- Helper Methods ---

    def _get_junction_entity_id_column(self) -> Column[Any]:
        """Get the entity ID column from the junction table (e.g., bookmark_id, note_id)."""
        junction_columns = [c.name for c in self.junction_table.columns if c.name != "tag_id"]
        return self.junction_table.c[junction_columns[0]]

    async def _refresh_with_tags(self, db: AsyncSession, entity: T) -> None:
        """Refresh entity and eagerly load tag_objects relationship."""
        await db.refresh(entity)
        await db.refresh(entity, attribute_names=["tag_objects"])

    @staticmethod
    def _attach_content_length(entity: Any) -> None:
        """
        Compute and attach `content_length` from the in-memory `content` field.

        Used by read paths that already load full content (`get`,
        `get_for_update`, and the prompt-by-name variants). Cheaper than a SQL
        `length()` call when we have the bytes in Python already, and handles
        empty strings correctly (len("") == 0, not None).
        """
        if entity is None:
            return
        content = getattr(entity, "content", None)
        entity.content_length = len(content) if content is not None else None

    # --- Abstract Methods (entity-specific) ---

    @abstractmethod
    async def check_quota(
        self,
        db: AsyncSession,
        user_id: UUID,
        limits: TierLimits,
    ) -> None:
        """
        Check if user has quota to create a new item.

        Each subclass implements this with the appropriate limit attribute
        (max_bookmarks, max_notes, max_prompts).

        Args:
            db: Database session.
            user_id: User ID to check quota for.
            limits: User's tier limits.

        Raises:
            QuotaExceededError: If user is at or over their item limit.
        """
        ...

    @property
    @abstractmethod
    def entity_type(self) -> EntityType:
        """Return the EntityType for this service (BOOKMARK, NOTE, or PROMPT)."""
        ...

    def _get_audit_metadata(self, entity: T) -> dict:
        """
        Get minimal metadata for audit actions (identifying fields only).

        Returns all available identifying fields so frontend can display
        the best available option.
        """
        metadata: dict[str, str] = {}
        for field in ("title", "name", "url"):
            value = getattr(entity, field, None)
            if value:
                metadata[field] = value
        return metadata

    async def get_metadata_snapshot(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity: T,
        *,
        relationships_override: list[dict] | None = None,
    ) -> dict:
        """
        Extract non-content fields for history metadata snapshot.

        Returns common fields (title, description, tags, relationships).
        Subclasses should override to add entity-specific fields (e.g., url for bookmarks).

        Args:
            db: Database session.
            user_id: User ID for relationship queries.
            entity: The entity to extract metadata from.
            relationships_override: If provided, use this instead of querying the database.
                Used to skip redundant queries when relationships are known unchanged.

        Returns:
            Dictionary of metadata fields.
        """
        snapshot = {
            "title": getattr(entity, "title", None),
            "description": getattr(entity, "description", None),
            "tags": (
                sorted(
                    [{"id": str(t.id), "name": t.name} for t in entity.tag_objects],
                    key=lambda t: t["name"],
                )
                if hasattr(entity, "tag_objects") else []
            ),
        }
        if relationships_override is not None:
            snapshot["relationships"] = relationships_override
        else:
            snapshot["relationships"] = await relationship_service.get_relationships_snapshot(
                db, user_id, self.entity_type, entity.id,
            )
        return snapshot

    @staticmethod
    def _metadata_field_changed(key: str, prev: Any, curr: Any) -> bool:
        """Check if a single metadata field changed between previous and current values."""
        if key == "tags":
            def _tag_name(t: Any) -> str:
                return t.get("name", "") if isinstance(t, dict) else str(t)
            prev_names = sorted(_tag_name(t) for t in (prev or []))
            curr_names = sorted(_tag_name(t) for t in (curr or []))
            return prev_names != curr_names
        if key == "relationships":
            def _rel_key(r: dict) -> tuple:
                return (
                    r.get("target_type"),
                    str(r.get("target_id")),
                    r.get("relationship_type"),
                    r.get("description"),
                )
            prev_set = {_rel_key(r) for r in (prev or [])}
            curr_set = {_rel_key(r) for r in (curr or [])}
            return prev_set != curr_set
        if key == "arguments":
            prev_sorted = sorted((prev or []), key=lambda a: a.get("name", ""))
            curr_sorted = sorted((curr or []), key=lambda a: a.get("name", ""))
            return prev_sorted != curr_sorted
        return prev != curr

    @staticmethod
    def _compute_changed_fields(
        previous_metadata: dict | None,
        current_metadata: dict,
        content_changed: bool,
    ) -> list[str]:
        """
        Compute which fields changed between previous and current state.

        For CREATE (previous_metadata is None), includes all non-empty/non-default fields.

        Args:
            previous_metadata: Metadata before the change (None for CREATE).
            current_metadata: Metadata after the change.
            content_changed: Whether entity content changed.

        Returns:
            Sorted list of changed field names.
        """
        changed: set[str] = set()

        if content_changed:
            changed.add("content")

        if previous_metadata is None:
            # CREATE: include all non-empty fields
            for key, value in current_metadata.items():
                if key.startswith("_"):
                    continue
                if value is None or value in ("", []):
                    continue
                changed.add(key)
            return sorted(changed)

        # Compare each metadata field
        for key in set(previous_metadata.keys()) | set(current_metadata.keys()):
            if key.startswith("_"):
                continue
            prev = previous_metadata.get(key)
            curr = current_metadata.get(key)
            if BaseEntityService._metadata_field_changed(key, prev, curr):
                changed.add(key)

        return sorted(changed)

    def _get_history_service(self) -> "HistoryService":
        """Get the history service instance. Lazy import to avoid circular dependency."""
        from services.history_service import history_service  # noqa: PLC0415
        return history_service

    # --- Common CRUD Operations ---

    async def get(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        include_deleted: bool = False,
        include_archived: bool = False,
    ) -> T | None:
        """
        Get an entity by ID, scoped to user.

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to retrieve.
            include_deleted: If True, include soft-deleted entities. Default False.
            include_archived: If True, include archived entities. Default False.

        Returns:
            The entity if found and matches filters, None otherwise.
        """
        query = (
            select(self.model)
            .options(selectinload(self.model.tag_objects))
            .where(
                self.model.id == entity_id,
                self.model.user_id == user_id,
            )
        )

        if not include_deleted:
            query = query.where(self.model.deleted_at.is_(None))
        if not include_archived:
            query = query.where(~self.model.is_archived)

        result = await db.execute(query)
        entity = result.scalar_one_or_none()
        self._attach_content_length(entity)
        return entity

    async def get_for_update(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        *,
        include_archived: bool = False,
    ) -> T | None:
        """
        Fetch an entity and acquire a `SELECT ... FOR UPDATE` row lock.

        MUST be called inside a transaction. The lock is held until the
        transaction commits or rolls back. Use only when the same request
        will issue an UPDATE on the returned entity (e.g., the str-replace
        endpoints). For read-only access use `get(...)` instead.

        Soft-deleted entities are always excluded (str-replace never operates
        on them). Tags are intentionally NOT eager-loaded: str-replace does
        not need `tag_objects` at fetch time. Handlers that serialize the
        entity (or record metadata snapshots) call
        `db.refresh(entity, attribute_names=["tag_objects"])` after the
        write flush.

        Args:
            db: Database session (must be inside an open transaction).
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to retrieve.
            include_archived: If True, include archived entities. Default False.

        Returns:
            The entity if found and matches filters, None otherwise.
        """
        query = (
            select(self.model)
            .where(
                self.model.id == entity_id,
                self.model.user_id == user_id,
                self.model.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if not include_archived:
            query = query.where(~self.model.is_archived)

        result = await db.execute(query)
        entity = result.scalar_one_or_none()
        self._attach_content_length(entity)
        return entity

    async def get_metadata(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        include_deleted: bool = False,
        include_archived: bool = False,
    ) -> T | None:
        """
        Get entity metadata without loading full content.

        Returns content_length and content_preview (computed in SQL).
        The content field is set to None to prevent accidental loading.

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to retrieve.
            include_deleted: If True, include soft-deleted entities. Default False.
            include_archived: If True, include archived entities. Default False.

        Returns:
            The entity with metadata fields populated, or None if not found.
        """
        # Select entity with computed content metrics, excluding full content from SELECT.
        # defer() prevents SQLAlchemy from loading the content column, while
        # func.length/func.left compute the metrics directly in PostgreSQL.
        query = (
            select(
                self.model,
                func.length(self.model.content).label("content_length"),
                func.left(self.model.content, CONTENT_PREVIEW_LENGTH).label("content_preview"),
            )
            .options(
                defer(self.model.content),  # Exclude content from SELECT
                selectinload(self.model.tag_objects),
            )
            .where(
                self.model.id == entity_id,
                self.model.user_id == user_id,
            )
        )

        if not include_deleted:
            query = query.where(self.model.deleted_at.is_(None))
        if not include_archived:
            query = query.where(~self.model.is_archived)

        result = await db.execute(query)
        row = result.first()

        if row is None:
            return None

        entity, content_length, content_preview = row
        entity.content_length = content_length
        entity.content_preview = content_preview
        return entity

    async def delete(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        permanent: bool = False,
        context: RequestContext | None = None,
        limits: TierLimits | None = None,
    ) -> bool:
        """
        Delete an entity (soft or permanent).

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to delete.
            permanent: If False, soft delete. If True, permanent delete.
            context: Request context for history recording. If None, history is skipped.
            limits: User's tier limits for count-based pruning. If None, pruning is skipped.

        Returns:
            True if deleted, False if not found.
        """
        entity = await self.get(
            db, user_id, entity_id, include_deleted=permanent, include_archived=True,
        )
        if entity is None:
            return False

        if permanent:
            # Hard delete: cascade-delete history first (application-level cascade)
            await self._get_history_service().delete_entity_history(
                db, user_id, self.entity_type, entity_id,
            )
            # Clean up content relationships
            await relationship_service.delete_relationships_for_content(
                db, user_id, self.entity_type, entity_id,
            )
            await db.delete(entity)
        else:
            # Soft delete: audit record (no content, no version)
            if context:
                await self._get_history_service().record_action(
                    db=db,
                    user_id=user_id,
                    entity_type=self.entity_type,
                    entity_id=entity_id,
                    action=ActionType.DELETE,
                    current_content=None,
                    previous_content=None,
                    metadata=self._get_audit_metadata(entity),
                    context=context,
                    limits=limits,
                )
            entity.deleted_at = func.now()
            await db.flush()

        return True

    async def restore(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        context: RequestContext | None = None,
        limits: TierLimits | None = None,
    ) -> T | None:
        """
        Restore a soft-deleted entity to active state.

        Clears both deleted_at AND archived_at timestamps.

        Note: No quota check is needed because soft-deleted items already
        count toward the user's quota. Restoring just changes state, it
        doesn't add a new item.

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to restore.
            context: Request context for history recording. If None, history is skipped.
            limits: User's tier limits for count-based pruning. If None, pruning is skipped.

        Returns:
            The restored entity, or None if not found.

        Raises:
            InvalidStateError: If the entity is not deleted.
        """
        # Find the entity (must be deleted)
        result = await db.execute(
            select(self.model)
            .options(selectinload(self.model.tag_objects))
            .where(
                self.model.id == entity_id,
                self.model.user_id == user_id,
                self.model.deleted_at.is_not(None),
            ),
        )
        entity = result.scalar_one_or_none()

        if entity is None:
            # Check if entity exists but is not deleted
            non_deleted = await self.get(db, user_id, entity_id, include_archived=True)
            if non_deleted is not None:
                raise InvalidStateError(f"{self.entity_name} is not deleted")
            return None

        # Record history BEFORE restoring (captures pre-restore state)
        # UNDELETE is an audit action - no content, no version
        if context:
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=entity_id,
                action=ActionType.UNDELETE,
                current_content=None,
                previous_content=None,
                metadata=self._get_audit_metadata(entity),
                context=context,
                limits=limits,
            )

        # Restore: clear both deleted_at and archived_at
        entity.deleted_at = None
        entity.archived_at = None
        await db.flush()
        await self._refresh_with_tags(db, entity)
        return entity

    async def archive(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        context: RequestContext | None = None,
        limits: TierLimits | None = None,
    ) -> T | None:
        """
        Archive an entity by setting archived_at timestamp.

        This operation is idempotent. History is only recorded on state change.

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to archive.
            context: Request context for history recording. If None, history is skipped.
            limits: User's tier limits for count-based pruning. If None, pruning is skipped.

        Returns:
            The archived entity, or None if not found.
        """
        entity = await self.get(db, user_id, entity_id, include_archived=True)
        if entity is None:
            return None

        if not entity.is_archived:
            # Record history BEFORE archiving
            # ARCHIVE is an audit action - no content, no version
            if context:
                await self._get_history_service().record_action(
                    db=db,
                    user_id=user_id,
                    entity_type=self.entity_type,
                    entity_id=entity_id,
                    action=ActionType.ARCHIVE,
                    current_content=None,
                    previous_content=None,
                    metadata=self._get_audit_metadata(entity),
                    context=context,
                    limits=limits,
                )
            entity.archived_at = func.now()
            await db.flush()
            await db.refresh(entity)

        return entity

    async def unarchive(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        context: RequestContext | None = None,
        limits: TierLimits | None = None,
    ) -> T | None:
        """
        Unarchive an entity by clearing archived_at timestamp.

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to unarchive.
            context: Request context for history recording. If None, history is skipped.
            limits: User's tier limits for count-based pruning. If None, pruning is skipped.

        Returns:
            The unarchived entity, or None if not found.

        Raises:
            InvalidStateError: If the entity is not archived.
        """
        # Find archived entity
        result = await db.execute(
            select(self.model)
            .options(selectinload(self.model.tag_objects))
            .where(
                self.model.id == entity_id,
                self.model.user_id == user_id,
                self.model.deleted_at.is_(None),
                self.model.is_archived,
            ),
        )
        entity = result.scalar_one_or_none()

        if entity is None:
            # Check if entity exists but is not archived
            non_archived = await self.get(db, user_id, entity_id)
            if non_archived is not None:
                raise InvalidStateError(f"{self.entity_name} is not archived")
            return None

        # Record history BEFORE unarchiving
        # UNARCHIVE is an audit action - no content, no version
        if context:
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=entity_id,
                action=ActionType.UNARCHIVE,
                current_content=None,
                previous_content=None,
                metadata=self._get_audit_metadata(entity),
                context=context,
                limits=limits,
            )

        entity.archived_at = None
        await db.flush()
        await self._refresh_with_tags(db, entity)
        return entity

    async def set_share_state(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        *,
        enabled: bool,
    ) -> T | None:
        """
        Publish or unpublish an item, writing only the sharing columns.

        Publishing mints a ``public_token`` if the item has none and sets
        ``is_public = True``; a previously-shared item keeps its token, so
        re-publishing restores the same URL. Unpublishing sets ``is_public =
        False`` and leaves the token in place.

        Sharing is NOT a content change: ``updated_at`` is never assigned and no
        ``ContentHistory`` is recorded. ``updated_at`` is bumped only by explicit
        assignment inside ``update()`` (no column-level ``onupdate``), so leaving
        it unassigned preserves the prior value. Soft-deleted items are not
        shareable (excluded by ``get()``); archived items are.

        Args:
            db: Database session.
            user_id: User ID to scope the entity (owner only).
            entity_id: ID of the entity to publish/unpublish.
            enabled: True to publish, False to unpublish.

        Returns:
            The updated entity (tags eager-loaded), or None if not found.
        """
        entity = await self.get(db, user_id, entity_id, include_archived=True)
        if entity is None:
            return None

        if enabled:
            if entity.public_token is None:
                entity.public_token = _generate_public_token()
            entity.is_public = True
            # "Shared since" timestamp for the owner's shared-content view. Stamped
            # on each publish; left in place on unpublish. A distinct column from
            # updated_at, so this does not make the item look freshly edited.
            entity.shared_at = func.now()
        else:
            entity.is_public = False

        await db.flush()
        await self._refresh_with_tags(db, entity)
        return entity

    async def rotate_share_token(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
    ) -> T | None:
        """
        Issue a brand-new share token, permanently invalidating the previous URL.

        Works regardless of ``is_public`` state — a user may pre-rotate while
        unpublished to pre-empt a stale link before re-sharing. Only
        ``public_token`` is written; ``is_public`` is left unchanged. Like
        publish/unpublish, this does not bump ``updated_at`` or record history.

        The partial unique index on ``public_token`` would surface a generated
        collision as an ``IntegrityError``; at 256 bits of entropy this is
        astronomically unlikely, so it is intentionally left to surface rather
        than swallowed.

        Args:
            db: Database session.
            user_id: User ID to scope the entity (owner only).
            entity_id: ID of the entity to rotate.

        Returns:
            The updated entity (tags eager-loaded), or None if not found.
        """
        entity = await self.get(db, user_id, entity_id, include_archived=True)
        if entity is None:
            return None

        entity.public_token = _generate_public_token()
        await db.flush()
        await self._refresh_with_tags(db, entity)
        return entity

    async def track_usage(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
    ) -> bool:
        """
        Update last_used_at timestamp for an entity.

        Works on active, archived, and deleted entities.

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity to track usage for.

        Returns:
            True if updated, False if not found.
        """
        entity = await self.get(
            db, user_id, entity_id, include_archived=True, include_deleted=True,
        )
        if entity is None:
            return False

        entity.last_used_at = func.clock_timestamp()
        await db.flush()
        return True

    async def get_updated_at(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        include_deleted: bool = False,
    ) -> datetime | None:
        """
        Get just the updated_at timestamp for an entity.

        This is a lightweight query for HTTP cache validation (Last-Modified).
        Returns None if entity not found (or deleted, unless include_deleted=True).

        Args:
            db: Database session.
            user_id: User ID to scope the entity.
            entity_id: ID of the entity.
            include_deleted: If True, include soft-deleted entities. Default False.

        Returns:
            The updated_at timestamp, or None if not found.
        """
        stmt = select(self.model.updated_at).where(
            self.model.id == entity_id,
            self.model.user_id == user_id,
        )
        if not include_deleted:
            stmt = stmt.where(self.model.deleted_at.is_(None))
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def count_user_items(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> int:
        """
        Count ALL items for a user (active + archived + soft-deleted).

        Used for quota enforcement - all rows count toward limits.
        Users can only free quota by permanently deleting items.

        Args:
            db: Database session.
            user_id: User ID to count items for.

        Returns:
            Total count of all items for the user.
        """
        stmt = select(func.count()).where(self.model.user_id == user_id)
        result = await db.execute(stmt)
        return result.scalar() or 0

    # --- Private Helper Methods ---

    def _apply_view_filter(
        self,
        query: Select[tuple[T]],
        view: set[ViewOption],
    ) -> Select[tuple[T]]:
        """Apply view filter (active/archived/deleted) to query."""
        if not view:
            raise ValueError("view must contain at least one option")
        view_conditions = []
        if "active" in view:
            view_conditions.append(and_(self.model.deleted_at.is_(None), ~self.model.is_archived))
        if "archived" in view:
            view_conditions.append(and_(self.model.deleted_at.is_(None), self.model.is_archived))
        if "deleted" in view:
            view_conditions.append(self.model.deleted_at.is_not(None))
        if view_conditions:
            query = query.where(or_(*view_conditions))
        return query

    def _apply_tag_filter(
        self,
        query: Select[tuple[T]],
        user_id: UUID,
        tags: list[str],
        tag_match: Literal["all", "any"],
    ) -> Select[tuple[T]]:
        """Apply tag filter to query."""
        normalized_tags = validate_and_normalize_tags(tags)
        if not normalized_tags:
            return query

        junction_entity_id_col = self._get_junction_entity_id_column()

        if tag_match == "all":
            # Must have ALL specified tags
            for tag_name in normalized_tags:
                subq = (
                    select(junction_entity_id_col)
                    .join(Tag, self.junction_table.c.tag_id == Tag.id)
                    .where(
                        junction_entity_id_col == self.model.id,
                        Tag.name == tag_name,
                        Tag.user_id == user_id,
                    )
                )
                query = query.where(exists(subq))
        else:
            # Must have ANY of the specified tags
            subq = (
                select(junction_entity_id_col)
                .join(Tag, self.junction_table.c.tag_id == Tag.id)
                .where(
                    junction_entity_id_col == self.model.id,
                    Tag.name.in_(normalized_tags),
                    Tag.user_id == user_id,
                )
            )
            query = query.where(exists(subq))

        return query

