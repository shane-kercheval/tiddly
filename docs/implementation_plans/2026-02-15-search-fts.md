# Phase 1: PostgreSQL Full-Text Search (FTS) Implementation Plan

**Reference:** `docs/implementation_plans/roadmap-search.md` — Phase 1

**Goal:** Add PostgreSQL FTS alongside ILIKE for ranked, language-aware keyword search with combined scoring. Zero new infrastructure. Every search query runs both FTS (for stemming and field-weighted ranking) and ILIKE (for exact substring matching) in a single query, with a combined relevance score.

---

## Milestone 1: Database Migration — `search_vector` Columns, Triggers, + GIN Indexes

### Goal & Outcome
Add a `search_vector` tsvector column, a trigger to maintain it, and a GIN index to each entity table (`bookmarks`, `notes`, `prompts`).

After this milestone:
- Each entity table has a `search_vector` column maintained by a trigger
- Triggers only recompute the tsvector when searchable content fields change (not on `last_used_at`, archive, or soft-delete updates)
- GIN indexes exist for fast FTS lookups
- Existing data is backfilled by the migration
- No application code changes yet — this is purely a schema change

### Implementation Outline

Create a single Alembic migration. Run `make migration` (which runs `alembic revision --autogenerate`) to generate the migration file — autogenerate will detect the new `search_vector` column from the SQLAlchemy model changes. Then **manually edit** the generated file to add all trigger functions, triggers, GIN indexes, and backfill SQL via `op.execute()`. Autogenerate cannot detect these — only the column addition.

**Why triggers instead of generated columns:** A `GENERATED ALWAYS AS ... STORED` column recomputes on every row UPDATE, regardless of which column changed. This means `last_used_at` bumps, archive/unarchive, and soft-delete would all re-run `to_tsvector` on up to 100KB of content for no reason. A trigger with `IS DISTINCT FROM` checks skips recomputation when only non-content fields change.

**Bookmark — column + trigger + index:**

```sql
-- Column
ALTER TABLE bookmarks ADD COLUMN search_vector tsvector;

-- Trigger function
CREATE FUNCTION bookmarks_search_vector_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
     OLD.title IS DISTINCT FROM NEW.title OR
     OLD.description IS DISTINCT FROM NEW.description OR
     OLD.summary IS DISTINCT FROM NEW.summary OR
     OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  ELSE
    NEW.search_vector := OLD.search_vector;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookmarks_search_vector_trigger
  BEFORE INSERT OR UPDATE ON bookmarks
  FOR EACH ROW EXECUTE FUNCTION bookmarks_search_vector_update();

-- GIN index
CREATE INDEX ix_bookmarks_search_vector ON bookmarks USING GIN (search_vector);
```

**Note — column + trigger + index:**

```sql
ALTER TABLE notes ADD COLUMN search_vector tsvector;

CREATE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
     OLD.title IS DISTINCT FROM NEW.title OR
     OLD.description IS DISTINCT FROM NEW.description OR
     OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  ELSE
    NEW.search_vector := OLD.search_vector;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_search_vector_trigger
  BEFORE INSERT OR UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();

CREATE INDEX ix_notes_search_vector ON notes USING GIN (search_vector);
```

**Prompt — column + trigger + index:**

```sql
ALTER TABLE prompts ADD COLUMN search_vector tsvector;

CREATE FUNCTION prompts_search_vector_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
     OLD.name IS DISTINCT FROM NEW.name OR
     OLD.title IS DISTINCT FROM NEW.title OR
     OLD.description IS DISTINCT FROM NEW.description OR
     OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  ELSE
    NEW.search_vector := OLD.search_vector;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER prompts_search_vector_trigger
  BEFORE INSERT OR UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION prompts_search_vector_update();

CREATE INDEX ix_prompts_search_vector ON prompts USING GIN (search_vector);
```

**Backfill existing data:** Triggers fire on UPDATE, so after creating the triggers, run a no-op update on each table to populate existing rows:

```sql
UPDATE bookmarks SET title = title;
UPDATE notes SET title = title;
UPDATE prompts SET name = name;
```

**Important:** Check whether the backfill updates cause `updated_at` side effects. If `updated_at` is managed by a database trigger, it will bump timestamps on every row. If so, temporarily disable the `updated_at` trigger during backfill, or use a raw SQL update that directly sets `search_vector` without going through the trigger path.

**GIN index note:** Use standard `CREATE INDEX` (not `CONCURRENTLY`) — at current scale the brief lock is acceptable. Add a code comment noting `CONCURRENTLY` as an option for larger tables.

**SQLAlchemy model updates:** Add the `search_vector` column to each model class (`Bookmark`, `Note`, `Prompt`). Since the column is trigger-maintained (not a generated column), SQLAlchemy just needs to know it exists but should not write to it:

```python
from sqlalchemy.dialects.postgresql import TSVECTOR

search_vector: Mapped[str | None] = mapped_column(TSVECTOR, nullable=True, default=None, deferred=True)
```

Use `deferred=True` so the tsvector isn't loaded on every query (it's only needed for search operations, not general reads). The trigger's `ELSE NEW.search_vector := OLD.search_vector` branch ensures the column is preserved even if SQLAlchemy includes it in UPDATE statements.

**Downgrade:** Drop the indexes, triggers, trigger functions, and columns.

### Testing Strategy

- **Migration test:** Run `make migrate` against the test database, verify the columns, indexes, triggers, and trigger functions exist via raw SQL inspection
- **Trigger test:** Insert a bookmark with known title/content, verify `search_vector` is populated. Update the bookmark's `last_used_at` — verify `search_vector` is unchanged. Update the bookmark's `title` — verify `search_vector` is recomputed.
- **Backfill test:** Verify that after migration, existing rows have populated `search_vector` values
- **Verify existing tests still pass:** Run `make unit_tests` — no application code changed, so all existing tests should pass. If any tests inspect column lists or schema metadata, they may need minor updates.

---

## Milestone 2: Consolidate Search — Route Individual Endpoints Through `search_all_content()`

### Goal & Outcome
Eliminate the duplicated search implementation. Currently, individual entity search (`BaseEntityService.search()`) and unified search (`content_service.search_all_content()`) have completely separate implementations of text search, view filtering, tag filtering, filter expression handling, sorting, and pagination. Both paths need FTS changes, so consolidating first ensures FTS is implemented once.

After this milestone:
- `search_all_content()` is the single search implementation
- Individual list endpoints (`GET /bookmarks/`, `GET /notes/`, `GET /prompts/`) call `search_all_content()` with `content_types=["bookmark"]` (or `["note"]`, etc.)
- Router-level mapping converts `ContentListItem` results to entity-specific response schemas (`BookmarkListItem`, `NoteListItem`, `PromptListItem`)
- `BaseEntityService.search()` and `_build_text_search_filter()` are removed (or deprecated)
- All endpoints have identical search behavior — no behavioral differences between individual and unified paths
- MCP `search_items` tool continues to work unchanged (it calls the REST API)

### Why This Matters

Looking at the current code:

- `BaseEntityService.search()` uses `_build_text_search_filter()` returning ILIKE conditions, `selectinload` for tags, and `_apply_sorting()` with entity-specific sort columns.
- `search_all_content()` uses `_apply_entity_filters()` with its own ILIKE logic, batch tag fetching via `get_tags_for_items()`, UNION ALL subqueries with labeled columns, and its own sort column computation.

Without consolidation, every FTS feature (tsvector matching, ts_rank, empty tsquery guard, ILIKE fallback, ts_headline, relevance sorting) would need to be implemented in both paths. The UNION path in `search_all_content()` is strictly more capable — it already handles `content_types` filtering, per-type column projection, and cross-type sorting.

### Implementation Outline

**1. Add missing fields to `ContentListItem` and unified subqueries**

`BookmarkListItem` has `summary: str | None` but `ContentListItem` does not, and the bookmark subquery in `search_all_content()` doesn't project it. Before individual endpoints can delegate to `search_all_content()`, fix this gap:

- Add `summary: str | None = None` to `ContentListItem` in `schemas/content.py`
- Add `Bookmark.summary.label("summary")` to the bookmark subquery in `search_all_content()`
- Add `literal(None).label("summary")` to the note and prompt subqueries

Verify no other fields are missing by comparing `BookmarkListItem`, `NoteListItem`, and `PromptListItem` against `ContentListItem`. As of this writing, `summary` is the only gap — `ContentListItem` already has `url`, `name`, and `arguments`. `NoteListItem` is a pure subset. But check anyway in case schemas have drifted since this plan was written.

**2. Verify `search_all_content()` can serve individual endpoints**

`search_all_content()` already accepts `content_types` and works with a single type. With `content_types=["bookmark"]`, the UNION degenerates to a single subquery. Verify this produces equivalent results to `BookmarkService.search()` for the same inputs (same filters, same sort, same pagination).

Key differences to handle:
- **Tags**: `search_all_content()` fetches tags via `get_tags_for_items()` (batch post-query), while `BaseEntityService.search()` uses `selectinload(model.tag_objects)`. The unified approach is fine — the response schemas just need `tags: list[str]`, not full tag objects.
- **Sort columns**: `search_all_content()` already computes `sort_title` inline per type with the same COALESCE/NULLIF/LOWER logic as `_get_sort_columns()` in each entity service. Verify these expressions are identical, then remove `_get_sort_columns()` when removing the old search path.
- **Response shape**: `search_all_content()` returns `ContentListItem` objects. Individual endpoints return entity model instances. The router mapping needs to bridge this.

**3. Update individual routers to call `search_all_content()`**

In `bookmarks.py`, `notes.py`, `prompts.py` — change the list endpoint to call `search_all_content()` with the appropriate type filter:

```python
@router.get("/", response_model=BookmarkListResponse)
async def list_bookmarks(
    # ... same params ...
) -> BookmarkListResponse:
    resolved = await resolve_filter_and_sorting(
        db, current_user.id, filter_id, sort_by, sort_order,
    )

    items, total = await search_all_content(
        db=db,
        user_id=current_user.id,
        query=q,
        tags=tags if tags else None,
        tag_match=tag_match,
        sort_by=resolved.sort_by,
        sort_order=resolved.sort_order,
        offset=offset,
        limit=limit,
        view=view,
        filter_expression=resolved.filter_expression,
        content_types=["bookmark"],
    )

    # Map ContentListItem → BookmarkListItem
    bookmark_items = [_content_item_to_bookmark_list_item(item) for item in items]
    return BookmarkListResponse(
        items=bookmark_items,
        total=total,
        offset=offset,
        limit=limit,
        has_more=(offset + len(items)) < total,
    )
```

**4. Create response mapping functions**

Each entity router needs a mapping function from `ContentListItem` to its entity-specific list item schema:

```python
def _content_item_to_bookmark_list_item(item: ContentListItem) -> BookmarkListItem:
    """Map unified ContentListItem to BookmarkListItem."""
    return BookmarkListItem(
        id=item.id,
        title=item.title,
        description=item.description,
        summary=item.summary,
        url=item.url,
        tags=item.tags,
        created_at=item.created_at,
        updated_at=item.updated_at,
        last_used_at=item.last_used_at,
        deleted_at=item.deleted_at,
        archived_at=item.archived_at,
        content_length=item.content_length,
        content_preview=item.content_preview,
    )
```

Alternatively, if the entity list item schemas are similar enough to `ContentListItem`, consider whether the individual endpoints can just return `ContentListItem` directly (with the `type` field). This is a schema design decision.

**5. Remove duplicated code (only after all existing tests pass on the new path)**

This is the second step within this milestone. Do NOT remove old code until the full test suite passes through the new path. Wire up the new path first, verify equivalence, then delete.

- Remove `BaseEntityService.search()` and its `include_content` parameter (no router uses `include_content` — it's dead code)
- Remove the abstract `_build_text_search_filter()` from `BaseEntityService` and all concrete implementations (`BookmarkService`, `NoteService`, `PromptService`)
- Remove `_apply_view_filter()`, `_apply_tag_filter()`, `_apply_sorting()` from `BaseEntityService` (these are now handled by `search_all_content()` and `_apply_entity_filters()`)
- Remove `_get_sort_columns()` from each entity service — the sort logic already exists as inline `sort_title` computations in `search_all_content()`'s subqueries (verified in step 2)

**6. Verify MCP behavior**

The MCP `search_items` tool routes `type="bookmark"` to `GET /bookmarks/` and `type=None` to `GET /content/`. After this change, `GET /bookmarks/` calls `search_all_content(content_types=["bookmark"])` — the same code path as `GET /content/` with a type filter. Verify the MCP response shape is unchanged.

### Testing Strategy

**Behavioral equivalence (run before removing old code):**
- `test__list_bookmarks__same_results_as_unified` — `GET /bookmarks/?q=test` returns the same items as `GET /content/?q=test&content_types=bookmark` (verify IDs, order, pagination)
- Same for notes and prompts
- `test__list_bookmarks__same_sort_behavior` — Verify sort_by=title produces the same ordering through both paths (COALESCE/NULLIF/LOWER equivalence)
- `test__list_bookmarks__same_tag_filter_behavior` — Tag filtering (all/any) produces same results
- `test__list_bookmarks__same_filter_expression_behavior` — Content filter expressions produce same results

**Response field verification (new tests — existing tests don't cover these for individual endpoints):**
- `test__list_bookmarks__response_includes_content_metrics_and_summary` — Verify `content_length`, `content_preview`, and `summary` are present and correct in the response. These fields now come from UNION subquery + row mapping instead of SQLAlchemy model attributes — a missing field in the mapping would be a silent data regression.
- `test__list_notes__response_includes_content_metrics` — Same for notes (`content_length`, `content_preview`)
- `test__list_prompts__response_includes_content_metrics` — Same for prompts
- `test__list_bookmarks__url_field_present` — Bookmark-specific `url` field is populated
- `test__list_bookmarks__summary_field_present` — Bookmark-specific `summary` field is populated from ContentListItem
- `test__list_notes__name_field_absent` — Note responses don't include bookmark-specific fields

**Filter expression at API level (new test — no existing API-level coverage):**
- `test__list_bookmarks__filter_id_applies_expression` — Verify `filter_id` parameter correctly applies tag filter expressions through the new path. Service-level tests exist but no API test covers this wiring.

**Sort equivalence with title fallback (new tests — untested at API level):**
- `test__list_bookmarks__sort_by_title_falls_back_to_url` — Bookmarks with no title sort by URL. Verifies the inline `sort_title` computation matches the old `_get_sort_columns()` behavior.
- `test__list_prompts__sort_by_title_falls_back_to_name` — Prompts with no title sort by name.

**Existing test suite:**
- All existing list/search tests for bookmarks, notes, prompts, and content should continue passing. These are the primary regression tests. The unified path (`search_all_content()` + `/content/` endpoint) already has stronger test coverage than the individual endpoints.

**MCP:**
- `test__mcp_search_items__bookmark_type_filter` — MCP search with `type="bookmark"` returns same results as before
- `test__mcp_search_items__no_type_filter` — MCP search without type filter returns same results as before

---

## Milestone 3: FTS + ILIKE Combined Search with Relevance Sorting

### Goal & Outcome
Add FTS alongside ILIKE in the now-consolidated search path. Every search runs both mechanisms in a single query, with a combined relevance score. Add relevance sorting with proper default resolution.

After this milestone:
- All search endpoints use a single query combining FTS (`websearch_to_tsquery` + `@@`) and ILIKE (`%pattern%`) via OR
- Results are ranked by a combined score: `ts_rank` from FTS + synthetic ILIKE score based on which field matched
- Items matching both FTS and ILIKE rank highest; FTS-only and ILIKE-only matches are both included
- Empty tsquery guard prevents stop-word-only queries ("the", "and or") from matching everything via ILIKE
- Results default to relevance sorting when a search query is present
- All routers accept `sort_by: "relevance"` and default to `None`

### Design Decisions & Rationale

**Why both FTS and ILIKE in every query (not FTS-primary with ILIKE fallback):**

An earlier version of this plan used FTS as the primary search, with ILIKE as a sequential fallback only when FTS returned zero results. We rejected this approach for two reasons:

1. **The user base is technical.** The FTS blind spots — partial words ("auth" not matching "authentication"), code symbols (`useState`, `onClick`), camelCase identifiers, punctuation-laden terms (`node.js`, `docker-compose`, `.env`) — are primary search patterns for this product's users, not edge cases. A design that treats these as rare fallback scenarios doesn't fit.

2. **The sequential fallback misses results.** If FTS returns 3 results but ILIKE would have found 5 additional relevant matches (e.g., partial word matches), the fallback never fires because FTS returned non-zero results. The user silently misses relevant content.

Alternatives considered:
- **Sequential fallback (FTS first, ILIKE only on zero results):** Simpler implementation, but misses ILIKE-only results when FTS finds anything. Rejected for reason #2 above.
- **pg_trgm (trigram indexes):** PostgreSQL's `pg_trgm` extension provides GIN-indexed substring matching, which would let both sides of the OR use indexes. However, it solves a scaling problem that doesn't exist at our current data volume (see performance section below) and adds index maintenance overhead on every searchable field. Worth revisiting if per-user item counts grow to tens of thousands.
- **Two concurrent queries via asyncio.gather():** Eliminates the OR-defeats-GIN-index concern by running separate queries in parallel. Doubles connection pool usage per search. Unnecessary at current scale where the single combined query is already fast.

**Why combined scoring (not ILIKE score = 0):**

With ILIKE results scored at 0, every ILIKE-only match sorts below every FTS match. For technical searches like "auth", a bookmark titled "Auth0 Setup Guide" (ILIKE title match) would rank below a document that mentions "authentication" once in a 50KB content field (weak FTS match). Assigning synthetic ILIKE scores based on which field matched (title > description > content) produces a more meaningful ranking. An item matching both FTS and ILIKE is a stronger signal than either alone, so the scores are additive.

The exact ILIKE score weights (0.8 for title, 0.4 for description, 0.1 for content) are approximate. The relative ordering matters more than the absolute values. `ts_rank` with default weights returns values roughly in the 0-1 range, so the synthetic scores are calibrated to interleave reasonably. At current result set sizes (typically <50 items), "roughly right" ranking is sufficient — users scan all results regardless. If result sets grow significantly or embedding-based search is added later, a more principled fusion approach (e.g., Reciprocal Rank Fusion) would replace this.

**Why the empty tsquery guard is still needed:**

With the combined query approach, if the user searches "the" (all stop words), `websearch_to_tsquery` produces an empty tsquery. The `@@` operator with an empty tsquery matches nothing, so only the ILIKE side of the OR fires. `%the%` matches virtually everything. The guard detects empty tsqueries and returns zero results immediately, preventing stop-word-only queries from returning the entire collection.

**Performance at current scale:**

Every query filters by `user_id` first (indexed), narrowing to hundreds or low thousands of rows per user. At this scale:
- A sequential scan across a user's rows takes microseconds. The GIN index on `search_vector` provides no meaningful speedup — PostgreSQL's query planner will likely choose a sequential scan regardless.
- The OR combining FTS and ILIKE cannot use the GIN index efficiently (PostgreSQL can't bitmap-merge FTS and ILIKE results from different index types). This doesn't matter because the sequential scan is already fast.
- The combined score computation (ts_rank + CASE expression) adds negligible overhead — PostgreSQL is already scanning the relevant fields for the ILIKE WHERE clause.
- The empty tsquery guard adds one lightweight query (`SELECT cast(websearch_to_tsquery(...) as text)`) per search. Negligible at any scale.

The GIN indexes are still worth adding as cheap insurance (see Milestone 1). They have negligible maintenance cost (only on content-changing writes, not on `last_used_at` bumps or archive/unarchive due to the trigger's `IS DISTINCT FROM` guard). If per-user item counts grow to tens of thousands, or if the search strategy evolves to FTS-only for some paths, the indexes are already in place.

### Implementation Outline

**1. Update `_apply_entity_filters()` in `content_service.py` to use combined FTS + ILIKE**

This is the single place where text search logic lives (after Milestone 2). Replace the current ILIKE-only block with a combined OR:

```python
# Current:
if query:
    escaped_query = escape_ilike(query)
    search_pattern = f"%{escaped_query}%"
    filters.append(
        or_(*[field.ilike(search_pattern) for field in text_search_fields]),
    )

# New:
if query and tsquery_is_non_empty:
    tsquery = func.websearch_to_tsquery('english', query)
    escaped_query = escape_ilike(query)
    search_pattern = f"%{escaped_query}%"

    # FTS match on search_vector
    fts_filter = search_vector_column.op('@@')(tsquery)

    # ILIKE match on text fields (title, description, content, etc.)
    ilike_filter = or_(*[field.ilike(search_pattern) for field in text_search_fields])

    # For bookmarks, also match URL via ILIKE
    if url_ilike_column is not None:
        ilike_filter = or_(ilike_filter, url_ilike_column.ilike(search_pattern))

    # Combined: match if either FTS or ILIKE hits
    filters.append(or_(fts_filter, ilike_filter))
```

Update the function signature to accept `search_vector_column` in addition to `text_search_fields`. The bookmark subquery passes `Bookmark.search_vector`, `Bookmark.url`, and text search fields; notes and prompts pass their `search_vector` and text search fields.

**2. Add empty tsquery guard**

Before running the search, check if the tsquery is empty (all stop words):

```python
if query:
    # Check if tsquery is empty (all stop words like "the", "and", "or")
    tsquery_text = await db.scalar(select(func.cast(
        func.websearch_to_tsquery('english', query), String,
    )))
    tsquery_is_non_empty = bool(tsquery_text and tsquery_text.strip())

    if not tsquery_is_non_empty:
        return [], 0  # All stop words — return nothing
```

This prevents "the" from matching everything via the ILIKE side of the OR. Without this guard, the FTS side matches nothing (empty tsquery), but `%the%` via ILIKE matches virtually every document.

**3. Add combined relevance score to UNION subqueries**

Each entity subquery needs a combined score from FTS (`ts_rank`) and ILIKE (synthetic field-based score):

```python
if query and tsquery_is_non_empty:
    tsquery = func.websearch_to_tsquery('english', query)
    escaped_query = escape_ilike(query)
    search_pattern = f"%{escaped_query}%"

    # FTS relevance score (0.0 to ~1.0, field-weighted)
    fts_score = func.ts_rank(model.search_vector, tsquery)

    # Synthetic ILIKE score based on which field matched
    # Title match is strongest signal, content match is weakest
    ilike_score = case(
        (model.title.ilike(search_pattern), 0.8),
        (model.description.ilike(search_pattern), 0.4),
        (model.content.ilike(search_pattern), 0.1),
        else_=0,
    )

    # Combined: additive so items matching both rank highest
    rank_col = (fts_score + ilike_score).label("search_rank")
else:
    rank_col = literal(0).label("search_rank")
```

Note: The ILIKE CASE expression uses short-circuit evaluation — it assigns the score of the highest-priority matching field. A title match gets 0.8 regardless of whether description or content also match. This is intentional: the goal is to boost items where the match is in a prominent field, not to count the number of matching fields.

For bookmarks, the ILIKE CASE should also include `summary` (between description and content) and `url` (at a low weight, since URL matches are incidental).

**4. `sort_by: "relevance"` support and default resolution**

**Deliberate behavior change:** When a search query is present and `sort_by` is not explicitly specified, results now default to relevance sorting instead of `created_at`. This is the expected UX — users want the most relevant results first when searching.

Update `resolve_filter_and_sorting()` in `api/helpers/filter_utils.py` to accept an optional `query` parameter. The sort priority chain:

1. **Explicit user `sort_by` param** → wins always
2. **Query present + no explicit sort** → `"relevance"`
3. **Filter's `default_sort_by`** → applies when no query and no explicit sort
4. **Global default** → `"created_at"`

```python
def resolve_filter_and_sorting(
    ...,
    query: str | None = None,  # NEW
) -> ResolvedFilter:
    ...
    if sort_by:
        effective_sort_by = sort_by
    elif query:
        effective_sort_by = "relevance"
    elif content_filter and content_filter.default_sort_by:
        effective_sort_by = content_filter.default_sort_by
    else:
        effective_sort_by = "created_at"
```

Update all routers to:
- Add `"relevance"` to the `sort_by` Literal type
- Default `sort_by` to `None` instead of `"created_at"`
- Pass `query` (the `q` param) to `resolve_filter_and_sorting()`

When `sort_by="relevance"` but no query is present, fall back to `created_at` silently.

**5. Update MCP `search_items` tool descriptions**

The MCP server describes search behavior to LLMs in three places: the `search_items` tool `description=` string, the `search_items` docstring/examples, and the main `mcp = FastMCP(instructions=...)` block (the "Search" section and example workflows). All three need to be updated to describe how search works so that LLMs can optimize their search queries.

Key information to convey:
- Search uses full-text search with English stemming ("running" matches "runners", "databases" matches "database") combined with substring matching
- Complete words are preferred and rank higher ("authentication" ranks higher than "auth" for matching a document containing "authentication")
- Partial words and code symbols still work via substring matching ("auth", "useState", "node.js") but may rank lower
- Quoted phrases for exact adjacency (`"python database"`)
- Negation with `-` to exclude terms (`python -beginner`)
- OR for alternatives (`python OR javascript`)
- Bookmark URLs are matched via substring, so partial URL searches work
- Results are ranked by relevance by default when a query is present
- The `query` field description on the tool should reflect that this is combined full-text + substring search

Leave the final wording to the implementing agent — the above is the information that must be communicated, not the exact phrasing.

### Testing Strategy

**FTS behavior:**
- `test__search__fts_matches_stemmed_words` — Search "running" matches a bookmark with "runners" in title
- `test__search__fts_title_matches_rank_higher` — A title match (weight A) ranks above a content-only match (weight C) for the same query
- `test__search__fts_websearch_syntax` — Test `websearch_to_tsquery` features: quoted phrases (`"exact phrase"`), OR operator, negation (`-excluded`)
- `test__search__fts_empty_query_returns_all` — Empty/None query still returns all results (no filter applied)

**ILIKE behavior (substring matching):**
- `test__search__ilike_matches_partial_words` — Search for "auth" matches "authentication" via ILIKE
- `test__search__ilike_matches_code_symbols` — Search for "useState" matches content containing that exact symbol
- `test__search__ilike_matches_punctuated_terms` — Search for "node.js" matches content containing "node.js"
- `test__search__bookmark_url_ilike_match` — Searching "github.com/anthropics" matches a bookmark with that URL even if it's not in title/content

**Combined scoring:**
- `test__search__both_fts_and_ilike_match_ranks_highest` — A document matching both FTS and ILIKE ranks above one matching only FTS
- `test__search__ilike_title_match_ranks_above_fts_content_match` — "auth" in title (ILIKE score 0.8) ranks above a weak FTS content match (ts_rank ~0.05)
- `test__search__fts_only_match_included` — A stemmed match ("running" → "runners") that doesn't match ILIKE is still returned
- `test__search__ilike_only_match_included` — A partial word match ("auth" → "authentication") that doesn't match FTS is still returned
- `test__search__url_only_match_ranks_low` — A bookmark matching only on URL ranks below title/description matches

**Stop-word / empty tsquery guard:**
- `test__search__stop_words_only_returns_empty` — Searching "the and or" returns 0 results (guard prevents ILIKE from matching everything)
- `test__search__stop_word_mixed_with_real_term` — Searching "the python" matches documents with "python"

**Relevance sorting:**
- `test__search__default_sort_is_relevance_when_query_present` — When query is provided and sort_by is not specified, results are ordered by relevance
- `test__search__default_sort_is_created_at_when_no_query` — When no query, default sort is `created_at DESC`
- `test__search__explicit_sort_overrides_relevance` — When `sort_by="title"` is explicitly passed with a query, results sort by title
- `test__search__relevance_sort_without_query_falls_back` — `sort_by="relevance"` without a query falls back to `created_at`

**resolve_filter_and_sorting():**
- `test__resolve_filter_and_sorting__relevance_default_with_query` — query present, no explicit sort → returns `"relevance"`
- `test__resolve_filter_and_sorting__explicit_sort_wins_over_relevance` — `sort_by="title"` + query → returns `"title"`
- `test__resolve_filter_and_sorting__filter_default_wins_without_query` — filter has `default_sort_by="title"`, no query → returns `"title"`
- `test__resolve_filter_and_sorting__relevance_wins_over_filter_default_with_query` — filter has `default_sort_by="title"`, query present → returns `"relevance"`

**Cross-type behavior (verified through unified endpoint):**
- `test__search_all_content__fts_matches_across_types` — A query matching a bookmark title and a note content returns both, ranked by relevance
- `test__search_all_content__scores_comparable_across_types` — A strong title match on a note ranks above a weak content match on a bookmark

**Multi-tenancy:**
- `test__search__fts_scoped_to_user` — User A's search does not return User B's content

**Edge cases:**
- `test__search__special_characters_in_query` — Queries with `&`, `|`, `!`, `:`, parentheses don't crash
- `test__search__very_long_query` — Extremely long search string doesn't cause issues
- `test__search__null_content_fields` — Entities with NULL title/description/content are searchable

**API-level tests:**
- `test__list_bookmarks__sort_by_relevance` — API returns results sorted by relevance when `sort_by=relevance&q=...`
- `test__list_bookmarks__default_sort_relevance_with_query` — API defaults to relevance sort when `q` is provided without `sort_by`
- `test__list_bookmarks__relevance_sort_without_query_ok` — `sort_by=relevance` without `q` doesn't error
- `test__list_bookmarks__relevance_with_filter_id` — Relevance sort works correctly when combined with a content filter
- `test__list_bookmarks__sort_by_from_filter_overridden_by_relevance` — Filter specifies `sort_by=title`, user provides query without explicit sort → relevance wins
- Same pattern for notes, prompts, and content endpoints

---

## Milestone 4: `ts_headline` for Search Snippets + MCP Verification

### Goal & Outcome
Add highlighted snippets to search results showing *why* each result matched, using PostgreSQL's `ts_headline` function. Verify MCP integration.

After this milestone:
- Search results include a `search_headline` field with matching terms highlighted in `<mark>` tags
- Headlines are generated from all searchable fields (title, description, content), not just content
- MCP `search_items` tool benefits from FTS transparently

### Implementation Outline

**1. Add `search_headline` to response schemas**

Add an optional `search_headline: str | None` field to:
- `ContentListItem` (in `schemas/content.py`) — the base schema all list results flow through
- `BookmarkListItem`, `NoteListItem`, `PromptListItem` — if these remain separate schemas after Milestone 2

Default to `None` — only populated when a search query is active.

**2. Compute `ts_headline` from all searchable fields**

In `search_all_content()`, add `ts_headline` as a computed column in each entity subquery. Run it on a concatenation of all searchable fields so the snippet reflects whichever field actually matched:

```python
headline_source = func.concat_ws(
    ' ... ',
    model.title,
    model.description,
    func.left(model.content, 5000),  # Cap to limit ts_headline cost
)
headline = func.ts_headline(
    'english',
    headline_source,
    tsquery,
    'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=3, FragmentDelimiter= ... ',
)
```

The `' ... '` separator prevents false cross-field phrase matches. `MaxFragments=3` lets PostgreSQL pick the best fragments across all fields. Capping content at 5,000 chars limits `ts_headline` cost on large bookmarks.

For bookmarks, include `summary` in the concatenation as well (between description and content).

If `ts_headline` performance becomes an issue on large result sets, a future optimization is to compute it in a subquery after pagination. The 5,000-char cap makes this unlikely at current scale.

**3. ILIKE-only match headlines**

For items that matched only via ILIKE (not FTS), `ts_headline` may not highlight the matching term if FTS tokenization didn't produce a matching lexeme. This is acceptable — `ts_headline` will still attempt to find relevant fragments, and the `content_preview` field provides additional context. If the tsquery is empty (stop-word guard triggered), `search_headline` should be `None`.

**4. Verify MCP integration**

The Content MCP server calls the REST API via HTTP. Since FTS is a backend change, the MCP server benefits automatically. Verify by:
- Confirming the MCP `search_items` tool passes the `q` parameter through to the API
- Confirming the response still matches the expected MCP format
- No MCP-side code changes expected

### Testing Strategy

- `test__search__headline_contains_matching_terms` — Search for "python" returns a headline containing `<mark>python</mark>` (or the stemmed variant)
- `test__search__headline_from_best_matching_field` — A title-only match produces a headline highlighting the title text, not a random content snippet
- `test__search__headline_is_none_when_no_query` — When no search query, `search_headline` is `None`
- `test__search__headline_for_ilike_only_match` — When a result matched only via ILIKE (not FTS), `search_headline` is still computed (may or may not contain highlights depending on tokenization)
- `test__search__headline_with_null_content` — Entity with NULL content doesn't crash headline generation
- `test__list_bookmarks__search_headline_in_response` — API response includes `search_headline` field when `q` is provided
- `test__list_bookmarks__search_headline_null_without_query` — `search_headline` is null when no query
- Same pattern for notes, prompts, and content endpoints

---

## Notes for the Agent

### Key Files to Modify

**Milestone 1 (Migration):**
- `backend/src/db/migrations/versions/` — new migration file (columns, triggers, trigger functions, indexes, backfill)
- `backend/src/models/bookmark.py`, `note.py`, `prompt.py` — add `search_vector` column

**Milestone 2 (Consolidation):**
- `backend/src/api/routers/bookmarks.py`, `notes.py`, `prompts.py` — change list endpoints to call `search_all_content()`
- `backend/src/services/content_service.py` — may need minor adjustments to support single-type usage cleanly
- `backend/src/services/base_entity_service.py` — remove `search()`, `_build_text_search_filter()`, and related helper methods
- `backend/src/services/bookmark_service.py`, `note_service.py`, `prompt_service.py` — remove `_build_text_search_filter()`, `_get_sort_columns()`
- `backend/src/schemas/content.py` — add `summary: str | None = None` to `ContentListItem`
- `backend/tests/` — verify all existing search tests pass through new path

**Milestone 3 (FTS + ILIKE combined):**
- `backend/src/services/content_service.py` — combined FTS + ILIKE in `_apply_entity_filters()`, combined scoring, empty tsquery guard
- `backend/src/api/helpers/filter_utils.py` — update `resolve_filter_and_sorting()` to accept `query` param
- `backend/src/api/routers/bookmarks.py`, `notes.py`, `prompts.py`, `content.py` — add `"relevance"` sort, default `sort_by` to `None`, pass `query` to helper
- `backend/src/mcp_server/server.py` — update `search_items` description, docstring, and `FastMCP(instructions=...)` to describe combined search behavior
- `backend/tests/` — new FTS tests, ILIKE tests, combined scoring tests, relevance sorting tests

**Milestone 4 (Headlines):**
- `backend/src/services/content_service.py` — add `ts_headline` to subqueries
- `backend/src/schemas/content.py`, `bookmark.py`, `note.py`, `prompt.py` — add `search_headline` field
- `backend/tests/` — headline tests

### Documentation to Read Before Implementing
- PostgreSQL FTS docs: https://www.postgresql.org/docs/current/textsearch.html
- `websearch_to_tsquery`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-PARSING-QUERIES
- `ts_rank`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-RANKING
- `ts_headline`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-HEADLINE
- SQLAlchemy TSVector: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#full-text-search

### Important Implementation Details
- Use `websearch_to_tsquery` (not `plainto_tsquery` or `to_tsquery`) — it handles Google-like syntax safely without injection risks
- The `'english'` text search configuration provides stemming. This is intentional for v1.
- `search_vector` is trigger-maintained, not a generated column. The trigger only recomputes when content fields change. The ELSE branch preserves the old value defensively. SQLAlchemy should not write to this column, but the trigger handles it either way.
- Every search query runs both FTS and ILIKE in a single OR. There is no sequential fallback — both mechanisms always run together.
- `ts_rank` output is a float — it's comparable across entities using the same tsvector config and weight scheme. The combined relevance score adds a synthetic ILIKE score (0.8 title / 0.4 description / 0.1 content) to `ts_rank` so that ILIKE-only matches (partial words, code symbols) get meaningful ranking.
- Guard against empty tsquery (all stop words) — return zero results. Without this, the ILIKE side of the OR would match everything for queries like "the".
- `ts_headline` runs on a concatenation of all searchable fields (not just content) so the snippet reflects whichever field matched. Cap content at 5,000 chars with `func.left()`. For ILIKE-only matches, `ts_headline` still runs but may not produce highlights if the FTS tokenizer didn't recognize the matched term.
- Existing tests that search for exact substrings should continue to pass because ILIKE still runs alongside FTS. However, result ordering may change due to relevance sorting — tests that assert specific ordering may need updating.
