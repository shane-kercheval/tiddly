# Phase 1: PostgreSQL Full-Text Search (FTS) Implementation Plan

**Reference:** `docs/implementation_plans/roadmap-search.md` — Phase 1

**Goal:** Replace ILIKE with PostgreSQL FTS for ranked, language-aware keyword search. Zero new infrastructure. Retain ILIKE for URL substring matching and as a fallback when FTS returns zero results.

---

## Milestone 1: Database Migration — `search_vector` Columns + GIN Indexes

### Goal & Outcome
Add a stored generated `tsvector` column and GIN index to each entity table (`bookmarks`, `notes`, `prompts`) so PostgreSQL can perform full-text search without recomputing vectors on every query.

After this milestone:
- Each entity table has a `search_vector` column automatically maintained by PostgreSQL
- GIN indexes exist for fast FTS lookups
- Existing data is searchable via FTS immediately (generated columns backfill on creation)
- No application code changes yet — this is purely a schema change

### Implementation Outline

Create a single Alembic migration (follow existing pattern in `backend/src/db/migrations/versions/`).

**Bookmark `search_vector`** — weighted across 4 text fields:
```sql
ALTER TABLE bookmarks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;
```

**Note `search_vector`** — weighted across 3 text fields:
```sql
ALTER TABLE notes ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;
```

**Prompt `search_vector`** — weighted across 4 text fields (`name` is a structural identifier, so weight it same as title):
```sql
ALTER TABLE prompts ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;
```

**GIN Indexes:** Use `CREATE INDEX CONCURRENTLY` for each table to avoid locking during creation. Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Alembic migrations run inside transactions by default. The migration must use `op.execute()` with `op.get_bind().execute()` outside a transaction context, or set `autocommit` mode on the connection. Check the Alembic docs for `CONCURRENTLY` pattern — the standard approach is:

```python
from alembic import op

def upgrade() -> None:
    # Add generated columns (these can run in a transaction)
    op.execute("""
        ALTER TABLE bookmarks ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (...) STORED
    """)
    # ... same for notes and prompts ...

    # GIN indexes must be created CONCURRENTLY (outside transaction)
    # Alembic approach: use separate migration or op.execute with autocommit
    op.create_index(
        'ix_bookmarks_search_vector',
        'bookmarks',
        ['search_vector'],
        postgresql_using='gin',
    )
    # ... same for notes and prompts ...
```

If `CREATE INDEX CONCURRENTLY` proves problematic in Alembic, it's acceptable to use a standard `CREATE INDEX` for this migration — at current scale the lock is brief. Add a comment noting this can be changed to CONCURRENTLY when table size warrants it.

**SQLAlchemy model updates:** Add the `search_vector` column to each model class (`Bookmark`, `Note`, `Prompt`) so SQLAlchemy is aware of it. The column is read-only (generated), so mark it accordingly:

```python
from sqlalchemy.dialects.postgresql import TSVECTOR

# In each model:
search_vector = mapped_column(TSVECTOR, nullable=True, insert_default=None)
```

Since this is a `GENERATED ALWAYS` column, SQLAlchemy should not include it in INSERT/UPDATE statements. Use `Column(..., server_default=None)` or mark it with `Computed()` if needed — verify this with a quick test. The key requirement: SQLAlchemy must not try to write to this column.

**Downgrade:** Drop the indexes and columns.

### Testing Strategy

- **Migration test:** Run `make migrate` against the test database, verify the columns and indexes exist via raw SQL inspection (`SELECT column_name FROM information_schema.columns`, `SELECT indexname FROM pg_indexes`)
- **Generated column test:** Insert a bookmark with known title/content, verify `search_vector` is populated by querying `SELECT search_vector FROM bookmarks WHERE id = ...`
- **Verify existing tests still pass:** Run `make unit_tests` — no application code changed, so all existing tests should pass. If any tests inspect column lists or schema metadata, they may need minor updates.
- **Verify generated column is read-only:** Confirm that SQLAlchemy INSERT/UPDATE on entities does not attempt to write to `search_vector` (the existing test suite exercises create/update, so this is implicitly tested)

---

## Milestone 2: Service Layer — FTS Search with `ts_rank` and ILIKE Fallback

### Goal & Outcome
Replace ILIKE-based text search with FTS in the service layer for individual entity searches (`BookmarkService`, `NoteService`, `PromptService` via `BaseEntityService`). Retain ILIKE on `Bookmark.url` and implement an ILIKE fallback when FTS returns zero results.

After this milestone:
- Searching bookmarks/notes/prompts uses `websearch_to_tsquery` + `ts_rank` for ranked results
- Bookmark URL search still uses ILIKE substring matching
- When FTS returns 0 results, a fallback ILIKE search runs automatically (handles partial words, code symbols, non-English text)
- Results are ranked by relevance when a search query is present

### Implementation Outline

**1. Refactor `_build_text_search_filter()` signature and purpose**

The current abstract method returns ILIKE conditions from a `%pattern%` string. Refactor it to accept the raw query string and return FTS conditions instead. The base class `search()` method needs to change how it calls this.

Rename the method to `_build_fts_filter()` (or similar) to make the semantic change clear. It should return a tuple or structured object containing:
- The FTS filter condition (`search_vector @@ tsquery`)
- The `tsquery` expression (needed for `ts_rank` and `ts_headline` later)
- An ILIKE fallback condition for when FTS returns 0 results

Suggested pattern — add a helper in `base_entity_service.py` or a new `search_utils.py`:

```python
from sqlalchemy import func

def build_fts_query(search_query: str) -> Any:
    """Build a websearch_to_tsquery from user input."""
    return func.websearch_to_tsquery('english', search_query)

def build_fts_filter(search_vector_column, tsquery) -> Any:
    """Build a tsvector @@ tsquery filter."""
    return search_vector_column.op('@@')(tsquery)

def build_fts_rank(search_vector_column, tsquery) -> Any:
    """Build ts_rank expression for ordering."""
    return func.ts_rank(search_vector_column, tsquery)
```

**2. Update `BaseEntityService.search()` to use FTS with fallback**

The core change to the `search()` method in `base_entity_service.py`:

```python
# When query is provided:
tsquery = func.websearch_to_tsquery('english', query)
fts_filter = self.model.search_vector.op('@@')(tsquery)
rank_expr = func.ts_rank(self.model.search_vector, tsquery)

# Build FTS query
fts_query = base_query.where(fts_filter)

# Execute count
total = ... count from fts_query ...

# If FTS returns 0 results, fall back to ILIKE
if total == 0:
    ilike_filters = self._build_ilike_fallback_filter(query)
    fallback_query = base_query.where(or_(*ilike_filters))
    # Use fallback query for results (no ts_rank ordering — use default sort)
    ...
else:
    # Use FTS query with ts_rank ordering when sort_by is "relevance"
    ...
```

**3. Entity-specific changes**

Each service needs:
- A `_build_ilike_fallback_filter(query)` method that returns the old ILIKE conditions (essentially the current `_build_text_search_filter` logic, preserved for fallback)
- Remove the old `_build_text_search_filter` method

**BookmarkService** specifically: always include `Bookmark.url.ilike(f'%{escape_ilike(query)}%')` as an additional OR condition alongside the FTS filter, so URL substring matches always surface even when FTS also matches other results. This means the bookmark FTS query should be:

```python
where(or_(
    Bookmark.search_vector.op('@@')(tsquery),
    Bookmark.url.ilike(url_pattern),
))
```

When this combined filter is used, `ts_rank` will return 0 for URL-only matches, which is fine — they'll sort after FTS matches when using relevance ordering, and sort normally for other sort options.

**4. `sort_by: "relevance"` support**

- Add `"relevance"` to the `sort_by` Literal type in `search()` and `_get_sort_columns()`
- When `sort_by="relevance"` and a query is present, order by `ts_rank(search_vector, tsquery) DESC` with the standard tiebreakers
- When `sort_by="relevance"` but no query is present, fall back to `created_at DESC` (or raise a validation error — prefer falling back silently)
- When a query is provided and no `sort_by` is specified by the caller, default to `"relevance"` (change the default from `"created_at"` to `None`, and resolve to `"relevance"` when query is present, `"created_at"` when not)

The default sort behavior change: when `sort_by` is not explicitly provided by the user (i.e., it's `None`) and a search query is active, automatically sort by relevance. This is the natural UX — users expect the most relevant results first. When `sort_by` is explicitly specified, respect it even if a query is present.

This means `sort_by` parameter should be `Optional` (default `None`) rather than defaulting to `"created_at"`. The resolution logic:
```python
effective_sort_by = sort_by or ("relevance" if query else "created_at")
```

Update routers to pass `None` as default instead of `"created_at"`. Note: the `resolve_filter_and_sorting()` helper in `api/helpers.py` may also need updating since it handles default sort logic for content filters.

### Testing Strategy

**FTS core behavior:**
- `test__search__fts_matches_stemmed_words` — Search "running" matches a bookmark with "runners" in title
- `test__search__fts_title_matches_rank_higher` — A title match (weight A) ranks above a content-only match (weight C) for the same query
- `test__search__fts_websearch_syntax` — Test `websearch_to_tsquery` features: quoted phrases (`"exact phrase"`), OR operator, negation (`-excluded`)
- `test__search__fts_stop_words_ignored` — Searching "the" alone returns no results (stop word)
- `test__search__fts_empty_query_returns_all` — Empty/None query still returns all results (no filter applied)

**URL ILIKE for bookmarks:**
- `test__search__bookmark_url_ilike_match` — Searching "github.com/anthropics" matches a bookmark with that URL even if it's not in title/content
- `test__search__bookmark_url_match_ranks_below_fts` — URL-only match appears after FTS matches when sorted by relevance

**ILIKE fallback:**
- `test__search__ilike_fallback_on_zero_fts_results` — Search for "useAuth" (code symbol that FTS tokenizes badly) returns results via ILIKE fallback
- `test__search__ilike_fallback_partial_word` — Search for "auth" matches "authentication" via ILIKE fallback when FTS finds nothing
- `test__search__no_fallback_when_fts_has_results` — When FTS returns results, ILIKE fallback does NOT run (verify by checking that a partial match that would only be found by ILIKE is absent when FTS has other results)

**Relevance sorting:**
- `test__search__default_sort_is_relevance_when_query_present` — When query is provided and sort_by is not specified, results are ordered by relevance
- `test__search__default_sort_is_created_at_when_no_query` — When no query, default sort is `created_at DESC`
- `test__search__explicit_sort_overrides_relevance` — When `sort_by="title"` is explicitly passed with a query, results sort by title, not relevance
- `test__search__relevance_sort_without_query_falls_back` — `sort_by="relevance"` without a query falls back to `created_at`

**Multi-tenancy:**
- `test__search__fts_scoped_to_user` — User A's search does not return User B's content (existing tests likely cover this, but verify with FTS path)

**Edge cases:**
- `test__search__special_characters_in_query` — Queries with `&`, `|`, `!`, `:`, parentheses don't crash (websearch_to_tsquery handles this, but verify)
- `test__search__very_long_query` — Extremely long search string doesn't cause issues
- `test__search__null_content_fields` — Entities with NULL title/description/content are searchable (coalesce in generated column handles this)

---

## Milestone 3: `ts_headline` for Search Snippets

### Goal & Outcome
Add highlighted snippets to search results showing *why* each result matched, using PostgreSQL's `ts_headline` function.

After this milestone:
- Search results include a `search_headline` field containing a text snippet with matching terms highlighted
- The snippet shows relevant context around matching words
- The highlight markers are configurable (defaulting to `<mark>` / `</mark>` for HTML rendering)

### Implementation Outline

**1. Add `search_headline` to response schemas**

Add an optional `search_headline: str | None` field to:
- `BookmarkListItem` (in `schemas/bookmark.py`)
- `NoteListItem` (in `schemas/note.py`)
- `PromptListItem` (in `schemas/prompt.py`)
- `ContentListItem` (in `schemas/content.py`)

Default to `None` — only populated when a search query is active.

**2. Compute `ts_headline` in the search query**

In `BaseEntityService.search()`, when a query is present and FTS is used, add `ts_headline` as a computed column:

```python
headline = func.ts_headline(
    'english',
    func.coalesce(self.model.content, ''),
    tsquery,
    'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=3, FragmentDelimiter= ... ',
)
```

`ts_headline` operates on the original text (not the tsvector), so it can produce readable snippets. It's more expensive than `ts_rank` because it processes the full text, but it only runs on the paginated result set (not all matching rows), so the cost is bounded.

Apply `ts_headline` to the content field (the longest, most likely to contain the match context). For bookmarks, could also consider running it on `coalesce(content, description, summary, '')` to pick the most relevant field.

**3. Attach headline to entities**

Similar to how `content_length` and `content_preview` are attached to entities after query execution, attach the headline:

```python
entity.search_headline = row[3]  # After content_length, content_preview
```

**4. ILIKE fallback headlines**

When the ILIKE fallback is used (FTS returned 0 results), `ts_headline` won't work well since there's no tsquery. For ILIKE fallback results, set `search_headline = None` (no snippet). This is acceptable — ILIKE fallback is an edge case, and the `content_preview` field already provides context.

### Testing Strategy

- `test__search__headline_contains_matching_terms` — Search for "python" returns a headline containing `<mark>python</mark>` (or the stemmed variant)
- `test__search__headline_is_none_when_no_query` — When no search query, `search_headline` is `None`
- `test__search__headline_is_none_for_ilike_fallback` — When ILIKE fallback triggers, `search_headline` is `None`
- `test__search__headline_from_content_field` — Headline extracts snippet from content, not title
- `test__search__headline_with_null_content` — Entity with NULL content doesn't crash headline generation (coalesce handles it)

---

## Milestone 4: Unified Content Search — FTS for `search_all_content()`

### Goal & Outcome
Update the unified content search in `content_service.py` to use FTS with `ts_rank` for the UNION ALL query across bookmarks, notes, and prompts.

After this milestone:
- `GET /content/` endpoint uses FTS for text search across all content types
- Results are ranked by `ts_rank` (comparable across entity types since all use the same `'english'` config and weight scheme)
- ILIKE on `Bookmark.url` is preserved in the unified search
- ILIKE fallback on zero FTS results works for unified search
- `ts_headline` snippets included in unified results
- `sort_by: "relevance"` supported in unified search

### Implementation Outline

**1. Update `_apply_entity_filters()` in `content_service.py`**

This function currently builds ILIKE filters from `text_search_fields`. Refactor it to:
- Accept the `search_vector` column instead of (or in addition to) `text_search_fields`
- Build FTS filter: `search_vector.op('@@')(tsquery)`
- For bookmarks specifically, also include `Bookmark.url.ilike(pattern)` as an OR condition
- Keep the ILIKE fallback logic

The function signature change:
```python
def _apply_entity_filters(
    filters: list,
    model: type,
    junction_table: Table,
    search_vector_column,  # NEW: the model's search_vector column
    url_ilike_column=None,  # NEW: optional, for bookmark URL matching
    text_search_fields: list = None,  # KEPT: for ILIKE fallback
    ...
)
```

**2. Add `ts_rank` to UNION subqueries**

Each entity subquery in the UNION needs to include `ts_rank(search_vector, tsquery)` as a computed column so results can be sorted by relevance across entity types. When no query is active, this column should be a literal `0` or `NULL`.

```python
if query:
    tsquery = func.websearch_to_tsquery('english', query)
    rank_col = func.ts_rank(Bookmark.search_vector, tsquery).label("search_rank")
else:
    rank_col = literal(0).label("search_rank")
```

**3. Add `ts_headline` to UNION subqueries**

Similarly, add `ts_headline` as a computed column in each subquery.

**4. Update sorting to support "relevance"**

Add `"relevance"` to the `sort_by` Literal in `search_all_content()` and the `/content/` router. When relevance sort is active, order by `search_rank DESC` with tiebreakers.

**5. ILIKE fallback for unified search**

The fallback logic is the same as for individual entity search: if the FTS-based count is 0, re-run with ILIKE filters. Since the unified search builds separate subqueries per entity type, the fallback needs to rebuild all subqueries with ILIKE filters. This is a second pass, only on zero results — acceptable cost.

### Testing Strategy

**Core FTS behavior:**
- `test__search_all_content__fts_matches_across_types` — A query matching a bookmark title and a note content returns both, ranked by relevance
- `test__search_all_content__fts_title_match_ranks_higher` — A bookmark with the query in its title ranks above a note with the query only in content

**Bookmark URL matching:**
- `test__search_all_content__url_match_included` — Searching "github.com" returns bookmarks with that URL

**ILIKE fallback:**
- `test__search_all_content__ilike_fallback_on_zero_fts` — Searching for a code symbol like "useState" that FTS can't match returns results via ILIKE fallback

**Relevance sorting:**
- `test__search_all_content__default_sort_relevance_with_query` — When query present and sort_by not specified, results sorted by relevance
- `test__search_all_content__explicit_sort_overrides_relevance` — `sort_by="title"` with a query sorts by title

**Snippets:**
- `test__search_all_content__headline_included` — Search results include `search_headline` with marked-up terms

**Cross-type score comparability:**
- `test__search_all_content__scores_comparable_across_types` — A strong title match on a note ranks above a weak content match on a bookmark (verifies ts_rank normalization works across the UNION)

---

## Milestone 5: API Layer Updates + MCP Integration

### Goal & Outcome
Update the REST API endpoints and MCP servers to expose the new FTS capabilities.

After this milestone:
- All search endpoints accept `sort_by: "relevance"` and default to relevance when a query is present
- Search responses include `search_headline` field
- MCP `search_items` tool benefits from FTS transparently (no MCP API changes needed, since it calls the same backend)
- API documentation reflects new capabilities

### Implementation Outline

**1. Update router `sort_by` Literals**

In all routers (`bookmarks.py`, `notes.py`, `prompts.py`, `content.py`), add `"relevance"` to the `sort_by` Literal type:

```python
sort_by: Literal[
    "created_at", "updated_at", "last_used_at", "title",
    "archived_at", "deleted_at", "relevance",
] | None = Query(default=None, ...)
```

**2. Update `resolve_filter_and_sorting()` helper**

The helper in `api/helpers.py` resolves sort defaults from content filters. It needs to handle:
- `sort_by=None` + query present → `"relevance"`
- `sort_by=None` + no query → existing default logic (from filter or `"created_at"`)
- `sort_by="relevance"` + no query → fall back gracefully

**3. Verify MCP integration**

The Content MCP server (`backend/src/mcp_server/server.py`) has a `search_items` tool that calls the API. Since FTS is a backend change, the MCP server should benefit automatically. Verify this by:
- Reading the MCP `search_items` implementation to confirm it passes the query parameter through
- No MCP-side changes expected unless the MCP server constructs its own search queries

**4. Update response schemas**

Ensure `search_headline` is included in all list response schemas. This was done in Milestone 3 for individual entity schemas — verify it's also in the `ContentListItem` schema for the unified endpoint.

**5. Frontend considerations**

The frontend will need to render `search_headline` (HTML with `<mark>` tags). This is a frontend change outside the scope of this plan, but note that the API will now return this field. The frontend can adopt it incrementally.

### Testing Strategy

**API-level tests:**
- `test__list_bookmarks__sort_by_relevance` — API returns results sorted by relevance when `sort_by=relevance&q=...`
- `test__list_bookmarks__default_sort_relevance_with_query` — API defaults to relevance sort when `q` is provided without `sort_by`
- `test__list_bookmarks__relevance_sort_without_query_ok` — `sort_by=relevance` without `q` doesn't error (falls back)
- `test__list_bookmarks__search_headline_in_response` — Response includes `search_headline` field when `q` is provided
- `test__list_bookmarks__search_headline_null_without_query` — `search_headline` is null when no query
- Same pattern for notes, prompts, and content endpoints

**MCP integration:**
- `test__mcp_search_items__fts_results` — MCP search returns FTS-ranked results (if MCP has integration tests; otherwise, manual verification)

**Edge cases:**
- `test__list_bookmarks__relevance_with_filter_id` — Relevance sort works correctly when combined with a content filter
- `test__list_bookmarks__sort_by_from_filter_overridden_by_relevance` — When a filter specifies `sort_by=title` but the user provides a query, the default switches to relevance (but explicit `sort_by=title` in query params still wins)

---

## Notes for the Agent

### Key Files to Modify
- `backend/src/db/migrations/versions/` — new migration file
- `backend/src/models/bookmark.py`, `note.py`, `prompt.py` — add `search_vector` column
- `backend/src/services/base_entity_service.py` — core search refactor
- `backend/src/services/bookmark_service.py`, `note_service.py`, `prompt_service.py` — entity-specific FTS
- `backend/src/services/content_service.py` — unified search FTS
- `backend/src/schemas/bookmark.py`, `note.py`, `prompt.py`, `content.py` — add `search_headline`
- `backend/src/api/routers/bookmarks.py`, `notes.py`, `prompts.py`, `content.py` — add `"relevance"` sort
- `backend/src/api/helpers.py` — update `resolve_filter_and_sorting()`
- `backend/tests/services/` and `backend/tests/api/` — new and updated tests

### Documentation to Read Before Implementing
- PostgreSQL FTS docs: https://www.postgresql.org/docs/current/textsearch.html
- `websearch_to_tsquery`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-PARSING-QUERIES
- `ts_rank`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-RANKING
- `ts_headline`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-HEADLINE
- SQLAlchemy `Computed` columns: https://docs.sqlalchemy.org/en/20/core/defaults.html#computed-default-columns-server-generated
- SQLAlchemy TSVector: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#full-text-search

### Important Implementation Details
- Use `websearch_to_tsquery` (not `plainto_tsquery` or `to_tsquery`) — it handles Google-like syntax safely without injection risks
- The `'english'` text search configuration provides stemming. This is intentional for v1.
- Generated columns are automatically maintained by PostgreSQL — no application-level recomputation needed
- `ts_rank` output is a float — it's comparable across entities using the same tsvector config and weight scheme
- The ILIKE fallback is a **second query** that only runs when the FTS count is 0 — not an always-on dual search
- Existing tests that search for exact substrings may need updating if the FTS path doesn't match them (e.g., partial word matches). These tests should use the fallback behavior or be updated to use FTS-friendly queries.
