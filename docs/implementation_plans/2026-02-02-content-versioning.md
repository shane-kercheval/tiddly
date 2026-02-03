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

## Diff Strategy: diff-match-patch

Use Google's diff-match-patch algorithm for text diffing:
- Store full snapshot every N versions (default: 10, may adjust based on Milestone 0 benchmarks)
- Store character-level diffs between snapshots
- Reconstruct any version by: find nearest prior snapshot, apply diffs forward
- **Note:** Milestone 0 benchmarks will validate these defaults and determine if thread pool is needed

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
- **Source:** "web" | "api" | "mcp-content" | "mcp-prompt" | "unknown"
- **Auth type:** "auth0" | "pat" | "dev"
- **Token ID:** UUID of PAT if used (for audit trail)

**Source Detection via `X-Request-Source` Header:**
- Frontend sends `X-Request-Source: web`
- MCP Content server sends `X-Request-Source: mcp-content`
- MCP Prompt server sends `X-Request-Source: mcp-prompt`
- CLI/scripts using PATs can send `X-Request-Source: api` (optional)
- Missing or unrecognized header defaults to `unknown` (not `api`)

This is spoofable but acceptable - source tracking is for audit/telemetry, not access control.

---

## Milestone 0: Diff Performance Benchmarking

### Goal
Validate diff-match-patch performance characteristics before building the history service. Establish thresholds and make informed decisions about implementation approach (sync vs thread pool, snapshot intervals, size limits).

### Success Criteria
- Benchmark results documented for various content sizes and change patterns
- Decision made: sync implementation vs thread pool from start
- Snapshot interval validated or adjusted based on reconstruction performance
- Content size threshold established for forced snapshots (if needed)

### Benchmark Script

Create `backend/scripts/benchmark_diff.py`:

```python
"""
Benchmark diff-match-patch performance for content versioning.

Run with: uv run python backend/scripts/benchmark_diff.py
"""
import asyncio
import statistics
import time
from dataclasses import dataclass

from diff_match_patch import diff_match_patch


@dataclass
class BenchmarkResult:
    operation: str
    content_size: str
    change_type: str
    iterations: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float


def generate_content(size_kb: int) -> str:
    """Generate realistic text content of approximately size_kb."""
    # Mix of paragraphs, code-like content, and lists
    base = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " * 20
    return (base * ((size_kb * 1024) // len(base) + 1))[:size_kb * 1024]


def apply_small_change(content: str) -> str:
    """Simulate small edit - change ~1% of content."""
    mid = len(content) // 2
    return content[:mid] + " [EDITED] " + content[mid + 10:]


def apply_medium_change(content: str) -> str:
    """Simulate medium edit - change ~10% of content."""
    chunk_size = len(content) // 10
    return content[:chunk_size] + generate_content(1)[:chunk_size] + content[chunk_size * 2:]


def apply_large_change(content: str) -> str:
    """Simulate large edit - change ~50% of content."""
    half = len(content) // 2
    return content[:half // 2] + generate_content(half // 1024 + 1)[:half] + content[-half // 2:]


def benchmark_diff_computation(
    dmp: diff_match_patch,
    size_kb: int,
    change_fn: callable,
    change_name: str,
    iterations: int = 100,
) -> BenchmarkResult:
    """Benchmark patch_make performance."""
    original = generate_content(size_kb)
    modified = change_fn(original)

    times = []
    for _ in range(iterations):
        start = time.perf_counter()
        patches = dmp.patch_make(original, modified)
        elapsed = (time.perf_counter() - start) * 1000  # ms
        times.append(elapsed)

    times.sort()
    return BenchmarkResult(
        operation="patch_make",
        content_size=f"{size_kb}KB",
        change_type=change_name,
        iterations=iterations,
        p50_ms=round(statistics.median(times), 3),
        p95_ms=round(times[int(len(times) * 0.95)], 3),
        p99_ms=round(times[int(len(times) * 0.99)], 3),
        max_ms=round(max(times), 3),
    )


def benchmark_reconstruction(
    dmp: diff_match_patch,
    size_kb: int,
    num_diffs: int,
    iterations: int = 50,
) -> BenchmarkResult:
    """Benchmark applying N sequential diffs (reconstruction scenario)."""
    content = generate_content(size_kb)

    # Pre-generate diffs
    diffs = []
    current = content
    for i in range(num_diffs):
        modified = apply_small_change(current)
        patches = dmp.patch_make(current, modified)
        diffs.append(dmp.patch_toText(patches))
        current = modified

    # Benchmark reconstruction
    times = []
    for _ in range(iterations):
        reconstructed = content
        start = time.perf_counter()
        for diff_text in diffs:
            patches = dmp.patch_fromText(diff_text)
            reconstructed, _ = dmp.patch_apply(patches, reconstructed)
        elapsed = (time.perf_counter() - start) * 1000  # ms
        times.append(elapsed)

    times.sort()
    return BenchmarkResult(
        operation="reconstruct",
        content_size=f"{size_kb}KB",
        change_type=f"{num_diffs}_diffs",
        iterations=iterations,
        p50_ms=round(statistics.median(times), 3),
        p95_ms=round(times[int(len(times) * 0.95)], 3),
        p99_ms=round(times[int(len(times) * 0.99)], 3),
        max_ms=round(max(times), 3),
    )


async def benchmark_event_loop_impact(
    dmp: diff_match_patch,
    size_kb: int,
) -> dict:
    """Test how diff computation affects concurrent async operations."""
    original = generate_content(size_kb)
    modified = apply_medium_change(original)

    async def simulated_request():
        """Simulate an async request that should complete quickly."""
        start = time.perf_counter()
        await asyncio.sleep(0.001)  # 1ms simulated I/O
        return (time.perf_counter() - start) * 1000

    # Baseline: concurrent requests without diff
    baseline_tasks = [simulated_request() for _ in range(10)]
    baseline_times = await asyncio.gather(*baseline_tasks)

    # With diff: run diff computation alongside async requests
    async def diff_and_requests():
        # Start concurrent requests
        request_tasks = [simulated_request() for _ in range(10)]

        # Run blocking diff (simulating what happens without thread pool)
        dmp.patch_make(original, modified)

        return await asyncio.gather(*request_tasks)

    impacted_times = await diff_and_requests()

    return {
        "content_size": f"{size_kb}KB",
        "baseline_p95_ms": round(sorted(baseline_times)[int(len(baseline_times) * 0.95)], 3),
        "impacted_p95_ms": round(sorted(impacted_times)[int(len(impacted_times) * 0.95)], 3),
        "degradation_factor": round(
            statistics.mean(impacted_times) / statistics.mean(baseline_times), 2
        ),
    }


def main():
    dmp = diff_match_patch()

    print("=" * 80)
    print("DIFF-MATCH-PATCH PERFORMANCE BENCHMARKS")
    print("=" * 80)

    # 1. Diff computation benchmarks
    print("\n## Diff Computation (patch_make)\n")
    print(f"{'Size':<10} {'Change':<12} {'P50 (ms)':<12} {'P95 (ms)':<12} {'P99 (ms)':<12} {'Max (ms)':<12}")
    print("-" * 70)

    sizes = [1, 10, 50, 100, 500, 1000]  # KB
    changes = [
        (apply_small_change, "small"),
        (apply_medium_change, "medium"),
        (apply_large_change, "large"),
    ]

    diff_results = []
    for size in sizes:
        for change_fn, change_name in changes:
            result = benchmark_diff_computation(dmp, size, change_fn, change_name)
            diff_results.append(result)
            print(f"{result.content_size:<10} {result.change_type:<12} {result.p50_ms:<12} {result.p95_ms:<12} {result.p99_ms:<12} {result.max_ms:<12}")

    # 2. Reconstruction benchmarks
    print("\n## Reconstruction (applying sequential diffs)\n")
    print(f"{'Size':<10} {'Diffs':<12} {'P50 (ms)':<12} {'P95 (ms)':<12} {'P99 (ms)':<12} {'Max (ms)':<12}")
    print("-" * 70)

    recon_sizes = [10, 100]  # KB
    diff_counts = [1, 5, 10, 20, 50]

    for size in recon_sizes:
        for num_diffs in diff_counts:
            result = benchmark_reconstruction(dmp, size, num_diffs)
            print(f"{result.content_size:<10} {result.change_type:<12} {result.p50_ms:<12} {result.p95_ms:<12} {result.p99_ms:<12} {result.max_ms:<12}")

    # 3. Event loop impact
    print("\n## Event Loop Impact (async degradation)\n")
    print(f"{'Size':<10} {'Baseline P95':<15} {'Impacted P95':<15} {'Degradation':<12}")
    print("-" * 55)

    for size in [10, 100, 500]:
        impact = asyncio.run(benchmark_event_loop_impact(dmp, size))
        print(f"{impact['content_size']:<10} {impact['baseline_p95_ms']:<15} {impact['impacted_p95_ms']:<15} {impact['degradation_factor']:<12}x")

    # 4. Recommendations
    print("\n" + "=" * 80)
    print("RECOMMENDATIONS")
    print("=" * 80)

    # Find threshold where P95 > 10ms
    threshold_size = None
    for result in diff_results:
        if result.p95_ms > 10 and threshold_size is None:
            threshold_size = result.content_size
            break

    if threshold_size:
        print(f"\n⚠️  P95 exceeds 10ms at {threshold_size} - consider thread pool for large content")
    else:
        print("\n✅ P95 under 10ms for all tested sizes - sync implementation acceptable")

    print("\nDecision points:")
    print("- [ ] Use sync implementation (if P95 < 10ms for typical content)")
    print("- [ ] Use thread pool from start (if P95 > 50ms for common sizes)")
    print("- [ ] Adjust snapshot interval (if reconstruction > 20ms)")
    print("- [ ] Add content size limit (if large content causes issues)")


if __name__ == "__main__":
    main()
```

### Running the Benchmark

```bash
# Install diff-match-patch first
uv add diff-match-patch

# Run benchmark
uv run python backend/scripts/benchmark_diff.py
```

### Expected Output Format

```
================================================================================
DIFF-MATCH-PATCH PERFORMANCE BENCHMARKS
================================================================================

## Diff Computation (patch_make)

Size       Change       P50 (ms)     P95 (ms)     P99 (ms)     Max (ms)
----------------------------------------------------------------------
1KB        small        0.1          0.2          0.3          0.5
1KB        medium       0.2          0.3          0.4          0.6
...

## Reconstruction (applying sequential diffs)

Size       Diffs        P50 (ms)     P95 (ms)     P99 (ms)     Max (ms)
----------------------------------------------------------------------
10KB       5_diffs      0.5          0.8          1.0          1.2
...

## Event Loop Impact (async degradation)

Size       Baseline P95    Impacted P95    Degradation
-------------------------------------------------------
10KB       1.1             1.2             1.1x
100KB      1.1             5.5             5.0x
...

================================================================================
RECOMMENDATIONS
================================================================================

⚠️  P95 exceeds 10ms at 500KB - consider thread pool for large content
```

### Decision Matrix

After running benchmarks, fill in:

| Metric | Threshold | Result | Decision |
|--------|-----------|--------|----------|
| P95 diff time for 50KB | < 10ms | ___ ms | Sync OK / Need thread pool |
| P95 reconstruction (10 diffs, 50KB) | < 20ms | ___ ms | Interval 10 OK / Reduce to 5 |
| Event loop degradation at 100KB | < 2x | ___x | Acceptable / Need thread pool |
| Content size for P95 > 50ms | Note size | ___ KB | Set as forced-snapshot threshold |

### Deliverables

1. Benchmark script committed to `backend/scripts/benchmark_diff.py`
2. Results documented in this plan (update after running)
3. Implementation decision recorded:
   - [ ] Proceed with sync implementation
   - [ ] Implement thread pool from start
   - [ ] Adjust snapshot interval to: ___
   - [ ] Add forced-snapshot threshold at: ___ KB

### Dependencies
None - can run before any other milestones

### Risk Factors
- Benchmark results may vary by machine; run on production-similar hardware if possible
- Real-world content patterns may differ from synthetic benchmarks

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

       # Determine source from header (frontend and MCP servers set this)
       source_header = request.headers.get("x-request-source", "").lower()
       source_map = {
           "web": RequestSource.WEB,
           "api": RequestSource.API,
           "mcp-content": RequestSource.MCP_CONTENT,
           "mcp-prompt": RequestSource.MCP_PROMPT,
       }
       source = source_map.get(source_header, RequestSource.UNKNOWN)

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
       # No FK on entity_id - intentionally allows history to persist after permanent delete
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
   - Remove NoteVersion import and export from `__all__`

3. **Update User model:**
   - Add relationship: `content_history: Mapped[list["ContentHistory"]] = relationship(back_populates="user")`

4. **Delete `backend/src/models/note_version.py`**

5. **Update tests referencing NoteVersion:**
   - `backend/tests/services/test_user_cascade.py`: Remove NoteVersion import and test code (lines 14, 100-108)
   - Search for other references: `grep -r "NoteVersion" backend/`
   - Update or remove any other files that import NoteVersion

7. **Create migration:**
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

3. **Code cleanup verification:**
   - `make tests` passes (no import errors from removed NoteVersion)
   - No remaining references to NoteVersion in codebase

### Dependencies
Milestone 1 (for source/auth_type enums)

### Risk Factors
- **No FK on entity_id:** Intentional - allows history to persist after permanent delete. Verify queries handle missing entities gracefully.

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
- Content can be reconstructed efficiently from nearest snapshot + diffs
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
               except IntegrityError:
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
               # NOTE: If Milestone 0 benchmarks indicate thread pool needed,
               # wrap this in: await loop.run_in_executor(executor, lambda: ...)
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
       ) -> ReconstructionResult:
           """
           Reconstruct content at a specific version by applying diffs.

           Returns ReconstructionResult with:
           - found=False if version doesn't exist
           - found=True with content (which may be None for delete actions)

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
               return ReconstructionResult(found=False, content=None)

           # If target is the snapshot itself, return directly
           if snapshot.version == target_version:
               return ReconstructionResult(found=True, content=snapshot.content_diff)

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
                   # NOTE: If thread pool needed per Milestone 0, offload patch_apply too
                   new_content, results = self.dmp.patch_apply(patches, content or "")
                   if not all(results):
                       # Some patches failed - log but continue with partial result
                       logger.warning(
                           "Diff application partial failure for %s/%s v%d: %s",
                           entity_type_value, entity_id, record.version, results,
                       )
                   content = new_content

           return ReconstructionResult(found=True, content=content)

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
   - Reconstruct version 1 (snapshot only) returns `found=True`
   - Reconstruct version 5 (snapshot + 4 diffs) returns `found=True`
   - Reconstruct version 15 (queries from nearest snapshot, not all history)
   - Non-existent version returns `found=False`
   - Version with None content (delete action) returns `found=True, content=None`
   - Verify only necessary records are queried (not full history)

4. **Race condition tests:**
   - Concurrent history writes to same entity produce sequential versions
   - IntegrityError triggers retry with savepoint (parent transaction intact)
   - Max retries exceeded raises error
   - Parent entity change is NOT rolled back when history insert fails

5. **Diff failure handling tests:**
   - Corrupted diff logs warning but returns partial result
   - Reconstruction continues after partial patch failure

5. **History retrieval tests:**
   - Get entity history returns correct records and total count
   - Get user history filters by entity type
   - Pagination works correctly with accurate totals

### Dependencies
Milestone 2 (ContentHistory model)

### Risk Factors
- **Diff corruption:** If a diff is corrupted, all subsequent versions until next snapshot are broken. Snapshot interval mitigates this. Partial failures are logged but don't fail the request.
- **Large diffs:** For complete rewrites, diff may be larger than full content. Consider storing snapshot if diff > content length (future optimization).
- **Savepoint overhead:** Using `begin_nested()` has slight overhead vs plain insert, but ensures parent transaction integrity on retry.
- **Event loop blocking:** Diff computation is CPU-bound. Milestone 0 benchmarks determine if thread pool is needed. If yes, wrap `patch_make` and `patch_apply` calls with `run_in_executor()`.

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
- **When provided:** History is recorded with source/auth_type/token_id tracking
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

5. **str-replace history tests:**
   - str-replace on bookmark creates history record with UPDATE action
   - str-replace on note creates history record
   - str-replace on prompt creates history record
   - History has correct previous_content and current_content
   - History has correct source from request context

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

   **Important:** Do NOT check if the entity exists. History should be accessible even for permanently deleted entities (history survives deletion). Query ContentHistory directly by entity_id.

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

       History is available even for permanently deleted bookmarks.
       Returns empty list if no history exists for this entity_id.
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
   - Get history for permanently deleted entity returns history records
   - Get history for entity that never existed returns empty list (not 404)
   - Per-entity history endpoint does NOT check entity existence

### Dependencies
Milestone 4 (history recording integrated)

### Risk Factors
- **Large history:** Users with many changes may have slow queries. Indexes should help.
- **Deleted entities:** History for deleted entities is accessible by design (no FK on entity_id).

---

## Milestone 6: Undo/Revert Functionality

### Goal
Allow users to revert content to a previous version.

### Success Criteria
- Users can revert content to any previous version
- Revert creates a new history entry (not deletion of history)
- **Version 0 = "undo create" = soft-delete the entity**
- Edge cases handled (deleted items, URL conflicts)
- Revert delegates to entity-specific services for validation

### Key Changes

1. **Add revert endpoint:**
   ```python
   @router.post("/{entity_type}/{entity_id}/revert/{version}")
   async def revert_to_version(
       entity_type: EntityType,
       entity_id: UUID,
       version: int = Path(..., ge=0),  # version >= 0; 0 means "undo create"
       request: Request,
       current_user: User = Depends(get_current_user),
       limits: TierLimits = Depends(get_current_limits),
       db: AsyncSession = Depends(get_async_session),
   ):
       """
       Revert entity to a previous version.

       - version > 0: Restore content/metadata from that version (creates UPDATE)
       - version = 0: "Undo create" - soft-delete the entity (creates DELETE)

       For version > 0, this creates a new UPDATE history entry with restored content.
       The revert operation delegates to the entity-specific service for validation.
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

       # Handle version=0 specially: "undo create" means soft-delete
       if version == 0:
           if entity.deleted_at is not None:
               raise HTTPException(
                   status_code=400,
                   detail="Entity is already deleted",
               )
           # Soft-delete the entity (this records a DELETE history entry)
           await service.delete(db, current_user.id, entity_id, permanent=False, context=context)
           return {"message": "Entity deleted (undo create)", "version": 0}

       # For version > 0: restore to that version
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
   - **Version 0 (undo create):** Soft-delete the entity, return 400 if already deleted
   - **Deleted item:** If soft-deleted, restore first then update (for version > 0)
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

2. **Version 0 (undo create) tests:**
   - Revert to version 0 soft-deletes the entity
   - Revert to version 0 creates DELETE history entry
   - Revert to version 0 on already-deleted entity returns 400
   - Revert to version 0 on permanently deleted entity returns 404

3. **Edge case tests:**
   - Revert soft-deleted item (should restore + update)
   - Revert to version with URL that now conflicts (should 409)
   - Revert to version with name that now conflicts (should 409)
   - Revert permanently deleted item (should 404)
   - Revert to non-existent version (should 404)
   - Revert to version with None content (e.g., delete snapshot) handles gracefully

4. **Tag restoration:**
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
    enabled: !!entityId && version >= 0,  // Allow version 0 for undo create
  });
}

// Revert to a specific version (including version 0 for undo create)
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
    selectedVersion ?? 0
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

  // Handler for "Undo creation" (version 0 = soft-delete)
  const handleUndoCreate = () => {
    if (confirmingRevert === 0) {
      // Second click - execute delete
      revertMutation.mutate(
        { entityType, entityId, version: 0 },
        { onSuccess: () => onClose() }  // Close sidebar after delete
      );
    } else {
      setConfirmingRevert(0);
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
                    {/* Show "Undo creation" button on v1 (CREATE action) */}
                    {entry.version === 1 && entry.action === 'create' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUndoCreate();
                        }}
                        className={`px-3 py-1 text-sm rounded ${
                          confirmingRevert === 0
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300'
                        }`}
                      >
                        {confirmingRevert === 0 ? 'Confirm Delete' : 'Undo Creation'}
                      </button>
                    )}
                    {/* Show "Restore" button on older versions */}
                    {entry.version < (history?.items[0]?.version ?? 0) && (
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
            useDarkTheme={document.documentElement.classList.contains('dark')}
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

Create `frontend/src/pages/Settings/VersionHistory.tsx`:

```typescript
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserHistory } from '../../hooks/useHistory';

export function VersionHistoryPage() {
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
// Inside the /app/settings/* route group
{ path: '/app/settings/history', element: <VersionHistoryPage /> },
```

In Settings navigation (`frontend/src/pages/Settings/index.tsx`):
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
   - "Undo Creation" button appears on v1 (CREATE action)
   - "Undo Creation" → "Confirm Delete" on click → executes revert with version=0

3. **VersionHistoryPage tests:**
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
- **Dark mode:** `react-diff-viewer-continued` has dark theme support but may need CSS tweaks to match app theme.

---

## Milestone 9: Documentation and CLAUDE.md Update

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
- `frontend/src/pages/Settings/VersionHistory.tsx` - Global history page

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
- `frontend/src/components/BookmarkDetail.tsx` - Add history toggle button, render sidebar
- `frontend/src/components/NoteDetail.tsx` - Add history toggle button, render sidebar
- `frontend/src/components/PromptDetail.tsx` - Add history toggle button, render sidebar
- `frontend/src/pages/Settings/index.tsx` - Add Version History nav link
- `frontend/src/App.tsx` - Add /app/settings/history route
- `frontend/package.json` - Add react-diff-viewer-continued dependency

**Documentation:**
- `CLAUDE.md` - Document versioning system

---

## Open Questions for User

1. **Retention defaults:** Are `history_retention_days=30` and `max_history_per_entity=100` reasonable defaults for the free tier?
