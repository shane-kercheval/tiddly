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
- diff-match-patch: https://github.com/diff-match-patch-python/diff-match-patch (maintained fork, Python 3.8-3.13)
- diff-match-patch on PyPI: https://pypi.org/project/diff-match-patch/ (same package, now tracks the maintained fork)
- Original Google repo (archived Aug 2024): https://github.com/google/diff-match-patch/wiki/API (API docs still valid)

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

## Diff Strategy: Reverse Diffs with diff-match-patch

Use Google's diff-match-patch algorithm with **reverse diffs** (storing how to get from current version to previous version). This makes cleanup trivial—only the latest snapshot is needed for reconstruction.

**Why reverse diffs:**
- Cleanup is simple: delete old records freely, just keep the latest snapshot
- No need to preserve old snapshots for reconstruction
- Standard pattern used by backup systems (most recent = full, older = reverse deltas)

**How it works:**
- Each DIFF record stores: "how to transform version N's content into version N-1's content"
- To reconstruct an old version: start from latest snapshot, apply reverse diffs backwards
- Example: To get v3 from v10 (snapshot), apply v10→v9, v9→v8, ..., v4→v3 diffs

**Storage approach:**
- `content_diff`: Full text (snapshot) OR reverse diff-match-patch delta string (diff)
- `metadata_snapshot`: JSONB of non-content fields (title, description, tags, etc.) - always stored as snapshot since these are small

**Diff type rules:**
- `SNAPSHOT`: Full content stored in `content_diff`
  - CREATE actions (version 1)
  - Every Nth version (default: 10) — ensures bounded reconstruction cost
  - When `previous_content` is None
  - When `current_content` is None
- `DIFF`: Reverse diff-match-patch delta string stored in `content_diff`
  - Stores transformation from current → previous (reverse direction)
  - Normal updates between snapshots
- `METADATA`: No content stored (`content_diff` is None)
  - When content is unchanged (metadata-only update like tag/title changes)
  - Reconstruction skips these (content same as next newer version)

---

## Request Source Tracking

Currently missing from codebase. Need to track:
- **Source:** "web" | "api" | "mcp-content" | "mcp-prompt" | "unknown"
- **Auth type:** "auth0" | "pat" | "dev"
- **Token prefix:** e.g., "bm_a3f8..." if PAT used (for audit trail, safe to log/display)

**Source Detection via `X-Request-Source` Header:**
- Frontend sends `X-Request-Source: web`
- MCP Content server sends `X-Request-Source: mcp-content`
- MCP Prompt server sends `X-Request-Source: mcp-prompt`
- CLI/scripts using PATs can send `X-Request-Source: api` (optional)
- Missing or unrecognized header defaults to `unknown` (not `api`)

This is spoofable but acceptable - source tracking is for audit/telemetry, not access control.

**MCP Server Restrictions:** Both MCP servers explicitly block delete operations:
- Content MCP: "Delete/archive operations are only available via web UI"
- Prompt MCP: "There is no delete tool. Prompts can only be deleted via the web UI"

This ensures AI agents via MCP can only read, create, and update - not delete (soft or hard). Delete operations require web UI (Auth0 authentication).

---

## Milestone 0: Diff Performance Benchmarking ✅ COMPLETED

**Purpose:** Validate diff-match-patch performance before building the history service. Determine whether sync implementation is acceptable or if thread pool is needed, and establish appropriate snapshot intervals.

**Approach:** Benchmark scripts tested:
1. **Diff benchmark** (`performance/diff/benchmark.py`): Diff computation and reconstruction across content sizes (1KB-500KB), change patterns (1%/10%/50%), and event loop impact. 30 iterations per scenario.
2. **API benchmark** (`performance/api/benchmark.py`): Full API endpoint performance at different content sizes (1KB, 50KB) and concurrency levels (10, 50, 100). 100 iterations per scenario.
3. **Profiling** (`performance/profiling/profile.py`): Detailed pyinstrument profiles for individual operations.

**System context:** Current content limit is 100KB. Sizes 250KB-500KB included for future planning.

### Diff Computation Results

Time to compute diff between original and modified content:

| Size | Change | P50 (ms) | P95 (ms) | Notes |
|------|--------|----------|----------|-------|
| 1KB | 1% | 0.07 | 0.10 | |
| 1KB | 10% | 0.02 | 0.03 | |
| 10KB | 1% | 0.04 | 0.05 | |
| 10KB | 10% | 0.07 | 0.07 | |
| 10KB | 50% | 0.72 | 0.78 | |
| 50KB | 1% | 0.07 | 0.08 | |
| 50KB | 10% | 0.08 | 0.10 | Sub-millisecond at content limit |
| 50KB | 50% | 14.2 | 14.7 | |
| **100KB** | **1%** | **0.12** | **0.17** | **Current limit** |
| **100KB** | **10%** | **0.13** | **0.14** | **Typical edit at max size** |
| **100KB** | **50%** | **56.5** | **57.4** | **Rare: major rewrite** |
| 250KB | 50% | 343 | 346 | Future planning only |
| 500KB | 50% | 1338 | 1349 | Future planning only |

### Reconstruction Results

Time to apply N sequential diffs from a snapshot (for version retrieval):

| Size | Diffs | P50 (ms) | P95 (ms) |
|------|-------|----------|----------|
| 50KB | 10 | 0.023 | 0.027 |
| 100KB | 10 | 0.031 | 0.043 |
| 100KB | 50 | 0.034 | 0.044 |

**Conclusion:** Reconstruction is negligible (<0.1ms) even for 50 diffs at 100KB.

### Event Loop Impact

Tested how diff computation affects concurrent async operations:

| Size | Degradation |
|------|-------------|
| 10KB | 1.01x |
| 100KB | 0.99x |
| 250KB | 1.00x |
| 500KB | 1.00x |

**Conclusion:** No measurable impact on event loop for typical operations (1-10% changes). The test uses 10% changes, which complete in <1ms and don't block.

### API Baseline Performance

Current API performance without versioning (for comparison after implementation):

**At 1KB content, concurrency 10 (typical usage):**

| Operation | P50 (ms) | P95 (ms) |
|-----------|----------|----------|
| Create Note | 25 | 41 |
| Update Note | 29 | 42 |
| Read Note | 17 | 28 |
| List Notes | 26 | 39 |

**At 50KB content, concurrency 10:**

| Operation | P50 (ms) | P95 (ms) |
|-----------|----------|----------|
| Create Note | 28 | 40 |
| Update Note | 36 | 119 |
| Read Note | 20 | 28 |
| List Notes | 26 | 37 |

**Key observations:**
- Content size has minimal impact on API latency (serialization is fast)
- Prompts are ~2x slower than notes/bookmarks (Jinja2 template validation)
- P95 scaling is ~8-12x from concurrency 10 to 100 (expected)
- 0% error rate at all concurrency levels

### Key Conclusions

| Decision | Threshold | Result | Recommendation |
|----------|-----------|--------|----------------|
| Sync vs thread pool | P95 < 10ms for typical | 0.14ms at 100KB/10% | **Sync OK** |
| Snapshot interval | Reconstruction < 20ms | 0.027ms for 10 diffs | **Interval 10 OK** |
| Event loop blocking | Degradation < 2x | 1.0x | **Acceptable** |
| 50% change handling | Note when slow | 57ms at 100KB | **Store snapshot when diff > 50% content** |

### Summary

1. **Sync implementation is fine** - Typical edits (1-10% changes) complete in <1ms even at the 100KB content limit. No thread pool needed.

2. **Snapshot interval of 10 is appropriate** - Reconstruction from 10 diffs takes <0.05ms. Could increase to 20 without noticeable impact.

3. **No event loop blocking concern** - Diff computation for typical edits doesn't block async operations.

4. **50% rewrites are the edge case** - At 100KB, 50% changes take ~57ms. This is:
   - Rare (most edits are small/incremental)
   - Still acceptable (57ms won't cause timeouts)
   - Above the 100KB limit, performance degrades significantly (350ms at 250KB, 1.3s at 500KB)

5. **Content size limit provides protection** - The 100KB limit bounds worst-case diff computation at ~57ms.

### Implementation Notes for Milestone 3

**Large-diff detection** - Store snapshot when diff is large. This saves storage and simplifies reconstruction, but does NOT avoid the slow diff computation (we must compute the diff to know its size).

```python
# Reverse diff: current → previous (how to go backwards)
patches = dmp.patch_make(current, previous)  # Still runs (can be slow for 50% rewrites)
diff_text = dmp.patch_toText(patches)
if len(diff_text) > len(current) * 0.5:
    diff_type, content_diff = DiffType.SNAPSHOT, current  # Save storage
else:
    diff_type, content_diff = DiffType.DIFF, diff_text
```

**Why this is acceptable:** 50% rewrites are rare in practice (users typically make incremental edits), and 57ms at 100KB is tolerable. If content limits increase to 250KB+, revisit with thread pool offloading (`run_in_executor()`).

**Performance budget for versioning:** Current API P95 for note updates is ~40ms at concurrency 10. Adding ~0.2ms for diff computation is negligible. The overhead will primarily come from:
- Extra DB write for history record (~5-10ms estimated)
- Fetching previous content for diff (already loaded in update flow)

---

## Milestone 1: Request Context Infrastructure

### Goal
Add request source and auth type tracking to request context so history records can capture who/what initiated each action.

### Success Criteria
- All authenticated requests have `source` and `auth_type` available in request state
- PAT requests also have `token_prefix` available (e.g., "bm_a3f8...")
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
       UNKNOWN = "unknown"  # Default when header missing/unrecognized

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
       token_prefix: str | None = None  # Only set for PAT auth, e.g. "bm_a3f8..."
   ```

3. **Update auth dependencies to set request context:**

   In `_authenticate_user()`, set context on `request.state`. The token_prefix is computed directly
   from the token string (no need to change `validate_pat()` since the caller already has the token):
   ```python
   async def _authenticate_user(
       request: Request,  # Add request parameter
       credentials: HTTPAuthorizationCredentials | None,
       db: AsyncSession,
       settings: Settings,
       *,
       allow_pat: bool = True,
   ) -> User | CachedUser:
       token_prefix = None

       if settings.dev_mode:
           auth_type = AuthType.DEV
           user = await get_or_create_dev_user(db)
       elif token.startswith("bm_"):
           if not allow_pat:
               raise HTTPException(status_code=403, ...)
           user = await validate_pat(db, token)
           auth_type = AuthType.PAT
           # Compute token_prefix directly from token (e.g., "bm_a3f8...")
           token_prefix = token[:15] if len(token) > 15 else token
       else:
           auth_type = AuthType.AUTH0
           # ... existing JWT validation ...

       # Determine source from header (frontend and MCP servers set this)
       source_header = request.headers.get("x-request-source", "").lower()
       source_map = {
           "web": RequestSource.WEB,
           "api": RequestSource.API,
           "mcp-content": RequestSource.MCP_CONTENT,
           "mcp-prompt": RequestSource.MCP_PROMPT,
       }
       source = source_map.get(source_header, RequestSource.UNKNOWN)

       # Log unrecognized source values for monitoring (helps detect misconfigurations)
       if source_header and source == RequestSource.UNKNOWN:
           logger.debug(f"Unrecognized X-Request-Source header: {source_header}")

       request.state.request_context = RequestContext(
           source=source,
           auth_type=auth_type,
           token_prefix=token_prefix,
       )

       return user
   ```

4. **Add helper to get context from request:**
   ```python
   def get_request_context(request: Request) -> RequestContext | None:
       return getattr(request.state, "request_context", None)
   ```

5. **Update MCP server api_client.py to include source header:**

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
   - Auth0 JWT sets `auth_type=AUTH0`, `token_prefix=None`
   - PAT auth sets `auth_type=PAT`, `token_prefix="bm_..."`
   - DEV_MODE sets `auth_type=DEV`, `token_prefix=None`
   - `source` defaults to `UNKNOWN` without header
   - `X-Request-Source: web` sets `source=WEB`
   - `X-Request-Source: api` sets `source=API`
   - `X-Request-Source: mcp-content` sets `source=MCP_CONTENT`
   - `X-Request-Source: mcp-prompt` sets `source=MCP_PROMPT`
   - Invalid/unrecognized header values default to `UNKNOWN`

2. **Integration tests:**
   - Request to API endpoint has request_context in state
   - Different auth methods produce correct auth_type
   - Source headers correctly set source

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

   from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
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
       """
       Describes how content_diff is stored. Note: metadata_snapshot is ALWAYS
       stored as a full snapshot in every record, regardless of DiffType.
       """
       SNAPSHOT = "snapshot"  # content_diff = full content text
       DIFF = "diff"          # content_diff = diff-match-patch delta string
       METADATA = "metadata"  # content_diff = None (content unchanged, only metadata changed)

   class ContentHistory(Base, UUIDv7Mixin):
       __tablename__ = "content_history"

       user_id: Mapped[UUID] = mapped_column(
           ForeignKey("users.id", ondelete="CASCADE"),
           nullable=False,
       )
       entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
       # No DB-level FK (polymorphic reference to bookmarks/notes/prompts)
       # History is deleted via application-level cascade when entity is hard-deleted
       entity_id: Mapped[UUID] = mapped_column(nullable=False)
       action: Mapped[str] = mapped_column(String(20), nullable=False)

       # Version tracking
       version: Mapped[int] = mapped_column(nullable=False)  # Sequential per entity
       diff_type: Mapped[str] = mapped_column(String(20), nullable=False)
       content_diff: Mapped[str | None] = mapped_column(Text, nullable=True)
       metadata_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

       # Source tracking
       source: Mapped[str] = mapped_column(String(20), nullable=False)
       auth_type: Mapped[str] = mapped_column(String(10), nullable=False)
       # Token prefix for PAT audit trail (e.g., "bm_a3f8...") - safe to display/log
       token_prefix: Mapped[str | None] = mapped_column(String(20), nullable=True)

       # Timestamps
       created_at: Mapped[datetime] = mapped_column(
           DateTime(timezone=True),
           server_default=func.clock_timestamp(),
           nullable=False,
       )

       # Relationships
       user: Mapped["User"] = relationship(back_populates="content_history")

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
   - Remove NoteVersion import and export from `__all__`

3. **Update User model:**
   - Add relationship: `content_history: Mapped[list["ContentHistory"]] = relationship(back_populates="user")`

4. **Delete `backend/src/models/note_version.py`**

5. **Update tests referencing NoteVersion:**
   - `backend/tests/services/test_user_cascade.py`: Remove NoteVersion import and test code (lines 14, 100-108)
   - Search for other references: `grep -r "NoteVersion" backend/`
   - Update or remove any other files that import NoteVersion

6. **Update /content endpoint to remove Note.version references:**

   The `/content` unified search endpoint currently includes `Note.version` which will be dropped.

   In `backend/src/services/content_service.py`:
   - Remove `Note.version.label("version")` from the notes subquery (around line 295)
   - Remove `version=row.version if row.type == "note" else None` from `_row_to_content_list_item` (around line 160)

   In `backend/src/schemas/content.py`:
   - Remove `version: int | None = None` from `ContentListItem` class (around line 51)

   **Note:** This field was never used meaningfully (always 1 for notes). Removing it is a minor breaking change to the API response schema, but since the field was always 1, no clients should depend on it.

7. **Create migration:**
   ```bash
   make migration message="add content_history table and drop note_versions"
   ```

   **NOTE**: ALWAY add migrations using `make migration` to ensure proper versioning; NEVER create migrations manually.

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

3. **Code cleanup verification:**
   - `make tests` passes (no import errors from removed NoteVersion)
   - No remaining references to NoteVersion in codebase

### Dependencies
Milestone 1 (for source/auth_type enums)

### Risk Factors
- **No DB-level FK on entity_id:** Polymorphic reference to bookmarks/notes/prompts tables. History cleanup on hard-delete is handled at application level (see Milestone 4).

### Migration Notes
- **Pre-existing content:** Existing bookmarks, notes, and prompts will have no history records after migration. This is expected - the versioning feature is new. The first edit after migration creates version 1 for that entity.
- **No synthetic records:** We intentionally do not create synthetic "CREATE" records for existing content, as this would have misleading timestamps and metadata.

---

## Milestone 3: History Service with Diff Support

### Goal
Create service layer for recording and retrieving history, including diff-match-patch integration.

**Prerequisites:** Review Milestone 0 benchmark results to determine:
- Sync vs thread pool implementation
- Snapshot interval (default 10, adjust if reconstruction is slow)
- Content size threshold for forced snapshots (if any)

### Success Criteria
- History is recorded on create/update/delete/restore/archive/unarchive
- Diffs are computed and stored correctly
- Content can be reconstructed by applying reverse diffs from latest snapshot
- Version numbers increment correctly with race condition handling
- Metadata-only changes are recorded as snapshots

### Key Changes

1. **Add diff-match-patch dependency:**
   ```bash
   uv add diff-match-patch
   ```
   Note: This installs the community-maintained fork (tested on Python 3.8-3.13). The original Google repo was archived in Aug 2024, but the PyPI package now tracks the maintained fork at https://github.com/diff-match-patch-python/diff-match-patch.

2. **Create `backend/src/services/history_service.py`:**
   ```python
   import logging
   from dataclasses import dataclass
   from diff_match_patch import diff_match_patch
   from sqlalchemy.exc import IntegrityError

   logger = logging.getLogger(__name__)

   SNAPSHOT_INTERVAL = 10  # Full snapshot every N versions

   @dataclass
   class ReconstructionResult:
       """Result of content reconstruction at a version."""
       found: bool  # Whether the version exists
       content: str | None  # Content at that version (None is valid for some actions)
       warnings: list[str] | None = None  # Warnings if reconstruction had issues (e.g., partial patch failure)

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
           # Uses savepoint to avoid rolling back the parent entity change
           max_retries = 3
           for attempt in range(max_retries):
               try:
                   async with db.begin_nested():  # Creates savepoint
                       return await self._record_action_impl(
                           db, user_id, entity_type, entity_id, action,
                           current_content, previous_content, metadata, context,
                       )
               except IntegrityError as e:
                   # Only retry on version uniqueness violations
                   if "uq_content_history_version" not in str(e):
                       raise  # Re-raise other integrity errors immediately
                   # Savepoint automatically rolled back, parent transaction intact
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

           # Determine diff type and content_diff value
           if previous_content == current_content:
               # Content unchanged - metadata-only change
               diff_type = DiffType.METADATA
               content_diff = None
           elif (
               action == ActionType.CREATE
               or version % SNAPSHOT_INTERVAL == 0
               or previous_content is None
               or current_content is None
           ):
               # Store full snapshot
               diff_type = DiffType.SNAPSHOT
               content_diff = current_content
           else:
               # Compute REVERSE diff: current → previous (how to go backwards)
               diff_type = DiffType.DIFF
               # NOTE: If Milestone 0 benchmarks indicate thread pool needed,
               # wrap this in: await loop.run_in_executor(executor, lambda: ...)
               patches = self.dmp.patch_make(current_content, previous_content)
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
       ) -> ReconstructionResult:
           """
           Reconstruct content at a specific version by applying reverse diffs.

           Uses REVERSE diff strategy:
           - Find nearest snapshot AT OR AFTER target version
           - Apply reverse diffs backwards from snapshot to target
           - Each diff transforms version N content into version N-1 content

           Returns ReconstructionResult with:
           - found=False if version doesn't exist
           - found=True with content (which may be None for delete actions)

           Optimized to only load records from target version to nearest snapshot.
           """
           entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type

           # Step 1: Find the nearest snapshot at or after target version
           snapshot_stmt = (
               select(ContentHistory)
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type_value,
                   ContentHistory.entity_id == entity_id,
                   ContentHistory.version >= target_version,
                   ContentHistory.diff_type == DiffType.SNAPSHOT.value,
               )
               .order_by(ContentHistory.version.asc())  # Nearest snapshot AFTER target
               .limit(1)
           )
           snapshot_result = await db.execute(snapshot_stmt)
           snapshot = snapshot_result.scalar_one_or_none()

           if snapshot is None:
               return ReconstructionResult(found=False, content=None)

           # If target is the snapshot itself, return directly
           if snapshot.version == target_version:
               return ReconstructionResult(found=True, content=snapshot.content_diff)

           # Step 2: Get records from snapshot down to target (to apply reverse diffs)
           # We need versions: snapshot, snapshot-1, ..., target+1
           # Each record's diff transforms its content into the previous version's content
           records_stmt = (
               select(ContentHistory)
               .where(
                   ContentHistory.user_id == user_id,
                   ContentHistory.entity_type == entity_type_value,
                   ContentHistory.entity_id == entity_id,
                   ContentHistory.version > target_version,
                   ContentHistory.version <= snapshot.version,
               )
               .order_by(ContentHistory.version.desc())  # Start from snapshot, go backwards
           )
           records_result = await db.execute(records_stmt)
           records = list(records_result.scalars().all())

           # Step 3: Apply reverse diffs from snapshot backwards to target
           content = snapshot.content_diff
           current_version = snapshot.version
           warnings: list[str] = []

           for record in records:
               # Each record's diff transforms record.version content → (record.version - 1) content
               if record.diff_type == DiffType.SNAPSHOT.value:
                   content = record.content_diff
               elif record.diff_type == DiffType.METADATA.value:
                   # Content unchanged at this version, continue with same content
                   pass
               elif record.diff_type == DiffType.DIFF.value and record.content_diff:
                   # Apply reverse diff to get previous version's content
                   patches = self.dmp.patch_fromText(record.content_diff)
                   # NOTE: If thread pool needed per Milestone 0, offload patch_apply too
                   new_content, results = self.dmp.patch_apply(patches, content or "")
                   if not all(results):
                       # Some patches failed - log but continue with partial result
                       warning_msg = f"Partial patch failure at v{record.version}"
                       warnings.append(warning_msg)
                       logger.warning(
                           "Diff application partial failure for %s/%s v%d: %s",
                           entity_type_value, entity_id, record.version, results,
                       )
                   content = new_content
               current_version = record.version - 1

           # Verify we reached the target version
           # After processing all records, current_version should equal target_version
           if current_version != target_version:
               return ReconstructionResult(found=False, content=None)

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

2. **Diff type tests:**
   - Version 1 is always a snapshot (CREATE action)
   - Every 10th version is a snapshot
   - Versions between are diffs
   - None content forces snapshot
   - Metadata-only change (content unchanged) stores METADATA type with `content_diff=None`
   - METADATA type preserves `metadata_snapshot` with updated values

3. **Content reconstruction tests (reverse diffs):**
   - Reconstruct latest version (snapshot) returns `found=True` directly
   - Reconstruct version 5 from snapshot at v10 (applies 5 reverse diffs) returns `found=True`
   - Reconstruct version 1 from nearest snapshot >= v1 (e.g., v10) returns `found=True`
   - Non-existent version returns `found=False`
   - Version beyond latest returns `found=False`
   - Version with None content (delete action) returns `found=True, content=None`
   - Verify only necessary records are queried (snapshot to target, not full history)
   - Reconstruct version with METADATA records correctly skips content transformation
   - **METADATA version returns same content as next version** (since content was unchanged at that version)
   - Reverse diff application: verify v10 content + reverse diffs = v5 content

4. **Race condition tests:**
   - Concurrent history writes to same entity produce sequential versions
   - Version-unique IntegrityError triggers retry with savepoint (parent transaction intact)
   - Other IntegrityErrors are raised immediately (not retried)
   - Max retries exceeded raises error
   - Parent entity change is NOT rolled back when history insert fails

5. **Diff failure handling tests:**
   - Corrupted diff logs warning but returns partial result
   - Reconstruction continues after partial patch failure

6. **History retrieval tests:**
   - Get entity history returns correct records and total count
   - Get user history filters by entity type
   - Pagination works correctly with accurate totals

### Dependencies
Milestone 2 (ContentHistory model)

### Risk Factors
- **Diff corruption:** If a diff is corrupted, reconstruction of older versions (before that diff) may fail. With reverse diffs, corruption at version N affects versions 1 through N-1. Snapshot interval mitigates this by providing recovery points. Partial failures are logged but don't fail the request.
- **Large diffs:** For complete rewrites, diff may be larger than full content. Consider storing snapshot if diff > content length (future optimization).
- **Savepoint overhead:** Using `begin_nested()` has slight overhead vs plain insert, but ensures parent transaction integrity on retry.
- **Event loop blocking:** Diff computation is CPU-bound. Milestone 0 benchmarks determine if thread pool is needed. If yes, wrap `patch_make` and `patch_apply` calls with `run_in_executor()`.

---

## Milestone 4a: Integrate History Recording into Services

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

   For updates, fetch previous content and metadata before modification. Skip history recording for no-op updates (when nothing actually changed):
   ```python
   async def update(self, db, user_id, entity_id, data, limits, context: RequestContext | None = None):
       entity = await self.get(db, user_id, entity_id, include_archived=True)
       if entity is None:
           return None

       # Capture state before modification for diff and no-op detection
       previous_content = entity.content
       previous_metadata = self._get_metadata_snapshot(entity)

       # ... existing update logic ...

       # Only record history if something actually changed
       current_metadata = self._get_metadata_snapshot(entity)
       content_changed = entity.content != previous_content
       metadata_changed = current_metadata != previous_metadata

       if context and (content_changed or metadata_changed):
           await history_service.record_action(
               db=db,
               user_id=user_id,
               entity_type=self.entity_type,
               entity_id=entity.id,
               action=ActionType.UPDATE,
               current_content=entity.content,
               previous_content=previous_content,
               metadata=current_metadata,
               context=context,
           )

       return entity
   ```

5. **Handle delete/restore/archive/unarchive:**

   Each operation records appropriate action type.

   **Soft delete:** Records DELETE action with final state, history preserved for potential restore.

   **Hard delete:** Delete all history for the entity, then delete the entity. No history record for the hard delete itself (entity and history are gone).

   ```python
   async def delete(
       self, db, user_id, entity_id, permanent: bool = False, context: RequestContext | None = None
   ) -> bool:
       """
       Delete an entity (soft or permanent). Returns True if deleted, False if not found.
       Maintains existing return type for backwards compatibility with routers.
       """
       entity = await self.get(
           db, user_id, entity_id, include_deleted=permanent, include_archived=True
       )
       if entity is None:
           return False

       if permanent:
           # Hard delete: cascade-delete history first (application-level cascade)
           await history_service.delete_entity_history(
               db, user_id, self.entity_type, entity_id
           )
           await db.delete(entity)
       else:
           # Soft delete: record history, then mark deleted
           if context:
               await history_service.record_action(
                   db=db,
                   user_id=user_id,
                   entity_type=self.entity_type,
                   entity_id=entity.id,
                   action=ActionType.DELETE,
                   current_content=None,  # Content is "gone"
                   previous_content=entity.content,
                   metadata=self._get_metadata_snapshot(entity),
                   context=context,
               )
           entity.deleted_at = func.clock_timestamp()

       await db.flush()
       return True
   ```

   Add to `HistoryService`:
   ```python
   async def delete_entity_history(
       self,
       db: AsyncSession,
       user_id: UUID,
       entity_type: EntityType | str,
       entity_id: UUID,
   ) -> int:
       """Delete all history for an entity. Called during hard delete."""
       entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type
       stmt = delete(ContentHistory).where(
           ContentHistory.user_id == user_id,
           ContentHistory.entity_type == entity_type_value,
           ContentHistory.entity_id == entity_id,
       )
       result = await db.execute(stmt)
       return result.rowcount
   ```

6. **Add history recording to str-replace endpoints:**

   The `str-replace` endpoints in `bookmarks.py`, `notes.py`, and `prompts.py` mutate content directly in the router, bypassing the service layer. Add history recording directly in these endpoints:

   ```python
   # In each str-replace endpoint, after the content update:
   context = get_request_context(request)
   if context:
       await history_service.record_action(
           db=db,
           user_id=current_user.id,
           entity_type=EntityType.BOOKMARK,  # or NOTE/PROMPT
           entity_id=bookmark.id,
           action=ActionType.UPDATE,
           current_content=result.new_content,
           previous_content=bookmark.content,  # Captured before modification
           metadata=bookmark_service._get_metadata_snapshot(bookmark),
           context=context,
       )
   ```

   Note: Capture `previous_content = entity.content` BEFORE setting `entity.content = result.new_content`.

### Context Parameter Documentation

The `context: RequestContext | None` parameter controls whether history is recorded:
- **When provided:** History is recorded with source/auth_type/token_prefix tracking
- **When None:** History recording is skipped (silent operation)

**Intentional uses of `context=None`:**
- Internal/system operations (e.g., future auto-archive cron jobs)
- Data migrations or cleanup scripts
- Operations where audit trail is not required

**Important:** For all user-initiated actions from routers, context MUST be provided. The router is responsible for calling `get_request_context(request)` and passing it to the service.

### Future Consideration: Bulk Operations

If bulk operations are added (e.g., "delete 100 notes"), consider:
- Whether to create N individual history records (accurate but slow)
- Whether to create a single "bulk delete" record with affected IDs in metadata
- Performance implications of large transactions

This is not blocking for V1 but should be considered if bulk endpoints are added later.

### Testing Strategy

1. **Integration tests per operation:**
   - Create bookmark → history record exists with CREATE action
   - Update bookmark → history record with UPDATE action and diff
   - Soft delete bookmark → history record with DELETE action (history preserved)
   - Hard delete bookmark → history cascade-deleted (no history remains)
   - Restore bookmark → history record with RESTORE action
   - Archive/unarchive → appropriate history records

2. **Context propagation tests:**
   - History records have correct source and auth_type
   - PAT requests have token_prefix in history
   - MCP requests have correct source (mcp-content or mcp-prompt)

3. **Diff verification:**
   - Update with content change produces valid diff
   - Update with metadata-only change (e.g., tags only) stores METADATA type with `content_diff=None`
   - Multiple updates produce correct version sequence

4. **Metadata-only changes:**
   - Tag-only change creates history record with METADATA diff type
   - Title-only change creates history record with METADATA diff type
   - History record has `content_diff=None` when content unchanged

5. **No-op update handling:**
   - Update with identical data (no changes) creates NO history entry
   - Update with only whitespace-equivalent changes (if normalized) creates NO history entry
   - Verify no-op detection compares both content AND metadata

6. **str-replace history tests:**
   - str-replace on bookmark creates history record with UPDATE action
   - str-replace on note creates history record
   - str-replace on prompt creates history record
   - History has correct previous_content and current_content
   - History has correct source from request context

### Dependencies
Milestone 3 (HistoryService)

### Risk Factors
- **Transaction boundaries:** History must be recorded in same transaction as entity change. Using `db.flush()` (not commit) ensures atomicity.
- **Performance:** Extra comparison for no-op detection is negligible.

---

## Milestone 4b: Performance Validation

### Goal
Validate that content versioning does not unacceptably degrade API performance by comparing benchmarks before and after implementation.

### Success Criteria
- API benchmark run at 1KB and 50KB content sizes
- Results compared against Milestone 0 baseline
- Overhead within acceptable thresholds (see table below)
- Results documented in this milestone

### Key Changes

1. **Run API benchmarks:**
   ```bash
   # Temporarily increase tier limits (see performance/api/README.md)
   uv run python performance/api/benchmark.py --content-size 1
   uv run python performance/api/benchmark.py --content-size 50
   # Revert tier limit changes
   ```

2. **Compare against baseline and document results below**

### Acceptance Criteria

| Metric | Baseline | Acceptable Overhead |
|--------|----------|---------------------|
| Create Note P95 (1KB, conc=10) | 41ms | < 60ms (+50%) |
| Update Note P95 (1KB, conc=10) | 42ms | < 65ms (+55%) |
| Create Note P95 (50KB, conc=10) | 40ms | < 60ms (+50%) |
| Update Note P95 (50KB, conc=10) | 119ms | < 180ms (+50%) |

**Rationale:** The overhead comes from:
- Extra DB write for history record (~5-15ms)
- Diff computation (~0.2ms for typical edits, negligible)

A 50% overhead at P95 is acceptable given the value of content versioning.

### Troubleshooting

If overhead exceeds thresholds, investigate:
- Index efficiency on `content_history` table
- Whether history insert is blocking the response
- Connection pool saturation

### Results

_(To be filled in after running benchmarks)_

**1KB Content Results:**
```
TBD
```

**50KB Content Results:**
```
TBD
```

**Comparison:**

| Metric | Baseline | After | Overhead |
|--------|----------|-------|----------|
| Create Note P95 (1KB, conc=10) | 41ms | TBD | TBD |
| Update Note P95 (1KB, conc=10) | 42ms | TBD | TBD |
| Create Note P95 (50KB, conc=10) | 40ms | TBD | TBD |
| Update Note P95 (50KB, conc=10) | 119ms | TBD | TBD |

**Conclusion:** _(Pass/Fail + notes)_

### Dependencies
Milestone 4a (history recording integrated)

### Risk Factors
- If overhead is too high, may need to optimize history insert (e.g., background task, batch writes)

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
       result = await history_service.reconstruct_content_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       if not result.found:
           raise HTTPException(status_code=404, detail="Version not found")

       # Get metadata from that version
       history = await history_service.get_history_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       return ContentAtVersionResponse(
           entity_id=entity_id,
           version=version,
           content=result.content,  # May be None for delete actions - that's valid
           metadata=history.metadata_snapshot if history else None,
       )
   ```

3. **Register router in `main.py`**

4. **Add per-entity history endpoints to existing routers:**

   **Note:** History is cascade-deleted when an entity is hard-deleted, so these endpoints will return empty results for hard-deleted entities. Soft-deleted entities retain their history.

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
       """
       Get history for a specific bookmark.

       Returns empty list if entity was hard-deleted (history cascade-deleted)
       or if no history exists for this entity_id.
       """
       # Query history directly - don't check entity existence
       # This allows viewing history of deleted items
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
   - Get content at version returns reconstructed content with `found=True`
   - Get content at version with None content (delete) returns `found=True, content=None`
   - 404 only for non-existent version (`found=False`), not for None content

2. **Authorization tests:**
   - Cannot access another user's history
   - PAT can access history (read operation)

3. **Pagination tests:**
   - Limit and offset work correctly
   - Total count reflects all matching records, not just current page
   - Edge cases: offset beyond total, empty results

4. **Deleted entity tests:**
   - Get history for soft-deleted entity returns history records (history preserved)
   - Get history for hard-deleted entity returns empty list (history cascade-deleted)
   - Get history for entity that never existed returns empty list (not 404)

### Dependencies
Milestone 4 (history recording integrated)

### Risk Factors
- **Large history:** Users with many changes may have slow queries. Indexes should help.
- **Hard-deleted entities:** History is cascade-deleted at application level, so no orphaned history exists.

---

## Milestone 6: Undo/Revert Functionality

### Goal
Allow users to revert content to a previous version.

### Success Criteria
- Users can revert content to any previous version (v1+)
- Revert creates a new history entry (not deletion of history)
- Edge cases handled (deleted items, URL conflicts, archived items)
- Revert delegates to entity-specific services for validation
- **Note:** "Undo create" is not a revert operation—use the existing DELETE endpoint instead

### Key Changes

1. **Add revert endpoint:**
   ```python
   @router.post("/{entity_type}/{entity_id}/revert/{version}")
   async def revert_to_version(
       entity_type: EntityType,
       entity_id: UUID,
       version: int = Path(..., ge=1),  # version >= 1 (use DELETE endpoint for "undo create")
       request: Request,
       current_user: User = Depends(get_current_user),
       limits: TierLimits = Depends(get_current_limits),
       db: AsyncSession = Depends(get_async_session),
   ):
       """
       Revert entity to a previous version.

       Restores content/metadata from the specified version (creates new UPDATE history entry).
       The revert operation delegates to the entity-specific service for validation.

       Note: To "undo create" (delete the entity), use the DELETE endpoint instead.
       Revert is specifically for restoring to a previous content state.
       """
       context = get_request_context(request)
       service = _get_service_for_entity_type(entity_type)

       # Check if entity exists (may be deleted)
       entity = await service.get(
           db, current_user.id, entity_id, include_deleted=True, include_archived=True
       )

       if entity is None:
           # Entity was permanently deleted - cannot restore
           raise HTTPException(status_code=404, detail="Entity not found")

       # Restore to the specified version
       result = await history_service.reconstruct_content_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       if not result.found:
           raise HTTPException(status_code=404, detail="Version not found")

       # Get metadata from that version
       history = await history_service.get_history_at_version(
           db, current_user.id, entity_type, entity_id, version
       )
       if history is None:
           raise HTTPException(status_code=404, detail="Version not found")

       if entity.deleted_at is not None:
           # Entity is soft-deleted - restore it first
           await service.restore(db, current_user.id, entity_id, context=context)

       # Update entity with restored content
       # This will record a new UPDATE history entry
       # Service handles validation (URL/name uniqueness, etc.)
       update_data = _build_update_from_history(entity_type, result.content, history.metadata_snapshot)
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
   - **Archived item:** Revert preserves archive state (content is restored but item stays archived)
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
       """
       Build an update schema from history data.

       Handles schema evolution gracefully:
       - Unknown fields in metadata (from newer schema): ignored
       - Missing fields in metadata (from older schema): omitted from update,
         preserving the entity's current value for that field

       Tags are restored by name. The service layer creates missing tags
       automatically (existing behavior).
       """
       from schemas.bookmark import BookmarkUpdate
       from schemas.note import NoteUpdate
       from schemas.prompt import PromptUpdate

       # Common fields across all entity types
       common_fields = {
           "content": content,
           "title": metadata.get("title"),
           "description": metadata.get("description"),
           "tags": metadata.get("tags", []),  # List of tag names
       }

       if entity_type == EntityType.BOOKMARK:
           return BookmarkUpdate(
               **common_fields,
               url=metadata.get("url"),  # Bookmark-specific
           )
       elif entity_type == EntityType.NOTE:
           return NoteUpdate(**common_fields)
       elif entity_type == EntityType.PROMPT:
           return PromptUpdate(
               **common_fields,
               name=metadata.get("name"),        # Prompt-specific
               arguments=metadata.get("arguments", []),
           )
       else:
           raise ValueError(f"Unknown entity type: {entity_type}")
   ```

   **Schema evolution handling:**
   - If `metadata_snapshot` from an old version lacks a field that exists in the current schema (e.g., a new `favicon_url` field added to bookmarks), that field is simply not included in the update. The entity retains its current value for that field.
   - If `metadata_snapshot` contains a field that no longer exists in the schema, it's ignored (dict.get() returns None, and Pydantic ignores extra fields or the field is simply not used).
   - Tags are stored as names (strings). When restoring, if a tag name no longer exists, the service layer creates it automatically (this is existing behavior in tag handling).

### Testing Strategy

1. **Basic revert tests:**
   - Revert to version 1 restores original content
   - Revert creates new history entry (UPDATE action)
   - Reverted content matches target version
   - Reverted metadata matches target version

2. **Edge case tests:**
   - Revert soft-deleted item (should restore + update)
   - Revert archived item preserves archived_at (content restored, stays archived)
   - Revert to version with URL that now conflicts (should 409)
   - Revert to version with name that now conflicts (should 409)
   - Revert permanently deleted item (should 404)
   - Revert to non-existent version (should 404)
   - Revert to version with None content (e.g., delete snapshot) handles gracefully

3. **Tag restoration:**
   - Tags from target version are restored
   - Current tags are replaced
   - Missing tags are created automatically
   - **Note:** Reverting restores the exact tag set from that version, including tags that were subsequently deleted

5. **Schema evolution tests:**
   - Revert to version with fewer metadata fields than current schema (missing fields preserved from current entity)
   - Revert to version with extra metadata fields (unknown fields ignored)
   - `_build_update_from_history` handles missing optional fields gracefully

### Dependencies
Milestone 5 (history endpoints)

### Risk Factors
- **Conflict handling:** URL/name uniqueness constraints may prevent restoration. Clear error messages provided.
- **Tag restoration:** Tags in metadata_snapshot are names; service creates missing tags automatically.

---

## Milestone 7: Tier-Based Retention

### Goal
Implement retention limits based on user tier with appropriate cleanup strategies for each limit type.

### Success Criteria
- Count limits enforced inline on write (predictable, immediate)
- Time limits enforced via scheduled cron job (appropriate for aged data)
- Latest snapshot always preserved (reverse diffs make cleanup simple)
- Tier limits configurable in TierLimits dataclass

### Retention Strategy

Different cleanup types warrant different strategies:

| Cleanup Type | Trigger | Rationale |
|--------------|---------|-----------|
| Count limit (`max_history_per_entity`) | Inline on write | Predictable, matches user expectations |
| Time limit (`history_retention_days`) | Scheduled cron | Appropriate for aged data, handles inactive users |
| Soft-delete expiry | Scheduled cron | User already deleted, expects eventual removal |

**Why NOT random cleanup on GET requests:**
- Violates REST semantics (GET should not have write side effects)
- Unpredictable latency spikes
- Inactive users never cleaned
- Poor UX for count limits (records suddenly disappear)

### Key Changes

1. **Add to `TierLimits` dataclass in `backend/src/core/tier_limits.py`:**
   ```python
   history_retention_days: int = 30  # How long to keep history
   max_history_per_entity: int = 100  # Max versions per entity
   ```

2. **Inline count-based cleanup with modulo check in `record_action()`:**

   Enforce count limits at write time using modulo-based checking to avoid per-write overhead:
   ```python
   PRUNE_CHECK_INTERVAL = 10  # Check every 10th write

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
       limits: TierLimits,  # Add limits parameter
   ) -> ContentHistory:
       """Record a history entry for an action."""
       # ... existing retry loop and _record_action_impl call ...

       # After successful insert, check if pruning needed (every 10th write)
       # This avoids COUNT query overhead on every write while keeping overage bounded
       if history.version % PRUNE_CHECK_INTERVAL == 0:
           count = await self._get_entity_history_count(db, user_id, entity_type, entity_id)
           if count > limits.max_history_per_entity:
               await self._prune_to_limit(
                   db, user_id, entity_type, entity_id,
                   target=limits.max_history_per_entity,
               )

       return history

   async def _get_entity_history_count(
       self,
       db: AsyncSession,
       user_id: UUID,
       entity_type: EntityType | str,
       entity_id: UUID,
   ) -> int:
       """Count history records for an entity."""
       entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type
       stmt = (
           select(func.count())
           .select_from(ContentHistory)
           .where(
               ContentHistory.user_id == user_id,
               ContentHistory.entity_type == entity_type_value,
               ContentHistory.entity_id == entity_id,
           )
       )
       return (await db.execute(stmt)).scalar_one()

   async def _prune_to_limit(
       self,
       db: AsyncSession,
       user_id: UUID,
       entity_type: EntityType | str,
       entity_id: UUID,
       target: int,
   ) -> int:
       """
       Prune oldest history records to reach target count.

       With REVERSE diffs, cleanup is simple:
       - We only need the LATEST snapshot for reconstruction (not old ones)
       - Just delete the oldest records beyond the target count
       - No need to preserve old snapshots

       Returns number of records deleted.
       """
       entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type

       # Find the version number at the cutoff point (keep 'target' most recent)
       cutoff_stmt = (
           select(ContentHistory.version)
           .where(
               ContentHistory.user_id == user_id,
               ContentHistory.entity_type == entity_type_value,
               ContentHistory.entity_id == entity_id,
           )
           .order_by(ContentHistory.version.desc())
           .offset(target - 1)  # Keep 'target' most recent
           .limit(1)
       )
       result = await db.execute(cutoff_stmt)
       cutoff_version = result.scalar_one_or_none()

       if cutoff_version is None:
           return 0  # Not enough records to prune

       # Simply delete all records older than cutoff
       # No need to preserve old snapshots with reverse diffs!
       delete_stmt = delete(ContentHistory).where(
           ContentHistory.user_id == user_id,
           ContentHistory.entity_type == entity_type_value,
           ContentHistory.entity_id == entity_id,
           ContentHistory.version < cutoff_version,
       )

       result = await db.execute(delete_stmt)
       return result.rowcount
   ```

   **Why inline over background tasks:**
   - The operation is trivial (~3ms for 10-row delete by indexed columns)
   - Same transaction ensures atomicity
   - No async complexity or failure handling

   **Why modulo-based checking (every 10th write):**
   - Avoids COUNT query on every write (90% reduction in overhead)
   - Achieves same goal as hysteresis: prune every ~10 writes at capacity, not every write
   - Simpler than high-water mark calculation
   - Deterministic and easy to test
   - Max overage bounded to ~10 records (same as hysteresis approach)

3. **Scheduled cron job for time-based cleanup:**

   Railway supports cron jobs on all plans. Create a separate service in the same project:

   **Project structure:**
   ```
   Railway Project
   ├── api (web service, always running)
   ├── cleanup (cron service, runs daily)  ← Same codebase, different entrypoint
   ├── postgres
   └── redis
   ```

   **Configuration in `railway.toml` (for cleanup service):**
   ```toml
   [deploy]
   startCommand = "uv run python -m tasks.cleanup"
   cronSchedule = "0 3 * * *"  # 3 AM UTC daily
   ```

   **Create `backend/src/tasks/cleanup.py`:**
   ```python
   import asyncio
   import logging
   from datetime import datetime, timedelta

   from sqlalchemy import delete, select

   from db.session import async_session_factory
   from models.content_history import ContentHistory, DiffType
   from models.bookmark import Bookmark
   from models.note import Note
   from models.prompt import Prompt
   from core.tier_limits import get_tier_limits

   logger = logging.getLogger(__name__)

   async def cleanup_expired_history(db) -> dict:
       """
       Delete history records based on per-user tier retention limits.

       Each user's tier determines their history_retention_days.
       Retention applies uniformly to all of a user's entities regardless of state
       (active, archived, or soft-deleted).

       Returns dict with counts per tier for logging.
       """
       from models.user import User

       deleted_by_tier: dict[str, int] = {}

       # Get all users with their tiers
       users_result = await db.execute(select(User))
       users = users_result.scalars().all()

       for user in users:
           limits = get_tier_limits(user.tier)
           cutoff_date = datetime.utcnow() - timedelta(days=limits.history_retention_days)

           stmt = delete(ContentHistory).where(
               ContentHistory.user_id == user.id,
               ContentHistory.created_at < cutoff_date,
           )
           result = await db.execute(stmt)

           tier_name = user.tier or "free"
           deleted_by_tier[tier_name] = deleted_by_tier.get(tier_name, 0) + result.rowcount

       return deleted_by_tier

   async def cleanup_soft_deleted_items(db, expiry_days: int = 30) -> dict:
       """
       Permanently delete soft-deleted items older than expiry_days.
       History is cascade-deleted at application level.
       """
       cutoff_date = datetime.utcnow() - timedelta(days=expiry_days)
       deleted_counts = {"bookmarks": 0, "notes": 0, "prompts": 0}

       for model, key in [(Bookmark, "bookmarks"), (Note, "notes"), (Prompt, "prompts")]:
           # Find expired soft-deleted items
           stmt = select(model).where(
               model.deleted_at.is_not(None),
               model.deleted_at < cutoff_date,
           )
           result = await db.execute(stmt)
           items = result.scalars().all()

           for item in items:
               # Delete history first (application-level cascade)
               from services.history_service import history_service
               entity_type = key[:-1]  # "bookmarks" -> "bookmark"
               await history_service.delete_entity_history(
                   db, item.user_id, entity_type, item.id
               )
               await db.delete(item)
               deleted_counts[key] += 1

       return deleted_counts

   async def main():
       """Nightly cleanup for time-based retention policies."""
       logger.info("Starting scheduled cleanup")

       async with async_session_factory() as db:
           # 1. Permanently delete soft-deleted items older than 30 days
           deleted = await cleanup_soft_deleted_items(db)
           logger.info(f"Deleted expired soft-deleted items: {deleted}")

           # 2. Prune history based on per-user tier retention limits
           history_deleted = await cleanup_expired_history(db)
           logger.info(f"Deleted expired history records by tier: {history_deleted}")

           await db.commit()

       logger.info("Scheduled cleanup complete")

   if __name__ == "__main__":
       logging.basicConfig(level=logging.INFO)
       asyncio.run(main())
   ```

4. **Update `record_action` callers to pass `limits`:**

   Service methods already have access to `limits` parameter. Pass it through to `record_action()`.

   Example update in `BaseEntityService.update()`:
   ```python
   async def update(self, db, user_id, entity_id, data, limits, context: RequestContext | None = None):
       # ... existing code ...

       if context and (content_changed or metadata_changed):
           await history_service.record_action(
               db=db,
               user_id=user_id,
               entity_type=self.entity_type,
               entity_id=entity.id,
               action=ActionType.UPDATE,
               current_content=entity.content,
               previous_content=previous_content,
               metadata=current_metadata,
               context=context,
               limits=limits,  # Pass limits for count-based pruning
           )
   ```

   Similarly update `create()` in each concrete service and `delete()`/`restore()`/`archive()`/`unarchive()` in `BaseEntityService`.

### Orphan History Cleanup (Defense-in-Depth)

Although application-level cascade should prevent orphaned history, edge cases may occur (direct SQL, failed transactions, etc.). The nightly cron job can include an orphan cleanup query:

```python
async def cleanup_orphaned_history(db) -> int:
    """
    Delete history records whose entities no longer exist.
    Defense-in-depth for edge cases where application-level cascade failed.
    """
    # This query finds history records with no matching entity
    # Run periodically (e.g., weekly) as a maintenance task
    orphan_stmt = """
    DELETE FROM content_history h
    WHERE NOT EXISTS (
        SELECT 1 FROM bookmarks WHERE id = h.entity_id AND h.entity_type = 'bookmark'
    ) AND NOT EXISTS (
        SELECT 1 FROM notes WHERE id = h.entity_id AND h.entity_type = 'note'
    ) AND NOT EXISTS (
        SELECT 1 FROM prompts WHERE id = h.entity_id AND h.entity_type = 'prompt'
    )
    """
    result = await db.execute(text(orphan_stmt))
    return result.rowcount
```

### Testing Strategy

1. **Count-based limit tests (inline with modulo check):**
   - At version % 10 != 0, no COUNT query executed
   - At version % 10 == 0, COUNT query checks if over limit
   - When over limit, prune triggers and removes oldest records
   - With reverse diffs, no special snapshot preservation needed—just delete oldest
   - Prune happens every 10 writes at capacity, not every write

2. **Time-based limit tests (cron):**
   - Records older than retention_days are deleted
   - Records newer than retention_days are preserved
   - Retention applies uniformly to active, archived, and soft-deleted entities

3. **Soft-delete expiry tests:**
   - Soft-deleted items older than expiry are permanently deleted
   - History is cascade-deleted with the entity
   - Items not yet expired are preserved

4. **Tier limit tests:**
   - Different tiers have different retention limits
   - Limits are read from TierLimits dataclass

5. **Orphan cleanup tests:**
   - Orphaned history records are identified and deleted
   - Valid history records are preserved

6. **Edge cases:**
   - Entity with only snapshots (no diffs) - all kept within limits
   - Cleanup with no records to delete - no errors
   - Concurrent writes during prune handled correctly

### Dependencies
Milestone 4 (history recording)

### Risk Factors
- **Reverse diff simplicity:** With reverse diffs, cleanup is straightforward—just delete oldest records. The latest snapshot is always preserved and that's all we need for reconstruction.
- **Cron job reliability:** Railway cron should be reliable, but monitor for failures.

### Tier Downgrade Behavior

When a user downgrades to a tier with lower retention limits:
- **Count limits:** Over-limit history is pruned on the user's next 10th-version write (modulo check triggers)
- **Time limits:** Over-limit history is pruned at the next cron run (nightly)

There is no immediate mass-deletion on downgrade—history is cleaned up lazily through the normal mechanisms. This means users may temporarily retain more history than their tier allows.

---

## Milestone 8: Frontend History UI

### Goal
Add frontend components for viewing history globally and per-item, with diff visualization and restore functionality.

### Success Criteria
- Users can view all content history in Settings → Version History
- Users can view per-item history via right sidebar
- GitHub-style diff visualization between versions
- Restore with inline confirmation pattern
- Responsive design for sidebar

### Key Changes

#### 1. Install diff viewer library

```bash
cd frontend && npm install react-diff-viewer-continued
```

#### 2. Add X-Request-Source header to Axios instance

In `frontend/src/services/api.ts`, add the source header to all requests:

```typescript
export const api = axios.create({
  baseURL: config.apiUrl,
  headers: {
    'X-Request-Source': 'web',  // Identifies requests from the web UI
  },
})
```

#### 3. Create history API hooks in `frontend/src/hooks/useHistory.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface HistoryEntry {
  id: string;
  entity_type: 'bookmark' | 'note' | 'prompt';
  entity_id: string;
  action: 'create' | 'update' | 'delete' | 'restore' | 'archive' | 'unarchive';
  version: number;
  diff_type: 'snapshot' | 'diff';
  metadata_snapshot: Record<string, unknown> | null;
  source: string;
  auth_type: string;
  created_at: string;
}

interface HistoryListResponse {
  items: HistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

interface ContentAtVersion {
  entity_id: string;
  version: number;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

// Fetch all user history (for Settings page)
export function useUserHistory(params: {
  entityType?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery<HistoryListResponse>({
    queryKey: ['history', params],
    queryFn: async () => {
      const response = await api.get<HistoryListResponse>('/history', { params });
      return response.data;
    },
  });
}

// Fetch history for a specific entity (for sidebar)
export function useEntityHistory(
  entityType: string,
  entityId: string,
  params: { limit?: number; offset?: number }
) {
  return useQuery<HistoryListResponse>({
    queryKey: ['history', entityType, entityId, params],
    queryFn: async () => {
      const response = await api.get<HistoryListResponse>(`/history/${entityType}/${entityId}`, { params });
      return response.data;
    },
    enabled: !!entityId,
  });
}

// Fetch content at a specific version (for diff view)
export function useContentAtVersion(
  entityType: string,
  entityId: string,
  version: number
) {
  return useQuery<ContentAtVersion>({
    queryKey: ['history', entityType, entityId, 'version', version],
    queryFn: async () => {
      const response = await api.get<ContentAtVersion>(`/history/${entityType}/${entityId}/version/${version}`);
      return response.data;
    },
    enabled: !!entityId && version >= 1,
  });
}

// Revert to a specific version
export function useRevertToVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entityType, entityId, version }: {
      entityType: string;
      entityId: string;
      version: number;
    }) => {
      const response = await api.post(`/history/${entityType}/${entityId}/revert/${version}`);
      return response.data;
    },
    onSuccess: (_, { entityType, entityId }) => {
      // Invalidate entity and history queries
      queryClient.invalidateQueries({ queryKey: [entityType] });
      queryClient.invalidateQueries({ queryKey: ['history', entityType, entityId] });
    },
  });
}
```

#### 4. Create HistorySidebar component in `frontend/src/components/HistorySidebar.tsx`

```typescript
import { useState } from 'react';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { useEntityHistory, useContentAtVersion, useRevertToVersion } from '../hooks/useHistory';

interface HistorySidebarProps {
  entityType: 'bookmark' | 'note' | 'prompt';
  entityId: string;
  currentContent: string;
  onClose: () => void;
}

export function HistorySidebar({ entityType, entityId, currentContent, onClose }: HistorySidebarProps) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null);

  const { data: history, isLoading } = useEntityHistory(entityType, entityId, { limit: 50 });
  const { data: versionContent } = useContentAtVersion(
    entityType,
    entityId,
    selectedVersion ?? 1
  );
  const revertMutation = useRevertToVersion();

  const handleRevertClick = (version: number) => {
    if (confirmingRevert === version) {
      // Second click - execute revert
      revertMutation.mutate(
        { entityType, entityId, version },
        { onSuccess: () => setConfirmingRevert(null) }
      );
    } else {
      // First click - show confirm
      setConfirmingRevert(version);
    }
  };

  const formatAction = (action: string) => {
    const labels: Record<string, string> = {
      create: 'Created',
      update: 'Updated',
      delete: 'Deleted',
      restore: 'Restored',
      archive: 'Archived',
      unarchive: 'Unarchived',
    };
    return labels[action] || action;
  };

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white dark:bg-gray-800 shadow-lg border-l border-gray-200 dark:border-gray-700 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold">Version History</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <XIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4">Loading...</div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {history?.items.map((entry) => (
              <li
                key={entry.id}
                className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  selectedVersion === entry.version ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
                onClick={() => setSelectedVersion(entry.version)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">v{entry.version}</span>
                    <span className="ml-2 text-sm text-gray-500">
                      {formatAction(entry.action)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {/* Show "Restore" button on older versions (not the latest) */}
                    {entry.version < (history?.items[0]?.version ?? 1) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRevertClick(entry.version);
                        }}
                        className={`px-3 py-1 text-sm rounded ${
                          confirmingRevert === entry.version
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300'
                        }`}
                      >
                        {confirmingRevert === entry.version ? 'Confirm' : 'Restore'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(entry.created_at).toLocaleString()}
                  {' · '}
                  {entry.source} · {entry.auth_type}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Diff view */}
      {selectedVersion && versionContent && (
        <div className="border-t border-gray-200 dark:border-gray-700 h-1/2 overflow-auto">
          <div className="p-2 bg-gray-100 dark:bg-gray-700 text-sm font-medium">
            Changes in v{selectedVersion}
          </div>
          <ReactDiffViewer
            oldValue={versionContent.content ?? ''}
            newValue={currentContent}
            splitView={false}
          />
        </div>
      )}
    </div>
  );
}
```

#### 5. Add history toggle button to item headers

In each item detail component (BookmarkDetail, NoteDetail, PromptDetail), add a history icon button:

```typescript
// In the header actions area, left of Archive|Delete
<button
  onClick={() => setShowHistory(!showHistory)}
  className="p-2 text-gray-500 hover:text-gray-700"
  title="Version history"
>
  <HistoryIcon className="w-5 h-5" />
</button>

// Render sidebar when open
{showHistory && (
  <HistorySidebar
    entityType="bookmark" // or "note" / "prompt"
    entityId={item.id}
    currentContent={item.content}
    onClose={() => setShowHistory(false)}
  />
)}
```

#### 6. Create Settings Version History page

Create `frontend/src/pages/settings/SettingsVersionHistory.tsx` (following existing naming convention):

```typescript
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserHistory } from '../../hooks/useHistory';

export function SettingsVersionHistory() {
  const [entityTypeFilter, setEntityTypeFilter] = useState<string | undefined>();
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data: history, isLoading } = useUserHistory({
    entityType: entityTypeFilter,
    limit,
    offset: page * limit,
  });

  const formatAction = (action: string) => {
    const labels: Record<string, string> = {
      create: 'Created',
      update: 'Updated',
      delete: 'Deleted',
      restore: 'Restored',
      archive: 'Archived',
      unarchive: 'Unarchived',
    };
    return labels[action] || action;
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'bookmark': return <BookmarkIcon className="w-4 h-4" />;
      case 'note': return <NoteIcon className="w-4 h-4" />;
      case 'prompt': return <PromptIcon className="w-4 h-4" />;
      default: return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Version History</h1>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setEntityTypeFilter(undefined)}
          className={`px-3 py-1 rounded ${!entityTypeFilter ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          All
        </button>
        {['bookmark', 'note', 'prompt'].map((type) => (
          <button
            key={type}
            onClick={() => setEntityTypeFilter(type)}
            className={`px-3 py-1 rounded capitalize ${
              entityTypeFilter === type ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
          >
            {type}s
          </button>
        ))}
      </div>

      {/* History list */}
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <>
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-2">Type</th>
                <th className="pb-2">Item</th>
                <th className="pb-2">Action</th>
                <th className="pb-2">Source</th>
                <th className="pb-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {history?.items.map((entry) => (
                <tr key={entry.id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="py-3">
                    <span className="flex items-center gap-1">
                      {getEntityIcon(entry.entity_type)}
                      <span className="capitalize">{entry.entity_type}</span>
                    </span>
                  </td>
                  <td className="py-3">
                    <Link
                      to={`/app/${entry.entity_type}s/${entry.entity_id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {entry.metadata_snapshot?.title || entry.metadata_snapshot?.name || 'Untitled'}
                    </Link>
                  </td>
                  <td className="py-3">{formatAction(entry.action)}</td>
                  <td className="py-3 text-sm text-gray-500">
                    {entry.source} · {entry.auth_type}
                  </td>
                  <td className="py-3 text-sm text-gray-500">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {page * limit + 1}-{Math.min((page + 1) * limit, history?.total ?? 0)} of {history?.total ?? 0}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 rounded bg-gray-200 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * limit >= (history?.total ?? 0)}
                className="px-3 py-1 rounded bg-gray-200 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

#### 7. Add route and navigation

In `frontend/src/App.tsx` router config (note the `/app` prefix to match existing routes):
```typescript
// In App.tsx, add import:
import { SettingsVersionHistory } from './pages/settings/SettingsVersionHistory'

// Inside the /app/settings/* route group
{ path: '/app/settings/history', element: <SettingsVersionHistory /> },
```

In Settings sidebar navigation (likely in `frontend/src/components/AppLayout.tsx` or similar):
```typescript
<NavLink to="/app/settings/history">Version History</NavLink>
```

### Testing Strategy

1. **Hook tests:**
   - `useUserHistory` fetches and caches correctly
   - `useEntityHistory` fetches entity-specific history
   - `useContentAtVersion` fetches version content
   - `useRevertToVersion` calls API and invalidates cache

2. **HistorySidebar tests:**
   - Renders version list
   - Clicking version shows diff
   - Restore button shows confirm state on first click
   - Confirm executes revert mutation
   - Close button calls onClose

3. **SettingsVersionHistory tests:**
   - Renders history table
   - Filter buttons work
   - Pagination works
   - Links to entity detail pages

4. **Integration tests:**
   - Full flow: make edit → open sidebar → see new version → restore old version
   - Settings page shows all content types

### Dependencies
Milestone 5 (History API endpoints)

### Risk Factors
- **Sidebar width:** 384px (w-96) may need adjustment on smaller screens. Consider responsive breakpoints.
- **Diff performance:** Very large content may slow diff rendering. Consider truncating or lazy loading for huge documents.

---

## Milestone 9: Documentation Update

### Goal
Document the versioning system for developers and users across all relevant documentation.

### Success Criteria
- CLAUDE.md has clear section on content versioning
- README.md mentions the feature
- Landing page includes version history in feature list (if applicable)
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
   - Token prefix for PAT requests (audit trail, e.g., "bm_a3f8...")

   **Diff Storage (Reverse Diffs):**
   - Full snapshots every 10 versions (or METADATA type for metadata-only changes)
   - Character-level reverse diffs using diff-match-patch (stores how to go backwards)
   - Reconstruct any version by starting from latest snapshot, applying reverse diffs backwards

   **API Endpoints:**
   - `GET /history` - All user history
   - `GET /history/{type}/{id}` - Entity history
   - `GET /history/{type}/{id}/version/{v}` - Content at version
   - `POST /history/{type}/{id}/revert/{v}` - Revert to version
   - `GET /bookmarks/{id}/history` - Bookmark history (etc. for notes/prompts)

   **Retention:**
   - Tier-based: `history_retention_days`, `max_history_per_entity`
   - Count limits: enforced inline every 10th write (modulo check)
   - Time limits: enforced via nightly cron job
   - Cleanup is simple with reverse diffs: just delete oldest records, keep latest snapshot
   ```

2. **Update README.md:**

   Add to Features section:
   ```markdown
   ## Features
   - **Content Versioning** — Full edit history for bookmarks, notes, and prompts.
     View diffs, see who made changes, and restore any previous version.
   ```

3. **Update landing page (if feature list exists):**

   Add to feature highlights:
   ```
   Version History — Every edit is tracked. See what changed, when, and restore
   any previous version with one click. Your work is never lost.
   ```

4. **Add API documentation comments to endpoints**

5. **Create changelog entry (or release notes):**
   ```markdown
   ## [Version X.X.X] - YYYY-MM-DD

   ### Added
   - **Content Versioning**: Full edit history for all content types
     - View history for bookmarks, notes, and prompts
     - See what changed with diff visualization
     - Restore any previous version with one click
     - Track who/what made changes (web, API, MCP)
   ```

### Dependencies
All previous milestones

### Risk Factors
None

---

## Summary of Files Changed

### New Files

**Backend:**
- `backend/src/models/content_history.py` - ContentHistory model
- `backend/src/services/history_service.py` - History service
- `backend/src/schemas/history.py` - History Pydantic schemas
- `backend/src/api/routers/history.py` - History API endpoints
- `backend/tests/services/test_history_service.py` - History service tests
- `backend/tests/api/test_history.py` - History API tests
- `backend/src/db/migrations/versions/<hash>_add_content_history.py` - Migration

**Frontend:**
- `frontend/src/hooks/useHistory.ts` - API hooks for history queries and mutations
- `frontend/src/components/HistorySidebar.tsx` - Per-item history sidebar with diff viewer
- `frontend/src/pages/settings/SettingsVersionHistory.tsx` - Global history page

### Deleted Files
- `backend/src/models/note_version.py` - Superseded by ContentHistory

### Modified Files

**Backend:**
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
- `backend/pyproject.toml` - Add diff-match-patch dependency

**Frontend:**
- `frontend/src/services/api.ts` - Add X-Request-Source: web header
- `frontend/src/pages/BookmarkDetail.tsx` - Add history toggle button, render sidebar
- `frontend/src/pages/NoteDetail.tsx` - Add history toggle button, render sidebar
- `frontend/src/pages/PromptDetail.tsx` - Add history toggle button, render sidebar
- `frontend/src/components/AppLayout.tsx` - Add Version History nav link (or wherever settings nav is)
- `frontend/src/App.tsx` - Add /app/settings/history route
- `frontend/package.json` - Add react-diff-viewer-continued dependency

**Documentation:**
- `CLAUDE.md` - Document versioning system

---

## Open Questions for User

1. **Retention defaults:** Are `history_retention_days=30` and `max_history_per_entity=100` reasonable defaults for the free tier?
