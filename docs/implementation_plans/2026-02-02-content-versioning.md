# Content Versioning / History Implementation

## Overview

Implement content versioning and history tracking for bookmarks, notes, and prompts. This enables users to see what changed, when, who/what initiated the change, and optionally undo operations.

**Jira Issue:** [KAN-61](https://tiddly.atlassian.net/browse/KAN-61)

**Key Requirements:**
1. Track actions (create/update/delete/restore/archive) with new records
2. User can view history for all content or specific items
3. Track what initiated the action (web/API/MCP) and auth type (Auth0/PAT)
4. Store git-style diffs for edits to reduce storage
5. Undo functionality for add/delete/edit operations
6. Tier-based retention limits (last N days or N edits)

**Documentation - Read before implementing:**
- diff-match-patch: https://github.com/google/diff-match-patch (Python port: `diff-match-patch` on PyPI)
- diff-match-patch API: https://github.com/google/diff-match-patch/wiki/API

---

## Architecture Decision: Unified ContentHistory Table

A single polymorphic `content_history` table for all content types (bookmarks, notes, prompts).

**Rationale:**
- Single table for all history queries - easier unified "all activity" views
- Consistent retention policies across entity types
- Simpler migrations and maintenance
- Polymorphic queries are straightforward with proper indexing

**Trade-off:** Larger table at scale, but acceptable for this use case.

**Note:** The existing `note_versions` table and `Note.version` column were designed for this purpose but never used. This plan supersedes them - Milestone 2 includes a migration to drop the unused schema.

---

## Diff Strategy: diff-match-patch

Use Google's diff-match-patch algorithm for text diffing:
- Store full snapshot every N versions (default: 10)
- Store character-level diffs between snapshots
- Reconstruct any version by: find nearest prior snapshot, apply diffs forward

**Storage approach:**
- `content_diff`: Full text (snapshot) OR diff-match-patch delta string (diff)
- `metadata_snapshot`: JSONB of non-content fields (title, description, tags, etc.) - always stored as snapshot since these are small

**Snapshot rules (when to store full content instead of diff):**
- CREATE actions (version 1)
- Every Nth version (default: 10)
- When `previous_content` is None
- When `current_content` is None
- When content is unchanged (metadata-only update)

---

## Request Source Tracking

Currently missing from codebase. Need to track:
- **Source:** "web" | "api" | "mcp-content" | "mcp-prompt"
- **Auth type:** "auth0" | "pat" | "dev"
- **Token ID:** UUID of PAT if used (for audit trail)

**MCP Source Detection:** MCP servers make HTTP calls to the API. They will include an `X-Request-Source` header (e.g., `X-Request-Source: mcp-content`) when calling API endpoints. The API reads this header and sets the source accordingly. This is spoofable but acceptable - source tracking is for audit/telemetry, not access control.

---

## Milestone 1: Request Context Infrastructure

### Goal
Add request source and auth type tracking to request context so history records can capture who/what initiated each action.

### Success Criteria
- All authenticated requests have `source` and `auth_type` available in request state
- PAT requests also have `token_id` available
- MCP requests with `X-Request-Source` header are correctly identified
- Existing functionality unchanged
- Unit tests verify context is set correctly for all auth paths

### Key Changes

1. **Define source enum in `backend/src/core/auth.py`:**
   ```python
   from enum import Enum

   class RequestSource(str, Enum):
       WEB = "web"
       API = "api"
       MCP_CONTENT = "mcp-content"
       MCP_PROMPT = "mcp-prompt"

   class AuthType(str, Enum):
       AUTH0 = "auth0"
       PAT = "pat"
       DEV = "dev"
   ```

2. **Add dataclass for request context:**
   ```python
   from dataclasses import dataclass
   from uuid import UUID

   @dataclass
   class RequestContext:
       source: RequestSource
       auth_type: AuthType
       token_id: UUID | None = None  # Only set for PAT auth
   ```

3. **Update `validate_pat()` to return token_id:**

   Currently `validate_pat()` returns only the User, discarding the `api_token` object. Modify to preserve the token ID:
   ```python
   async def validate_pat(db: AsyncSession, token: str) -> tuple[User, UUID]:
       """
       Validate a PAT and return the associated user AND token ID.

       Returns:
           Tuple of (User, token_id) for audit trail purposes.
       """
       api_token = await token_service.validate_token(db, token)
       if api_token is None:
           raise HTTPException(...)

       # ... load user ...

       return user, api_token.id  # Return both
   ```

4. **Update auth dependencies to set request context:**

   In `_authenticate_user()`, set context on `request.state`:
   ```python
   async def _authenticate_user(
       request: Request,  # Add request parameter
       credentials: HTTPAuthorizationCredentials | None,
       db: AsyncSession,
       settings: Settings,
       *,
       allow_pat: bool = True,
   ) -> User | CachedUser:
       token_id = None

       if settings.dev_mode:
           auth_type = AuthType.DEV
           user = await get_or_create_dev_user(db)
       elif token.startswith("bm_"):
           if not allow_pat:
               raise HTTPException(status_code=403, ...)
           user, token_id = await validate_pat(db, token)  # Now returns tuple
           auth_type = AuthType.PAT
       else:
           auth_type = AuthType.AUTH0
           # ... existing JWT validation ...

       # Determine source from header (MCP sets this)
       source_header = request.headers.get("x-request-source", "").lower()
       if source_header == "mcp-content":
           source = RequestSource.MCP_CONTENT
       elif source_header == "mcp-prompt":
           source = RequestSource.MCP_PROMPT
       else:
           source = RequestSource.API  # Default

       request.state.request_context = RequestContext(
           source=source,
           auth_type=auth_type,
           token_id=token_id,
       )

       return user
   ```

5. **Add helper to get context from request:**
   ```python
   def get_request_context(request: Request) -> RequestContext | None:
       return getattr(request.state, "request_context", None)
   ```

6. **Update MCP server api_client.py to include source header:**

   In `backend/src/mcp_server/api_client.py`:
   ```python
   async def api_get(client, path, token, params=None):
       response = await client.get(
           path,
           params=params,
           headers={
               "Authorization": f"Bearer {token}",
               "X-Request-Source": "mcp-content",
           },
       )
       # ...
   ```

   Similarly for `api_post`, `api_patch`, and the prompt MCP server's `api_client.py`.

### Testing Strategy

1. **Unit tests for auth dependency:**
   - Auth0 JWT sets `auth_type=AUTH0`, `token_id=None`
   - PAT auth sets `auth_type=PAT`, `token_id=<uuid>`
   - DEV_MODE sets `auth_type=DEV`, `token_id=None`
   - `source` defaults to `API` without header
   - `X-Request-Source: mcp-content` sets `source=MCP_CONTENT`
   - `X-Request-Source: mcp-prompt` sets `source=MCP_PROMPT`
   - Invalid/unknown header values default to `API`

2. **Integration tests:**
   - Request to API endpoint has request_context in state
   - Different auth methods produce correct auth_type
   - MCP header correctly sets source

### Dependencies
None

### Risk Factors
- **CachedUser handling:** Request context works with both User ORM and CachedUser objects since it's attached to request.state, not the user.

---

## Milestone 2: ContentHistory Model and Migration

### Goal
Create the `content_history` table to store all history records, and clean up unused legacy schema.

### Success Criteria
- Migration creates table with proper indexes and unique constraint
- Migration drops unused `note_versions` table and `Note.version` column
- Model uses modern SQLAlchemy 2.0 style (`Mapped`/`mapped_column`)
- Tests verify model behavior

### Key Changes

1. **Create `backend/src/models/content_history.py`:**
   ```python
   from datetime import datetime
   from enum import Enum
   from uuid import UUID

   from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
   from sqlalchemy.dialects.postgresql import JSONB
   from sqlalchemy.orm import Mapped, mapped_column, relationship

   from models.base import Base, UUIDv7Mixin

   class ActionType(str, Enum):
       CREATE = "create"
       UPDATE = "update"
       DELETE = "delete"
       RESTORE = "restore"
       ARCHIVE = "archive"
       UNARCHIVE = "unarchive"

   class EntityType(str, Enum):
       BOOKMARK = "bookmark"
       NOTE = "note"
       PROMPT = "prompt"

   class DiffType(str, Enum):
       SNAPSHOT = "snapshot"
       DIFF = "diff"

   class ContentHistory(Base, UUIDv7Mixin):
       __tablename__ = "content_history"

       user_id: Mapped[UUID] = mapped_column(
           ForeignKey("users.id", ondelete="CASCADE"),
           nullable=False,
       )
       entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
       entity_id: Mapped[UUID] = mapped_column(nullable=False)  # No FK - entity may be deleted
       action: Mapped[str] = mapped_column(String(20), nullable=False)

       # Version tracking
       version: Mapped[int] = mapped_column(nullable=False)  # Sequential per entity
       diff_type: Mapped[str] = mapped_column(String(20), nullable=False)
       content_diff: Mapped[str | None] = mapped_column(Text, nullable=True)
       metadata_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

       # Source tracking
       source: Mapped[str] = mapped_column(String(20), nullable=False)
       auth_type: Mapped[str] = mapped_column(String(10), nullable=False)
       token_id: Mapped[UUID | None] = mapped_column(
           ForeignKey("api_tokens.id", ondelete="SET NULL"),
           nullable=True,
       )

       # Timestamps
       created_at: Mapped[datetime] = mapped_column(
           DateTime(timezone=True),
           server_default=func.clock_timestamp(),
           nullable=False,
       )

       # Relationships
       user: Mapped["User"] = relationship(back_populates="content_history")
       token: Mapped["ApiToken | None"] = relationship()

       __table_args__ = (
           # Unique constraint prevents duplicate versions from race conditions
           UniqueConstraint(
               "user_id", "entity_type", "entity_id", "version",
               name="uq_content_history_version",
           ),
           # Primary query: user's history for an entity
           Index("ix_content_history_user_entity", "user_id", "entity_type", "entity_id", "version"),
           # All user's recent activity
           Index("ix_content_history_user_created", "user_id", "created_at"),
           # Retention cleanup
           Index("ix_content_history_created", "created_at"),
           # Efficient snapshot lookup for reconstruction
           Index(
               "ix_content_history_snapshots",
               "user_id", "entity_type", "entity_id", "version",
               postgresql_where=text("diff_type = 'snapshot'"),
           ),
       )
   ```

2. **Update `backend/src/models/__init__.py`:**
   - Export ContentHistory, ActionType, EntityType, DiffType
   - Remove NoteVersion export

3. **Update User model:**
   - Add relationship: `content_history: Mapped[list["ContentHistory"]] = relationship(back_populates="user")`

4. **Delete `backend/src/models/note_version.py`**

5. **Create migration:**
   ```bash
   make migration message="add content_history table and drop note_versions"
   ```

   The migration should:
   - Create `content_history` table with all columns, indexes, and unique constraint
   - Drop `note_versions` table
   - Drop `version` column from `notes` table

### Testing Strategy

1. **Model tests:**
   - Create ContentHistory record with all fields
   - Verify enum values work correctly
   - Verify JSONB metadata stores and retrieves correctly
   - Verify relationships work (user, token)
   - Verify unique constraint prevents duplicate (user_id, entity_type, entity_id, version)

2. **Migration tests:**
   - Migration applies cleanly
   - Rollback works
   - Indexes exist
   - `note_versions` table is dropped
   - `notes.version` column is dropped

### Dependencies
Milestone 1 (for source/auth_type enums)

### Risk Factors
- **No FK on entity_id:** Intentional - allows history to persist after permanent delete. Verify queries handle missing entities gracefully.

---

## Milestone 3: History Service with Diff Support

### Goal
Create service layer for recording and retrieving history, including diff-match-patch integration.

### Success Criteria
- History is recorded on create/update/delete/restore/archive/unarchive
- Diffs are computed and stored correctly
- Content can be reconstructed efficiently from nearest snapshot + diffs
- Version numbers increment correctly with race condition handling
- Metadata-only changes are recorded as snapshots

### Key Changes

1. **Add diff-match-patch dependency:**
   ```bash
   uv add diff-match-patch
   ```

2. **Create `backend/src/services/history_service.py`:**
   ```python
   from diff_match_patch import diff_match_patch
   from sqlalchemy.exc import IntegrityError

   SNAPSHOT_INTERVAL = 10  # Full snapshot every N versions

   class HistoryService:
       def __init__(self):
           self.dmp = diff_match_patch()

       async def record_action(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType,
           entity_id: UUID,
           action: ActionType,
           current_content: str | None,
           previous_content: str | None,
           metadata: dict,
           context: RequestContext,
       ) -> ContentHistory:
           """Record a history entry for an action."""
           # Retry loop for race condition on version allocation
           max_retries = 3
           for attempt in range(max_retries):
               try:
                   return await self._record_action_impl(
                       db, user_id, entity_type, entity_id, action,
                       current_content, previous_content, metadata, context,
                   )
               except IntegrityError:
                   await db.rollback()
                   if attempt == max_retries - 1:
                       raise
                   # Retry with new version number

       async def _record_action_impl(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType,
           entity_id: UUID,
           action: ActionType,
           current_content: str | None,
           previous_content: str | None,
           metadata: dict,
           context: RequestContext,
       ) -> ContentHistory:
           """Internal implementation of record_action."""
           version = await self._get_next_version(db, user_id, entity_type, entity_id)

           # Determine if this should be a snapshot
           is_snapshot = (
               action == ActionType.CREATE
               or version % SNAPSHOT_INTERVAL == 0
               or previous_content is None
               or current_content is None
               or previous_content == current_content  # Metadata-only change
           )

           if is_snapshot:
               diff_type = DiffType.SNAPSHOT
               content_diff = current_content
           else:
               # Compute diff from previous to current
               diff_type = DiffType.DIFF
               patches = self.dmp.patch_make(previous_content, current_content)
               content_diff = self.dmp.patch_toText(patches)

           history = ContentHistory(
               user_id=user_id,
               entity_type=entity_type.value if isinstance(entity_type, EntityType) else entity_type,
               entity_id=entity_id,
               action=action.value if isinstance(action, ActionType) else action,
               version=version,
               diff_type=diff_type.value if isinstance(diff_type, DiffType) else diff_type,
               content_diff=content_diff,
               metadata_snapshot=metadata,
               source=context.source.value,
               auth_type=context.auth_type.value,
               token_id=context.token_id,
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
           """Get history for a specific entity. Returns (items, total_count)."""
           entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type

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
           """Get all history for a user. Returns (items, total_count)."""
           # Build base conditions
           conditions = [ContentHistory.user_id == user_id]
           if entity_type:
               entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type
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

       async def reconstruct_content_at_version(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType | str,
           entity_id: UUID,
           target_version: int,
       ) -> str | None:
           """
           Reconstruct content at a specific version by applying diffs.

           Optimized to only load records from nearest snapshot to target version.
           """
           entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type

           # Step 1: Find the nearest snapshot at or before target version
           snapshot_stmt = (
               select(ContentHistory)
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type_value,
                   ContentHistory.entity_id == entity_id,
                   ContentHistory.version <= target_version,
                   ContentHistory.diff_type == DiffType.SNAPSHOT.value,
               )
               .order_by(ContentHistory.version.desc())
               .limit(1)
           )
           snapshot_result = await db.execute(snapshot_stmt)
           snapshot = snapshot_result.scalar_one_or_none()

           if snapshot is None:
               return None

           # If target is the snapshot itself, return directly
           if snapshot.version == target_version:
               return snapshot.content_diff

           # Step 2: Get diffs from snapshot to target
           diffs_stmt = (
               select(ContentHistory)
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type_value,
                   ContentHistory.entity_id == entity_id,
                   ContentHistory.version > snapshot.version,
                   ContentHistory.version <= target_version,
               )
               .order_by(ContentHistory.version.asc())
           )
           diffs_result = await db.execute(diffs_stmt)
           diffs = list(diffs_result.scalars().all())

           # Step 3: Apply diffs to snapshot
           content = snapshot.content_diff
           for record in diffs:
               if record.diff_type == DiffType.SNAPSHOT.value:
                   content = record.content_diff
               elif record.diff_type == DiffType.DIFF.value and record.content_diff:
                   patches = self.dmp.patch_fromText(record.content_diff)
                   content, _ = self.dmp.patch_apply(patches, content)

           return content

       async def get_history_at_version(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType | str,
           entity_id: UUID,
           version: int,
       ) -> ContentHistory | None:
           """Get the history record at a specific version."""
           entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type
           stmt = select(ContentHistory).where(
               ContentHistory.user_id == user_id,
               ContentHistory.entity_type == entity_type_value,
               ContentHistory.entity_id == entity_id,
               ContentHistory.version == version,
           )
           result = await db.execute(stmt)
           return result.scalar_one_or_none()

       async def _get_next_version(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType | str,
           entity_id: UUID,
       ) -> int:
           """Get the next version number for an entity."""
           entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type
           stmt = (
               select(func.max(ContentHistory.version))
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type_value,
                   ContentHistory.entity_id == entity_id,
               )
           )
           result = await db.execute(stmt)
           max_version = result.scalar_one_or_none()
           return (max_version or 0) + 1


   history_service = HistoryService()
   ```

### Testing Strategy

1. **Diff computation tests:**
   - Simple text change produces valid diff
   - Applying diff to original produces new text
   - Empty/None content handled correctly (stores snapshot)
   - Large content changes work
   - Metadata-only change (content unchanged) stores snapshot

2. **Snapshot interval tests:**
   - Version 1 is always a snapshot (CREATE action)
   - Every 10th version is a snapshot
   - Versions between are diffs
   - None content forces snapshot

3. **Content reconstruction tests:**
   - Reconstruct version 1 (snapshot only)
   - Reconstruct version 5 (snapshot + 4 diffs)
   - Reconstruct version 15 (queries from nearest snapshot, not all history)
   - Non-existent version returns None
   - Verify only necessary records are queried (not full history)

4. **Race condition tests:**
   - Concurrent history writes to same entity produce sequential versions
   - IntegrityError triggers retry and succeeds
   - Max retries exceeded raises error

5. **History retrieval tests:**
   - Get entity history returns correct records and total count
   - Get user history filters by entity type
   - Pagination works correctly with accurate totals

### Dependencies
Milestone 2 (ContentHistory model)

### Risk Factors
- **Diff corruption:** If a diff is corrupted, all subsequent versions until next snapshot are broken. Snapshot interval mitigates this.
- **Large diffs:** For complete rewrites, diff may be larger than full content. Consider storing snapshot if diff > content length (future optimization).

---

## Milestone 4: Integrate History Recording into Services

### Goal
Hook history recording into existing service CRUD operations.

### Success Criteria
- All create/update/delete/restore/archive/unarchive operations record history
- Previous content is fetched before update for diff computation
- Request context is passed through from routers
- Metadata-only changes (e.g., tag updates) create history records

### Key Changes

1. **Update `BaseEntityService` with history hooks:**

   Add abstract property for entity type:
   ```python
   @property
   @abstractmethod
   def entity_type(self) -> EntityType:
       """Return the EntityType for this service."""
       pass
   ```

   Add helper to extract metadata snapshot:
   ```python
   def _get_metadata_snapshot(self, entity) -> dict:
       """Extract non-content fields for history snapshot."""
       return {
           "title": getattr(entity, "title", None),
           "description": getattr(entity, "description", None),
           "tags": [t.name for t in entity.tag_objects] if hasattr(entity, "tag_objects") else [],
           # Entity-specific fields added by subclasses
       }
   ```

   Modify `create()` to record history:
   ```python
   async def create(self, db, user_id, data, limits, context: RequestContext | None = None):
       # ... existing create logic ...
       await db.flush()

       if context:
           await history_service.record_action(
               db=db,
               user_id=user_id,
               entity_type=self.entity_type,
               entity_id=entity.id,
               action=ActionType.CREATE,
               current_content=entity.content,
               previous_content=None,
               metadata=self._get_metadata_snapshot(entity),
               context=context,
           )

       return entity
   ```

2. **Update subclass services:**

   In `BookmarkService`:
   ```python
   @property
   def entity_type(self) -> EntityType:
       return EntityType.BOOKMARK

   def _get_metadata_snapshot(self, entity) -> dict:
       base = super()._get_metadata_snapshot(entity)
       base["url"] = entity.url
       return base
   ```

   In `PromptService`:
   ```python
   @property
   def entity_type(self) -> EntityType:
       return EntityType.PROMPT

   def _get_metadata_snapshot(self, entity) -> dict:
       base = super()._get_metadata_snapshot(entity)
       base["name"] = entity.name
       base["arguments"] = entity.arguments
       return base
   ```

   In `NoteService`:
   ```python
   @property
   def entity_type(self) -> EntityType:
       return EntityType.NOTE
   ```

3. **Update routers to pass context:**

   In each router, get context and pass to service:
   ```python
   from core.auth import get_request_context

   @router.post("/", response_model=BookmarkResponse)
   async def create_bookmark(
       request: Request,
       data: BookmarkCreate,
       current_user: User = Depends(get_current_user),
       limits: TierLimits = Depends(get_current_limits),
       db: AsyncSession = Depends(get_async_session),
   ) -> BookmarkResponse:
       context = get_request_context(request)
       bookmark = await bookmark_service.create(db, current_user.id, data, limits, context)
       return BookmarkResponse.model_validate(bookmark)
   ```

4. **Handle update operations:**

   For updates, fetch previous content before modification:
   ```python
   async def update(self, db, user_id, entity_id, data, limits, context: RequestContext | None = None):
       entity = await self.get(db, user_id, entity_id, include_archived=True)
       if entity is None:
           return None

       previous_content = entity.content  # Capture before modification

       # ... existing update logic ...

       if context:
           await history_service.record_action(
               db=db,
               user_id=user_id,
               entity_type=self.entity_type,
               entity_id=entity.id,
               action=ActionType.UPDATE,
               current_content=entity.content,
               previous_content=previous_content,
               metadata=self._get_metadata_snapshot(entity),
               context=context,
           )

       return entity
   ```

5. **Handle delete/restore/archive/unarchive:**

   Each operation records appropriate action type. Delete captures final state before deletion.

### Testing Strategy

1. **Integration tests per operation:**
   - Create bookmark → history record exists with CREATE action
   - Update bookmark → history record with UPDATE action and diff
   - Delete bookmark → history record with DELETE action
   - Restore bookmark → history record with RESTORE action
   - Archive/unarchive → appropriate history records

2. **Context propagation tests:**
   - History records have correct source and auth_type
   - PAT requests have token_id in history
   - MCP requests have correct source (mcp-content or mcp-prompt)

3. **Diff verification:**
   - Update with content change produces valid diff
   - Update with metadata-only change (e.g., tags only) stores snapshot with content_diff=current_content
   - Multiple updates produce correct version sequence

4. **Metadata-only changes:**
   - Tag-only change creates history record
   - Title-only change creates history record
   - History record has content_diff (as snapshot) even when content unchanged

### Dependencies
Milestone 3 (HistoryService)

### Risk Factors
- **Transaction boundaries:** History must be recorded in same transaction as entity change. Using `db.flush()` (not commit) ensures atomicity.
- **Performance:** Extra query for previous content on updates. Consider if this is acceptable.

---

## Milestone 5: History API Endpoints

### Goal
Expose history data via API endpoints.

### Success Criteria
- Users can view history for all their content
- Users can view history for specific entities
- Users can view content at a specific version
- Proper pagination support with accurate total counts

### Key Changes

1. **Create Pydantic schemas in `backend/src/schemas/history.py`:**
   ```python
   class HistoryResponse(BaseModel):
       id: UUID
       entity_type: str
       entity_id: UUID
       action: str
       version: int
       diff_type: str
       metadata_snapshot: dict | None
       source: str
       auth_type: str
       created_at: datetime

       model_config = ConfigDict(from_attributes=True)

   class HistoryListResponse(BaseModel):
       items: list[HistoryResponse]
       total: int
       offset: int
       limit: int

   class ContentAtVersionResponse(BaseModel):
       entity_id: UUID
       version: int
       content: str | None
       metadata: dict | None
   ```

2. **Create router in `backend/src/api/routers/history.py`:**
   ```python
   router = APIRouter(prefix="/history", tags=["history"])

   @router.get("/", response_model=HistoryListResponse)
   async def get_user_history(
       entity_type: EntityType | None = None,
       limit: int = Query(50, ge=1, le=100),
       offset: int = Query(0, ge=0),
       current_user: User = Depends(get_current_user),
       db: AsyncSession = Depends(get_async_session),
   ) -> HistoryListResponse:
       """Get history of all user's content."""
       items, total = await history_service.get_user_history(
           db, current_user.id, entity_type, limit, offset
       )
       return HistoryListResponse(items=items, total=total, offset=offset, limit=limit)

   @router.get("/{entity_type}/{entity_id}", response_model=HistoryListResponse)
   async def get_entity_history(
       entity_type: EntityType,
       entity_id: UUID,
       limit: int = Query(50, ge=1, le=100),
       offset: int = Query(0, ge=0),
       current_user: User = Depends(get_current_user),
       db: AsyncSession = Depends(get_async_session),
   ) -> HistoryListResponse:
       """Get history for a specific entity."""
       items, total = await history_service.get_entity_history(
           db, current_user.id, entity_type, entity_id, limit, offset
       )
       return HistoryListResponse(items=items, total=total, offset=offset, limit=limit)

   @router.get("/{entity_type}/{entity_id}/version/{version}", response_model=ContentAtVersionResponse)
   async def get_content_at_version(
       entity_type: EntityType,
       entity_id: UUID,
       version: int,
       current_user: User = Depends(get_current_user),
       db: AsyncSession = Depends(get_async_session),
   ) -> ContentAtVersionResponse:
       """Reconstruct content at a specific version."""
       content = await history_service.reconstruct_content_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       if content is None:
           raise HTTPException(status_code=404, detail="Version not found")

       # Get metadata from that version
       history = await history_service.get_history_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       return ContentAtVersionResponse(
           entity_id=entity_id,
           version=version,
           content=content,
           metadata=history.metadata_snapshot if history else None,
       )
   ```

3. **Register router in `main.py`**

4. **Add per-entity history endpoints to existing routers:**
   ```python
   # In bookmarks.py
   @router.get("/{bookmark_id}/history", response_model=HistoryListResponse)
   async def get_bookmark_history(
       bookmark_id: UUID,
       limit: int = Query(50, ge=1, le=100),
       offset: int = Query(0, ge=0),
       current_user: User = Depends(get_current_user),
       db: AsyncSession = Depends(get_async_session),
   ) -> HistoryListResponse:
       """Get history for a specific bookmark."""
       # Verify bookmark exists and belongs to user
       bookmark = await bookmark_service.get(db, current_user.id, bookmark_id, include_deleted=True)
       if bookmark is None:
           raise HTTPException(status_code=404, detail="Bookmark not found")

       items, total = await history_service.get_entity_history(
           db, current_user.id, EntityType.BOOKMARK, bookmark_id, limit, offset
       )
       return HistoryListResponse(items=items, total=total, offset=offset, limit=limit)
   ```

### Testing Strategy

1. **Endpoint tests:**
   - Get user history returns all history records with correct total
   - Filter by entity_type works
   - Get entity history returns only that entity's records
   - Get content at version returns reconstructed content
   - 404 for non-existent entity/version

2. **Authorization tests:**
   - Cannot access another user's history
   - PAT can access history (read operation)

3. **Pagination tests:**
   - Limit and offset work correctly
   - Total count reflects all matching records, not just current page
   - Edge cases: offset beyond total, empty results

### Dependencies
Milestone 4 (history recording integrated)

### Risk Factors
- **Large history:** Users with many changes may have slow queries. Indexes should help.
- **Deleted entities:** History for deleted entities should still be accessible. Verify no FK issues.

---

## Milestone 6: Undo/Revert Functionality

### Goal
Allow users to revert content to a previous version.

### Success Criteria
- Users can revert content to any previous version
- Revert creates a new history entry (not deletion of history)
- Edge cases handled (deleted items, URL conflicts)
- Revert delegates to entity-specific services for validation

### Key Changes

1. **Add revert endpoint:**
   ```python
   @router.post("/{entity_type}/{entity_id}/revert/{version}")
   async def revert_to_version(
       entity_type: EntityType,
       entity_id: UUID,
       version: int,
       request: Request,
       current_user: User = Depends(get_current_user),
       limits: TierLimits = Depends(get_current_limits),
       db: AsyncSession = Depends(get_async_session),
   ):
       """
       Revert entity to a previous version.

       This creates a new UPDATE history entry with the restored content.
       The revert operation delegates to the entity-specific service,
       which handles validation (URL uniqueness for bookmarks, name
       uniqueness for prompts, etc.).
       """
       context = get_request_context(request)

       # Reconstruct content at target version
       content = await history_service.reconstruct_content_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       if content is None:
           raise HTTPException(status_code=404, detail="Version not found")

       # Get metadata from that version
       history = await history_service.get_history_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       if history is None:
           raise HTTPException(status_code=404, detail="Version not found")

       # Get the appropriate service
       service = _get_service_for_entity_type(entity_type)

       # Check if entity exists (may be deleted)
       entity = await service.get(
           db, current_user.id, entity_id, include_deleted=True, include_archived=True
       )

       if entity is None:
           # Entity was permanently deleted - cannot restore
           raise HTTPException(status_code=404, detail="Entity not found")

       if entity.deleted_at is not None:
           # Entity is soft-deleted - restore it first
           await service.restore(db, current_user.id, entity_id)

       # Update entity with restored content
       # This will record a new UPDATE history entry
       # Service handles validation (URL/name uniqueness, etc.)
       update_data = _build_update_from_history(entity_type, content, history.metadata_snapshot)
       try:
           await service.update(db, current_user.id, entity_id, update_data, limits, context)
       except DuplicateUrlError:
           raise HTTPException(
               status_code=409,
               detail="Cannot revert: URL already exists on another bookmark",
           )
       except DuplicateNameError:
           raise HTTPException(
               status_code=409,
               detail="Cannot revert: name already exists on another prompt",
           )

       return {"message": "Reverted successfully", "version": version}
   ```

2. **Handle edge cases:**
   - **Deleted item:** If soft-deleted, restore first then update
   - **URL conflict (bookmarks):** If restoring a URL that now exists on another bookmark, reject with 409
   - **Prompt name conflict:** Similar to URL
   - **Tag restoration:** Tags in metadata_snapshot are names; service creates missing tags as needed

3. **Helper functions:**
   ```python
   def _get_service_for_entity_type(entity_type: EntityType):
       """Get the appropriate service for an entity type."""
       from services.bookmark_service import bookmark_service
       from services.note_service import note_service
       from services.prompt_service import prompt_service

       services = {
           EntityType.BOOKMARK: bookmark_service,
           EntityType.NOTE: note_service,
           EntityType.PROMPT: prompt_service,
       }
       return services[entity_type]

   def _build_update_from_history(
       entity_type: EntityType,
       content: str | None,
       metadata: dict,
   ):
       """Build an update schema from history data."""
       # Import appropriate schema based on entity type
       # Return populated update object
       ...
   ```

### Testing Strategy

1. **Basic revert tests:**
   - Revert to version 1 restores original content
   - Revert creates new history entry (UPDATE action)
   - Reverted content matches target version
   - Reverted metadata matches target version

2. **Edge case tests:**
   - Revert soft-deleted item (should restore + update)
   - Revert to version with URL that now conflicts (should 409)
   - Revert to version with name that now conflicts (should 409)
   - Revert permanently deleted item (should 404)
   - Revert to non-existent version (should 404)

3. **Tag restoration:**
   - Tags from target version are restored
   - Current tags are replaced
   - Missing tags are created

### Dependencies
Milestone 5 (history endpoints)

### Risk Factors
- **Conflict handling:** URL/name uniqueness constraints may prevent restoration. Clear error messages provided.
- **Tag restoration:** Tags in metadata_snapshot are names, need to resolve to tag objects (or create if missing).

---

## Milestone 7: Tier-Based Retention

### Goal
Implement retention limits based on user tier using lazy cleanup.

### Success Criteria
- History is pruned based on tier limits
- Snapshots needed for reconstruction are preserved
- Cleanup is triggered on user actions (lazy cleanup)
- Tier limits configurable in TierLimits dataclass

### Key Changes

1. **Add to `TierLimits` dataclass in `backend/src/core/tier_limits.py`:**
   ```python
   history_retention_days: int = 30  # How long to keep history
   max_history_per_entity: int = 100  # Max versions per entity
   ```

2. **Create retention cleanup in history service:**
   ```python
   async def cleanup_old_history(
       self,
       db: AsyncSession,
       user_id: UUID,
       limits: TierLimits,
   ) -> int:
       """
       Remove old history records while preserving needed snapshots.

       Called lazily when user views history or makes changes.

       Preservation rules:
       1. Keep records newer than retention_days
       2. Keep latest max_history_per_entity records per entity
       3. Always keep the most recent snapshot for each entity
       4. Keep snapshots needed to reconstruct any preserved version

       Returns number of records deleted.
       """
       cutoff_date = datetime.utcnow() - timedelta(days=limits.history_retention_days)

       # This is a complex query - outline:
       # 1. For each entity, identify records to keep:
       #    - All records newer than cutoff_date
       #    - Latest max_history_per_entity records
       #    - Most recent snapshot
       # 2. Delete everything else for this user

       # Implementation approach:
       # Use a CTE to identify records to delete, ensuring we preserve
       # required snapshots for reconstruction
       ...
   ```

3. **Trigger cleanup lazily:**
   - Call `cleanup_old_history()` when user views history (in `get_user_history` endpoint)
   - Call infrequently (e.g., 1% of requests) to avoid performance impact
   - Or call when history count exceeds threshold

   ```python
   @router.get("/", response_model=HistoryListResponse)
   async def get_user_history(...):
       # Lazy cleanup - run occasionally
       import random
       if random.random() < 0.01:  # 1% of requests
           await history_service.cleanup_old_history(db, current_user.id, limits)

       items, total = await history_service.get_user_history(...)
       return HistoryListResponse(...)
   ```

### Testing Strategy

1. **Retention logic tests:**
   - Old history is deleted after retention period
   - Latest N records per entity are preserved
   - Snapshots needed for reconstruction are preserved
   - Most recent snapshot is never deleted

2. **Tier limit tests:**
   - Different tiers have different retention limits
   - Limits are read from TierLimits dataclass

3. **Edge cases:**
   - Entity with only snapshots (no diffs) - all kept within limits
   - Entity at exactly max_history_per_entity - no deletion
   - Cleanup with no records to delete - no errors

### Dependencies
Milestone 4 (history recording)

### Risk Factors
- **Snapshot preservation:** Algorithm must not delete snapshots needed to reconstruct in-retention versions. Careful design required.
- **Performance:** Cleanup query could be slow for users with lots of history. Run infrequently.

---

## Milestone 8: Documentation and CLAUDE.md Update

### Goal
Document the versioning system for developers and update CLAUDE.md.

### Success Criteria
- CLAUDE.md has clear section on content versioning
- API endpoints are documented
- Diff algorithm and retention are explained

### Key Changes

1. **Update CLAUDE.md with new section:**
   ```markdown
   ### Content Versioning

   All content changes (bookmarks, notes, prompts) are tracked in `content_history` table:

   **Tracked Actions:**
   - CREATE, UPDATE, DELETE, RESTORE, ARCHIVE, UNARCHIVE

   **Source Tracking:**
   - Request source: web, api, mcp-content, mcp-prompt
   - Auth type: auth0, pat, dev
   - Token ID for PAT requests (audit trail)

   **Diff Storage:**
   - Full snapshots every 10 versions
   - Character-level diffs between snapshots (diff-match-patch)
   - Reconstruct any version by applying diffs from nearest snapshot

   **API Endpoints:**
   - `GET /history` - All user history
   - `GET /history/{type}/{id}` - Entity history
   - `GET /history/{type}/{id}/version/{v}` - Content at version
   - `POST /history/{type}/{id}/revert/{v}` - Revert to version
   - `GET /bookmarks/{id}/history` - Bookmark history (etc. for notes/prompts)

   **Retention:**
   - Tier-based: `history_retention_days`, `max_history_per_entity`
   - Lazy cleanup when viewing history
   - Snapshots preserved for reconstruction of in-retention versions
   ```

2. **Add API documentation comments to endpoints**

### Dependencies
All previous milestones

### Risk Factors
None

---

## Summary of Files Changed

### New Files
- `backend/src/models/content_history.py` - ContentHistory model
- `backend/src/services/history_service.py` - History service
- `backend/src/schemas/history.py` - History Pydantic schemas
- `backend/src/api/routers/history.py` - History API endpoints
- `backend/tests/services/test_history_service.py` - History service tests
- `backend/tests/api/test_history.py` - History API tests
- `backend/src/db/migrations/versions/<hash>_add_content_history.py` - Migration

### Deleted Files
- `backend/src/models/note_version.py` - Superseded by ContentHistory

### Modified Files
- `backend/src/core/auth.py` - Add RequestContext, source/auth enums, update validate_pat
- `backend/src/models/__init__.py` - Export new models, remove NoteVersion
- `backend/src/models/user.py` - Add content_history relationship
- `backend/src/models/note.py` - Remove version column (via migration)
- `backend/src/services/base_entity_service.py` - Add history hooks
- `backend/src/services/bookmark_service.py` - Add entity_type property
- `backend/src/services/note_service.py` - Add entity_type property
- `backend/src/services/prompt_service.py` - Add entity_type property
- `backend/src/api/routers/bookmarks.py` - Pass context, add history endpoint
- `backend/src/api/routers/notes.py` - Pass context, add history endpoint
- `backend/src/api/routers/prompts.py` - Pass context, add history endpoint
- `backend/src/api/main.py` - Register history router
- `backend/src/core/tier_limits.py` - Add history retention limits
- `backend/src/mcp_server/api_client.py` - Add X-Request-Source header
- `backend/src/prompt_mcp_server/api_client.py` - Add X-Request-Source header
- `pyproject.toml` - Add diff-match-patch dependency
- `CLAUDE.md` - Document versioning system

---

## Open Questions for User

1. **Frontend:** Should this plan include frontend components for viewing history? Or is that a separate task?

2. **Retention defaults:** Are `history_retention_days=30` and `max_history_per_entity=100` reasonable defaults for the free tier?
