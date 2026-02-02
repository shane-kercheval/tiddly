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

---

## Diff Strategy: diff-match-patch

Use Google's diff-match-patch algorithm for text diffing:
- Store full snapshot every N versions (default: 10)
- Store character-level diffs between snapshots
- Reconstruct any version by: find nearest prior snapshot, apply diffs forward

**Storage approach:**
- `content_diff`: Full text (snapshot) OR diff-match-patch delta string (diff)
- `metadata_snapshot`: JSONB of non-content fields (title, description, tags, etc.) - always stored as snapshot since these are small

---

## Request Source Tracking

Currently missing from codebase. Need to track:
- **Source:** "web" | "api" | "mcp-content" | "mcp-prompt"
- **Auth type:** "auth0" | "pat" | "dev"
- **Token ID:** UUID of PAT if used (for audit trail)

---

## Milestone 1: Request Context Infrastructure

### Goal
Add request source and auth type tracking to request context so history records can capture who/what initiated each action.

### Success Criteria
- All authenticated requests have `source` and `auth_type` available in request state
- PAT requests also have `token_id` available
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

3. **Update auth dependencies to set request context:**

   In `get_current_user()` and variants, after successful auth:
   ```python
   # Determine auth type
   if DEV_MODE:
       auth_type = AuthType.DEV
       token_id = None
   elif token.startswith("bm_"):
       auth_type = AuthType.PAT
       token_id = api_token.id  # From token lookup
   else:
       auth_type = AuthType.AUTH0
       token_id = None

   # Source defaults to API - routers can override for MCP
   request.state.request_context = RequestContext(
       source=RequestSource.API,
       auth_type=auth_type,
       token_id=token_id,
   )
   ```

4. **Add helper to get context from request:**
   ```python
   def get_request_context(request: Request) -> RequestContext | None:
       return getattr(request.state, "request_context", None)
   ```

5. **MCP servers set their source:**

   In MCP server auth, after calling API with token:
   ```python
   # MCP content server
   request.state.request_context.source = RequestSource.MCP_CONTENT

   # MCP prompt server
   request.state.request_context.source = RequestSource.MCP_PROMPT
   ```

   **Note:** The MCP servers call the main API, so the API's auth sets the initial context. The MCP server code would need to pass the source as a header, or the API needs to detect MCP calls differently. **Clarify with user:** Should MCP be detected via a custom header (e.g., `X-Request-Source: mcp-content`)?

### Testing Strategy

1. **Unit tests for auth dependency:**
   - Auth0 JWT sets `auth_type=AUTH0`, `token_id=None`
   - PAT auth sets `auth_type=PAT`, `token_id=<uuid>`
   - DEV_MODE sets `auth_type=DEV`, `token_id=None`
   - `source` defaults to `API`

2. **Integration tests:**
   - Request to API endpoint has request_context in state
   - Different auth methods produce correct auth_type

### Dependencies
None

### Risk Factors
- **MCP source detection:** MCP servers proxy to API - need mechanism to identify these requests. Consider custom header approach.
- **CachedUser handling:** Request context needs to work with both User ORM and CachedUser objects.

---

## Milestone 2: ContentHistory Model and Migration

### Goal
Create the `content_history` table to store all history records.

### Success Criteria
- Migration creates table with proper indexes
- Model supports all required fields
- Composite indexes optimize common queries
- Tests verify model behavior

### Key Changes

1. **Create `backend/src/models/content_history.py`:**
   ```python
   from sqlalchemy import (
       Column, DateTime, Enum, ForeignKey, Index, Text, UUID as PGUUID,
       func,
   )
   from sqlalchemy.dialects.postgresql import JSONB
   from sqlalchemy.orm import relationship

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

       user_id: UUID = Column(PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
       entity_type: str = Column(Enum(EntityType), nullable=False)
       entity_id: UUID = Column(PGUUID(as_uuid=True), nullable=False)  # No FK - entity may be deleted
       action: str = Column(Enum(ActionType), nullable=False)

       # Version tracking
       version: int = Column(Integer, nullable=False)  # Sequential per entity
       diff_type: str = Column(Enum(DiffType), nullable=False)
       content_diff: str | None = Column(Text, nullable=True)  # Full content or diff delta
       metadata_snapshot: dict = Column(JSONB, nullable=True)  # title, description, tags, etc.

       # Source tracking
       source: str = Column(String(20), nullable=False)  # "web", "api", "mcp-content", "mcp-prompt"
       auth_type: str = Column(String(10), nullable=False)  # "auth0", "pat", "dev"
       token_id: UUID | None = Column(PGUUID(as_uuid=True), ForeignKey("api_tokens.id"), nullable=True)

       # Timestamps
       created_at: datetime = Column(DateTime(timezone=True), server_default=func.clock_timestamp(), nullable=False)

       # Relationships
       user = relationship("User", back_populates="content_history")
       token = relationship("ApiToken")

       __table_args__ = (
           # Primary query: user's history for an entity
           Index("ix_content_history_user_entity", "user_id", "entity_type", "entity_id", "version"),
           # All user's recent activity
           Index("ix_content_history_user_created", "user_id", "created_at"),
           # Retention cleanup
           Index("ix_content_history_created", "created_at"),
       )
   ```

2. **Update `backend/src/models/__init__.py`:**
   - Export ContentHistory, ActionType, EntityType, DiffType

3. **Update User model:**
   - Add relationship: `content_history = relationship("ContentHistory", back_populates="user")`

4. **Create migration:**
   ```bash
   make migration message="add content_history table"
   ```

### Testing Strategy

1. **Model tests:**
   - Create ContentHistory record with all fields
   - Verify enum values work correctly
   - Verify JSONB metadata stores and retrieves correctly
   - Verify relationships work (user, token)

2. **Migration tests:**
   - Migration applies cleanly
   - Rollback works
   - Indexes exist

### Dependencies
Milestone 1 (for source/auth_type enums)

### Risk Factors
- **No FK on entity_id:** Intentional - allows history to persist after permanent delete. Verify queries handle missing entities gracefully.
- **Enum vs String:** Using Enum for action/entity_type provides validation, but strings for source/auth_type for flexibility. Consistent choice needed.

---

## Milestone 3: History Service with Diff Support

### Goal
Create service layer for recording and retrieving history, including diff-match-patch integration.

### Success Criteria
- History is recorded on create/update/delete/restore/archive/unarchive
- Diffs are computed and stored correctly
- Content can be reconstructed from snapshot + diffs
- Version numbers increment correctly

### Key Changes

1. **Add diff-match-patch dependency:**
   ```bash
   uv add diff-match-patch
   ```

2. **Create `backend/src/services/history_service.py`:**
   ```python
   from diff_match_patch import diff_match_patch

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
           # Get next version number
           version = await self._get_next_version(db, user_id, entity_type, entity_id)

           # Determine if this should be a snapshot
           is_snapshot = (
               action == ActionType.CREATE
               or version % SNAPSHOT_INTERVAL == 0
               or previous_content is None
           )

           if is_snapshot:
               diff_type = DiffType.SNAPSHOT
               content_diff = current_content
           else:
               # Compute diff from previous to current
               diff_type = DiffType.DIFF
               if previous_content and current_content:
                   patches = self.dmp.patch_make(previous_content, current_content)
                   content_diff = self.dmp.patch_toText(patches)
               else:
                   content_diff = None

           history = ContentHistory(
               user_id=user_id,
               entity_type=entity_type,
               entity_id=entity_id,
               action=action,
               version=version,
               diff_type=diff_type,
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
           entity_type: EntityType,
           entity_id: UUID,
           limit: int = 50,
           offset: int = 0,
       ) -> list[ContentHistory]:
           """Get history for a specific entity."""
           stmt = (
               select(ContentHistory)
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type,
                   ContentHistory.entity_id == entity_id,
               )
               .order_by(ContentHistory.version.desc())
               .offset(offset)
               .limit(limit)
           )
           result = await db.execute(stmt)
           return list(result.scalars().all())

       async def get_user_history(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType | None = None,
           limit: int = 50,
           offset: int = 0,
       ) -> list[ContentHistory]:
           """Get all history for a user, optionally filtered by entity type."""
           stmt = select(ContentHistory).where(ContentHistory.user_id == user_id)
           if entity_type:
               stmt = stmt.where(ContentHistory.entity_type == entity_type)
           stmt = stmt.order_by(ContentHistory.created_at.desc()).offset(offset).limit(limit)
           result = await db.execute(stmt)
           return list(result.scalars().all())

       async def reconstruct_content_at_version(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType,
           entity_id: UUID,
           target_version: int,
       ) -> str | None:
           """Reconstruct content at a specific version by applying diffs."""
           # Get all history up to target version
           stmt = (
               select(ContentHistory)
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type,
                   ContentHistory.entity_id == entity_id,
                   ContentHistory.version <= target_version,
               )
               .order_by(ContentHistory.version.asc())
           )
           result = await db.execute(stmt)
           records = list(result.scalars().all())

           if not records:
               return None

           # Find most recent snapshot at or before target
           content = None
           for record in records:
               if record.diff_type == DiffType.SNAPSHOT:
                   content = record.content_diff
               elif record.diff_type == DiffType.DIFF and content is not None:
                   patches = self.dmp.patch_fromText(record.content_diff)
                   content, _ = self.dmp.patch_apply(patches, content)

           return content

       async def _get_next_version(
           self,
           db: AsyncSession,
           user_id: UUID,
           entity_type: EntityType,
           entity_id: UUID,
       ) -> int:
           """Get the next version number for an entity."""
           stmt = (
               select(func.max(ContentHistory.version))
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type,
                   ContentHistory.entity_id == entity_id,
               )
           )
           result = await db.execute(stmt)
           max_version = result.scalar_one_or_none()
           return (max_version or 0) + 1
   ```

3. **Create singleton instance:**
   ```python
   history_service = HistoryService()
   ```

### Testing Strategy

1. **Diff computation tests:**
   - Simple text change produces valid diff
   - Applying diff to original produces new text
   - Empty content handled correctly
   - Large content changes work

2. **Snapshot interval tests:**
   - Version 1 is always a snapshot
   - Every 10th version is a snapshot
   - Versions between are diffs

3. **Content reconstruction tests:**
   - Reconstruct version 1 (snapshot only)
   - Reconstruct version 5 (snapshot + 4 diffs)
   - Reconstruct version 15 (2 snapshots, apply from nearest)
   - Non-existent version returns None

4. **History retrieval tests:**
   - Get entity history returns correct records
   - Get user history filters by entity type
   - Pagination works correctly

### Dependencies
Milestone 2 (ContentHistory model)

### Risk Factors
- **Diff corruption:** If a diff is corrupted, all subsequent versions are broken. Snapshot interval mitigates this.
- **Large diffs:** For complete rewrites, diff may be larger than full content. Consider storing snapshot if diff > content length.

---

## Milestone 4: Integrate History Recording into Services

### Goal
Hook history recording into existing service CRUD operations.

### Success Criteria
- All create/update/delete/restore/archive/unarchive operations record history
- Previous content is fetched before update for diff computation
- Request context is passed through from routers

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

   Similar for `NoteService` and `PromptService`.

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

3. **Diff verification:**
   - Update with content change produces valid diff
   - Update with metadata-only change has null content_diff
   - Multiple updates produce correct version sequence

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
- Proper pagination support

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
       items = await history_service.get_user_history(
           db, current_user.id, entity_type, limit, offset
       )
       # TODO: Add total count query
       return HistoryListResponse(items=items, total=len(items), offset=offset, limit=limit)

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
       items = await history_service.get_entity_history(
           db, current_user.id, entity_type, entity_id, limit, offset
       )
       return HistoryListResponse(items=items, total=len(items), offset=offset, limit=limit)

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

       items = await history_service.get_entity_history(
           db, current_user.id, EntityType.BOOKMARK, bookmark_id, limit, offset
       )
       return HistoryListResponse(items=items, total=len(items), offset=offset, limit=limit)
   ```

### Testing Strategy

1. **Endpoint tests:**
   - Get user history returns all history records
   - Filter by entity_type works
   - Get entity history returns only that entity's records
   - Get content at version returns reconstructed content
   - 404 for non-existent entity/version

2. **Authorization tests:**
   - Cannot access another user's history
   - PAT can access history (read operation)

3. **Pagination tests:**
   - Limit and offset work correctly
   - Total count is accurate

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
       """Revert entity to a previous version."""
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
       update_data = _build_update_from_history(entity_type, content, history.metadata_snapshot)
       await service.update(db, current_user.id, entity_id, update_data, limits, context)

       return {"message": "Reverted successfully", "version": version}
   ```

2. **Handle edge cases:**
   - **Deleted item:** If soft-deleted, restore first then update
   - **URL conflict (bookmarks):** If restoring a URL that now exists on another bookmark, reject with clear error
   - **Prompt name conflict:** Similar to URL

3. **Add service method to get history at specific version:**
   ```python
   async def get_history_at_version(
       self,
       db: AsyncSession,
       user_id: UUID,
       entity_type: EntityType,
       entity_id: UUID,
       version: int,
   ) -> ContentHistory | None:
       stmt = select(ContentHistory).where(
           ContentHistory.user_id == user_id,
           ContentHistory.entity_type == entity_type,
           ContentHistory.entity_id == entity_id,
           ContentHistory.version == version,
       )
       result = await db.execute(stmt)
       return result.scalar_one_or_none()
   ```

### Testing Strategy

1. **Basic revert tests:**
   - Revert to version 1 restores original content
   - Revert creates new history entry
   - Reverted content matches target version

2. **Edge case tests:**
   - Revert soft-deleted item (should restore + update)
   - Revert to version with URL that now conflicts (should error)
   - Revert permanently deleted item (should 404)
   - Revert to non-existent version (should 404)

3. **Tag restoration:**
   - Tags from target version are restored
   - Current tags are replaced

### Dependencies
Milestone 5 (history endpoints)

### Risk Factors
- **Conflict handling:** URL/name uniqueness constraints may prevent restoration. Need clear error messages.
- **Tag restoration:** Tags in metadata_snapshot are names, need to resolve to tag objects (or create if missing).

---

## Milestone 7: Tier-Based Retention

### Goal
Implement retention limits based on user tier.

### Success Criteria
- History is pruned based on tier limits
- Snapshots needed for reconstruction are preserved
- Background job handles cleanup
- Tier limits configurable

### Key Changes

1. **Add to `TierLimits` dataclass:**
   ```python
   history_retention_days: int = 30  # How long to keep history
   max_history_per_entity: int = 100  # Max versions per entity
   ```

2. **Fetch from API (like other tier limits):**
   - Update tier limits endpoint to include history limits

3. **Create retention service:**
   ```python
   async def cleanup_old_history(
       db: AsyncSession,
       user_id: UUID,
       limits: TierLimits,
   ) -> int:
       """Remove old history records while preserving needed snapshots."""
       cutoff_date = datetime.utcnow() - timedelta(days=limits.history_retention_days)

       # Find records to delete, but preserve:
       # 1. Records newer than cutoff
       # 2. Most recent snapshot for each entity (for reconstruction)
       # 3. Latest N records per entity

       # This is complex - need to identify which snapshots are still needed
       # for reconstructing versions within retention window
       ...
   ```

4. **Background cleanup:**
   - Could be triggered on user actions (lazy cleanup)
   - Or scheduled background job (if infrastructure exists)
   - **Clarify with user:** Is there existing background job infrastructure?

### Testing Strategy

1. **Retention logic tests:**
   - Old history is deleted after retention period
   - Snapshots needed for reconstruction are preserved
   - max_history_per_entity is enforced

2. **Tier limit tests:**
   - Different tiers have different limits
   - Limits are fetched correctly

### Dependencies
Milestone 4 (history recording)

### Risk Factors
- **Snapshot preservation:** Must not delete snapshots needed to reconstruct in-retention versions. Algorithm needs careful design.
- **Background jobs:** If no infrastructure exists, may need to implement lazy cleanup instead.

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

### Modified Files
- `backend/src/core/auth.py` - Add RequestContext, source/auth enums
- `backend/src/models/__init__.py` - Export new models
- `backend/src/models/user.py` - Add content_history relationship
- `backend/src/services/base_entity_service.py` - Add history hooks
- `backend/src/services/bookmark_service.py` - Add entity_type property
- `backend/src/services/note_service.py` - Add entity_type property
- `backend/src/services/prompt_service.py` - Add entity_type property
- `backend/src/api/routers/bookmarks.py` - Pass context, add history endpoint
- `backend/src/api/routers/notes.py` - Pass context, add history endpoint
- `backend/src/api/routers/prompts.py` - Pass context, add history endpoint
- `backend/src/api/main.py` - Register history router
- `backend/src/core/tier_limits.py` - Add history retention limits
- `pyproject.toml` or `requirements.txt` - Add diff-match-patch dependency
- `CLAUDE.md` - Document versioning system

---

## Open Questions for User

1. **MCP source detection:** Should MCP servers pass a custom header (e.g., `X-Request-Source: mcp-content`) to identify themselves to the API? Or is there a better approach?

2. **Background cleanup:** Is there existing background job infrastructure (e.g., Celery, cron) for history retention cleanup? Or should we use lazy cleanup on user actions?

3. **Frontend:** Should this plan include frontend components for viewing history? Or is that a separate task?

4. **Retention defaults:** Are `history_retention_days=30` and `max_history_per_entity=100` reasonable defaults for the free tier?
