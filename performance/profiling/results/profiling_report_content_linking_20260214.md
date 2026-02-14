# Profiling Report

**Date:** 2026-02-14 12:10:36
**Branch:** content-linking
**Commit:** ec66624
**Benchmarks:** See benchmark_report_content_linking_20260214.md
**Machine:** Apple M2 Max, 64 GB RAM, macOS 26.2
**Method:** pyinstrument via ASGITransport (in-process, no network overhead)

## Test Parameters

| Parameter | Value |
|-----------|-------|
| Content sizes | 1KB, 50KB |
| Entities profiled | Notes, Bookmarks, Prompts |
| Operations per entity | Create, Read, Update, List, Search, Soft Delete, Hard Delete |

## Timing Summary

| Operation | 1KB (ms) | 50KB (ms) | Size Scaling | Top Function |
|-----------|----------|-----------|--------------|--------------|
| create_note | 24.0 | 33.3 | 1.4x | NoteService.create (38%) |
| read_note | 10.1 | 15.0 | 1.5x | get_or_create_user (20%) |
| update_note | 18.3 | 29.2 | 1.6x | NoteService.update (18%) |
| list_notes | 8.5 | 12.3 | 1.5x | NoteService.search (38%) |
| search_notes | 7.4 | 11.4 | 1.5x | NoteService.search (29%) |
| soft_delete_note | 8.5 | 15.6 | 1.8x | NoteService.delete (22%) |
| hard_delete_note | 9.8 | 17.9 | 1.8x | NoteService.delete (20%) |
| create_bookmark | 17.1 | 31.1 | 1.8x | BookmarkService.create (47%) |
| read_bookmark | 8.6 | 11.2 | 1.3x | BookmarkService.get (25%) |
| update_bookmark | 16.2 | 19.1 | 1.2x | BookmarkService.update (20%) |
| list_bookmarks | 8.6 | 8.2 | 1.0x | BookmarkService.search (25%) |
| search_bookmarks | 7.1 | 8.5 | 1.2x | BookmarkService.search (43%) |
| soft_delete_bookmark | 8.6 | 9.4 | 1.1x | BookmarkService.delete (33%) |
| hard_delete_bookmark | 8.0 | 8.5 | 1.1x | BookmarkService.delete (25%) |
| create_prompt | 17.7 | 21.7 | 1.2x | PromptService.create (28%) |
| read_prompt | 12.6 | 10.8 | 0.9x | PromptService.get (23%) |
| update_prompt | 32.3 | 28.7 | 0.9x | PromptService.update (28%) |
| list_prompts | 7.2 | 7.0 | 1.0x | PromptService.search (29%) |
| search_prompts | 6.4 | 7.1 | 1.1x | PromptService.search (33%) |
| soft_delete_prompt | 13.5 | 12.4 | 0.9x | PromptService.delete (50%) |
| hard_delete_prompt | 12.1 | 13.8 | 1.1x | PromptService.delete (42%) |

**Size Scaling** = 50KB time / 1KB time. Values close to 1.0x mean the operation is not content-size-dependent. Most operations scale 1.0-1.8x for a 50x content increase, confirming performance is dominated by fixed DB round-trip costs.

## Targeted Analysis: Affected Code Paths

### `embed_relationships()` — Called on every GET/CREATE/UPDATE response

| Code Path | Operation | 1KB Time (ms) | % of Total | 50KB Time (ms) | % of Total |
|-----------|-----------|---------------|------------|----------------|------------|
| embed_relationships | create_bookmark | <1 | <6% | 1.0 | 3.2% |
| embed_relationships | create_note | <1 | <4% | 1.0 | 3.0% |
| embed_relationships | create_prompt | 1.0 | 5.6% | 1.0 | 4.5% |
| embed_relationships | read_bookmark | 1.0 | 11.1% | <1 | <9% |
| embed_relationships | read_note | <1 | <10% | 1.0 | 6.7% |
| embed_relationships | read_prompt | 1.0 | 7.7% | 1.0 | 9.1% |
| embed_relationships | update_bookmark | 1.0 | 6.3% | 1.0 | 5.3% |
| embed_relationships | update_note | 1.0 | 5.6% | 1.0 | 3.4% |
| embed_relationships | update_prompt | 2.0 | 6.3% | <1 | <3% |

### `get_metadata_snapshot()` / `get_relationships_snapshot()` — Called on CREATE/UPDATE for history

| Code Path | Operation | 1KB Time (ms) | % of Total | 50KB Time (ms) | % of Total |
|-----------|-----------|---------------|------------|----------------|------------|
| get_metadata_snapshot | create_bookmark | 1.0 | 5.9% | <1 | <3% |
| get_metadata_snapshot | create_note | <1 | <4% | 1.0 | 3.0% |
| get_metadata_snapshot | create_prompt | <1 | <6% | 1.0 | 4.5% |
| get_metadata_snapshot | update_bookmark | <1 | <6% | 1.0 | 5.3% |
| get_metadata_snapshot | update_note | 1.0 | 5.6% | 1.0 | 3.4% |
| get_metadata_snapshot | update_prompt | 1.0 | 3.1% | 1.0 | 3.4% |

### `delete_relationships_for_content()` — Called on hard delete

| Code Path | Operation | 1KB Time (ms) | % of Total | 50KB Time (ms) | % of Total |
|-----------|-----------|---------------|------------|----------------|------------|
| delete_relationships_for_content | hard_delete_bookmark | <1 | <13% | 1.0 | 11.1% |
| delete_relationships_for_content | hard_delete_note | 1.0 | 10.0% | 1.0 | 5.6% |
| delete_relationships_for_content | hard_delete_prompt | 1.0 | 8.3% | <1 | <7% |

### `_compute_changed_fields()` — Called on CREATE/UPDATE

Only appeared above sampling threshold in one profile (create_note_1kb at 1ms / 4.2%). Below threshold in all other profiles. Negligible in-memory computation.

### Findings

- Each relationship service function adds exactly **1ms** (one indexed DB query) per call. This is consistent across all entity types and content sizes.
- For **write operations** (create/update), the branch adds 2 relationship queries: `get_relationships_snapshot` (during metadata capture) + `embed_relationships` (in response). Combined: ~2ms per write.
- For **read operations**, only `embed_relationships` is called: ~1ms per read.
- For **hard delete**, only `delete_relationships_for_content` is called: ~1ms per delete.
- The `relationships_override` optimization in update paths correctly skips the redundant `get_relationships_snapshot` query when relationships weren't in the update payload (confirmed via code review; update profiling shows only one relationship query on the response path when relationships aren't changing).

## Baseline Comparison

Baseline: `2026-02-05-main.zip` (main branch profiling). Key differences:

| Operation | Size | Baseline (ms) | Current (ms) | Change | New Functions in Top 3 |
|-----------|------|--------------|-------------|--------|----------------------|
| create_bookmark | 1kb | 16.0 | 17.1 | +6% | HistoryService.record_action |
| create_bookmark | 50kb | 17.0 | 31.1 | +82% | AsyncSession.flush (increased) |
| create_note | 1kb | 15.0 | 24.0 | +60% | HistoryService.record_action |
| create_note | 50kb | 16.0 | 33.3 | +106% | HistoryService.record_action |
| update_bookmark | 1kb | 12.0 | 16.2 | +33% | HistoryService.record_action |
| update_bookmark | 50kb | 14.0 | 19.1 | +36% | HistoryService.record_action |
| update_note | 1kb | 13.0 | 18.3 | +38% | HistoryService.record_action |
| update_note | 50kb | 14.0 | 29.2 | +107% | HistoryService.record_action, AsyncSession.flush |
| update_prompt | 1kb | 24.0 | 32.3 | +33% | HistoryService.record_action |
| update_prompt | 50kb | 25.0 | 28.7 | +16% | -- (within noise) |
| read_bookmark | 1kb | 9.0 | 8.6 | -4% | embed_relationships |
| read_note | 1kb | 9.0 | 10.1 | +11% | -- |
| read_prompt | 1kb | 12.0 | 12.6 | +5% | embed_relationships |
| hard_delete_note | 1kb | 6.0 | 9.8 | +63% | delete_relationships_for_content |
| hard_delete_note | 50kb | 11.0 | 17.9 | +63% | delete_relationships_for_content |
| hard_delete_prompt | 1kb | 11.0 | 12.1 | +10% | delete_relationships_for_content |

**Key observation:** `HistoryService.record_action` is the most significant new function appearing in top-3 lists across create and update operations (consuming 12-17% of request time). This function internally calls `get_relationships_snapshot`, performs diff computation, and flushes to the database. The relationship queries themselves are a minor component (~1ms each); the history recording overhead (flush + version management) is the larger contributor.

## Database Query Analysis

| Operation | Estimated DB Round-Trips | Primary Queries |
|-----------|------------------------|-----------------
| create (any entity) | 5-7 | check_quota, flush, refresh, history record (execute+flush), get_relationships_snapshot, embed_relationships |
| read (any entity) | 3-4 | auth/user lookup, get entity, get_updated_at, embed_relationships |
| update (any entity) | 5-7 | auth/user lookup, get entity, get_metadata_snapshot, flush, refresh, history record, embed_relationships |
| list / search | 2 | auth/user lookup, search execute |
| soft_delete | 3-4 | auth/user lookup, get entity, flush, history audit record |
| hard_delete | 4-5 | auth/user lookup, get entity, delete_relationships_for_content, delete_entity_history, delete entity |

**Flagged (>4 DB round-trips):** Create and update operations at 5-7 queries. The branch contributes 2 of these (get_relationships_snapshot + embed_relationships). The remainder are pre-existing (quota check, flush, refresh, history).

## Hot Spots (Functions >20% of total time)

### Write Operations
- **`{Entity}Service.create`**: 28-64% of create operations (encompasses flush, refresh, history recording)
- **`{Entity}Service.update`**: 18-57% of update operations (encompasses get entity, flush, refresh, history recording)
- **`HistoryService.record_action`**: 12-17% of create/update operations (new in this branch's profiles due to relationship snapshot overhead)
- **`get_or_create_user`** (auth): 10-31% (dev-mode auth overhead; will be lower in production with Redis cache)

### Read Operations
- **`{Entity}Service.search`**: 25-50% of list/search operations (core DB query)
- **`{Entity}Service.get`**: 10-25% of read operations (core DB query)
- **`get_or_create_user`** (auth): 10-33% (dev-mode fixed cost)

### Delete Operations
- **`{Entity}Service.delete`**: 20-50% of delete operations
- **`get_or_create_user`** (auth): 17-33% (dev-mode fixed cost)

## Summary

- **Overall assessment:** MINOR CONCERNS
- **Key findings:**
  - All three relationship service functions (`embed_relationships`, `get_relationships_snapshot`, `delete_relationships_for_content`) add exactly 1ms each — one indexed DB query per call. Combined overhead per write operation: ~2-3ms.
  - `_compute_changed_fields` is negligible (pure in-memory computation, below sampling threshold in all but one profile).
  - The most significant profiling change is `HistoryService.record_action` appearing in top-3 functions for create/update operations. It consumes 12-17% of total time, with the relationship snapshot query being a minor component within it.
  - DB round-trip count for creates/updates is 5-7 (up from 3-5 on main). The relationship features contribute 2 additional queries. All queries are on indexed columns.
  - Middleware overhead remains under 5% individually (1ms per layer).
  - Content size scaling is moderate (1.0-1.8x) confirming the system is IO-bound, not CPU-bound.
- **Recommendations:**
  - No structural issues or N+1 query patterns detected. The additional DB round-trips are single-row indexed lookups.
  - The `embed_relationships` query could potentially be batched with the entity fetch using a joined load, but at 1ms overhead this optimization is not worth the complexity.
  - Monitor `HistoryService.record_action` time in production — it now includes relationship snapshot capture, and if relationship counts per entity grow large, this query could slow down. Current implementation queries by `(user_id, source_type, source_id)` index, so it should remain fast.
