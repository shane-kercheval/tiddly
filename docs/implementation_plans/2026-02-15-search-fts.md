# Phase 1: PostgreSQL Full-Text Search (FTS) Implementation Plan

**Reference:** `docs/implementation_plans/roadmap-search.md` — Phase 1

**Goal:** Replace ILIKE with PostgreSQL FTS for ranked, language-aware keyword search. Zero new infrastructure. Retain ILIKE for bookmark URL substring matching and as a fallback for individual entity search when FTS returns zero results (not for unified search).

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

Create the migration using `make migration message="add search_vector columns triggers and indexes"` — never create migration files manually. This runs `alembic revision --autogenerate`, which will detect the new `search_vector` column from the SQLAlchemy model changes. The agent must then edit the generated migration file to add the trigger functions, trigger creation, backfill statements, and GIN indexes via `op.execute()`, since Alembic autogenerate does not detect these.

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

**Backfill side effect warning:** Check how `updated_at` is managed (database trigger, SQLAlchemy `onupdate`, or application code). If a database-level trigger bumps `updated_at` on every write, the backfill will change `updated_at` for every row to the migration timestamp. If this is the case, either temporarily disable the `updated_at` trigger during backfill, or backfill by setting `search_vector` directly via raw SQL instead of relying on the no-op update.

**GIN index note:** Use standard `CREATE INDEX` (not `CONCURRENTLY`) — at current scale the brief lock is acceptable. Add a code comment noting `CONCURRENTLY` as an option for larger tables.

**SQLAlchemy model updates:** Add the `search_vector` column to each model class (`Bookmark`, `Note`, `Prompt`). Since the column is trigger-maintained (not a generated column), SQLAlchemy just needs to know it exists but should not write to it:

```python
from sqlalchemy.dialects.postgresql import TSVECTOR

search_vector: Mapped[str | None] = mapped_column(TSVECTOR, nullable=True, default=None, deferred=True)
```

Use `deferred=True` so the tsvector isn't loaded on every query (it's only needed for search operations, not general reads). Ensure SQLAlchemy does not include it in INSERT/UPDATE — since the trigger sets it, the column should be excluded from the model's insert/update defaults. Test this by running the existing create/update test suite after adding the column.

**Downgrade:** Drop the indexes, triggers, trigger functions, and columns.

### Testing Strategy

- **Migration test:** Run `make migrate` against the test database, verify the columns, indexes, triggers, and trigger functions exist via raw SQL inspection
- **Trigger test:** Insert a bookmark with known title/content, verify `search_vector` is populated. Update the bookmark's `last_used_at` — verify `search_vector` is unchanged. Update the bookmark's `title` — verify `search_vector` is recomputed.
- **Backfill test:** Verify that after migration, existing rows have populated `search_vector` values
- **Verify existing tests still pass:** Run `make unit_tests` — no application code changed, so all existing tests should pass. If any tests inspect column lists or schema metadata, they may need minor updates.

---

## Milestone 2: Service Layer — FTS Search with `ts_rank`, ILIKE Fallback, and Relevance Sorting

### Goal & Outcome
Replace ILIKE-based text search with FTS in the service layer for individual entity searches (`BookmarkService`, `NoteService`, `PromptService` via `BaseEntityService`). Retain ILIKE on `Bookmark.url`. Implement ILIKE fallback when FTS returns zero results (with empty tsquery guard). Add relevance sorting with proper default resolution. Update routers and `resolve_filter_and_sorting()`.

After this milestone:
- Searching bookmarks/notes/prompts uses `websearch_to_tsquery` + `ts_rank` for ranked results
- Bookmark URL search still uses ILIKE substring matching
- When FTS returns 0 results and the tsquery is non-empty, a fallback ILIKE search runs automatically
- When the tsquery is empty (all stop words), zero results are returned — no fallback
- Results default to relevance sorting when a search query is present
- All routers accept `sort_by: "relevance"` and default to `None`

### Implementation Outline

**1. Refactor `_build_text_search_filter()` signature and purpose**

The current abstract method returns ILIKE conditions from a `%pattern%` string. Refactor it to accept the raw query string and return FTS conditions instead.

Rename the method to `_build_fts_filter()` (or similar) to make the semantic change clear. Suggested helpers in `base_entity_service.py` or a new `search_utils.py`:

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

**2. Update `BaseEntityService.search()` to use FTS with guarded fallback**

```python
# When query is provided:
tsquery = func.websearch_to_tsquery('english', query)

# Check if tsquery is empty (all stop words / no searchable terms)
tsquery_text = await db.scalar(select(func.cast(tsquery, String)))
if not tsquery_text or tsquery_text.strip() == '':
    # Empty tsquery — return zero results, no fallback
    return [], 0

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

The empty tsquery check prevents the stop-word fallback problem: searching "the" produces an empty tsquery, returns zero results immediately, and never triggers the ILIKE fallback (which would match nearly everything).

**3. Entity-specific changes**

Each service needs:
- A `_build_ilike_fallback_filter(query)` method that returns the old ILIKE conditions (essentially the current `_build_text_search_filter` logic, preserved for fallback)
- Remove the old `_build_text_search_filter` method

**BookmarkService** specifically: always include `Bookmark.url.ilike(f'%{escape_ilike(query)}%')` as an additional OR condition alongside the FTS filter:

```python
where(or_(
    Bookmark.search_vector.op('@@')(tsquery),
    Bookmark.url.ilike(url_pattern),
))
```

`ts_rank` returns 0 for URL-only matches — they sort after FTS matches under relevance ordering.

**4. `sort_by: "relevance"` support and default resolution**

**Deliberate behavior change:** When a search query is present and `sort_by` is not explicitly specified, results now default to relevance sorting instead of `created_at`. This is the expected UX — users want the most relevant results first when searching. API consumers relying on the previous `created_at` default during search will see results in a different order.

Update `resolve_filter_and_sorting()` in `api/helpers.py` to accept an optional `query` parameter. The sort priority chain becomes:

1. **Explicit user `sort_by` param** → wins always
2. **Query present + no explicit sort** → `"relevance"`
3. **Filter's `default_sort_by`** → applies when no query and no explicit sort
4. **Global default** → `"created_at"`

```python
def resolve_filter_and_sorting(
    ...,
    query: str | None = None,  # NEW
) -> ...:
    # ... existing filter resolution ...

    if sort_by:
        effective_sort_by = sort_by  # explicit — wins always
    elif query:
        effective_sort_by = "relevance"  # searching — relevance default
    elif resolved_filter and resolved_filter.default_sort_by:
        effective_sort_by = resolved_filter.default_sort_by
    else:
        effective_sort_by = "created_at"
```

Update all routers (`bookmarks.py`, `notes.py`, `prompts.py`, `content.py`) to:
- Add `"relevance"` to the `sort_by` Literal type
- Default `sort_by` to `None` instead of `"created_at"`
- Pass `query` to `resolve_filter_and_sorting()`

When `sort_by="relevance"` but no query is present, fall back to `created_at` silently.

### Testing Strategy

**FTS core behavior:**
- `test__search__fts_matches_stemmed_words` — Search "running" matches a bookmark with "runners" in title
- `test__search__fts_title_matches_rank_higher` — A title match (weight A) ranks above a content-only match (weight C) for the same query
- `test__search__fts_websearch_syntax` — Test `websearch_to_tsquery` features: quoted phrases (`"exact phrase"`), OR operator, negation (`-excluded`)
- `test__search__fts_empty_query_returns_all` — Empty/None query still returns all results (no filter applied)

**Stop-word / empty tsquery guard:**
- `test__search__stop_words_only_returns_empty` — Searching "the and or" returns 0 results (empty tsquery, no fallback triggered)
- `test__search__stop_word_mixed_with_real_term` — Searching "the python" matches documents with "python" (tsquery drops "the", keeps "python")

**URL ILIKE for bookmarks:**
- `test__search__bookmark_url_ilike_match` — Searching "github.com/anthropics" matches a bookmark with that URL even if it's not in title/content
- `test__search__bookmark_url_match_ranks_below_fts` — URL-only match appears after FTS matches when sorted by relevance

**ILIKE fallback:**
- `test__search__ilike_fallback_on_zero_fts_results` — Search for "useAuth" (code symbol that FTS tokenizes badly) returns results via ILIKE fallback
- `test__search__ilike_fallback_partial_word` — Search for "auth" matches "authentication" via ILIKE fallback when FTS finds nothing
- `test__search__no_fallback_when_fts_has_results` — When FTS returns results, ILIKE fallback does NOT run

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
- Same pattern for notes, prompts

---

## Milestone 3: `ts_headline` for Search Snippets

### Goal & Outcome
Add highlighted snippets to search results showing *why* each result matched, using PostgreSQL's `ts_headline` function. Also verify MCP integration.

After this milestone:
- Search results include a `search_headline` field with matching terms highlighted in `<mark>` tags
- Headlines are generated from all searchable fields (title, description, content), not just content
- MCP `search_items` tool benefits from FTS transparently

### Implementation Outline

**1. Add `search_headline` to response schemas**

Add an optional `search_headline: str | None` field to:
- `BookmarkListItem` (in `schemas/bookmark.py`)
- `NoteListItem` (in `schemas/note.py`)
- `PromptListItem` (in `schemas/prompt.py`)
- `ContentListItem` (in `schemas/content.py`)

Default to `None` — only populated when a search query is active.

**2. Compute `ts_headline` from all searchable fields**

Run `ts_headline` on a concatenation of all searchable fields so the snippet reflects whichever field actually matched:

```python
headline_source = func.concat_ws(
    ' ... ',
    self.model.title,
    self.model.description,
    func.left(self.model.content, 5000),  # Cap to limit ts_headline cost
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

If `ts_headline` performance becomes an issue on large result sets (it processes the full text for each row), a future optimization is to compute it in a subquery after pagination. The 5,000-char cap makes this unlikely at current scale.

**3. Attach headline to entities**

Similar to how `content_length` and `content_preview` are attached to entities after query execution, attach the headline:

```python
entity.search_headline = row.search_headline
```

**4. ILIKE fallback headlines**

When the ILIKE fallback is used (FTS returned 0 results), set `search_headline = None`. There's no tsquery to highlight against. The `content_preview` field already provides context.

**5. Verify MCP integration**

The Content MCP server (`backend/src/mcp_server/server.py`) has a `search_items` tool that calls the API. Since FTS is a backend change, the MCP server benefits automatically. Verify by reading the MCP `search_items` implementation to confirm it passes the query parameter through. No MCP-side changes expected.

### Testing Strategy

- `test__search__headline_contains_matching_terms` — Search for "python" returns a headline containing `<mark>python</mark>` (or the stemmed variant)
- `test__search__headline_from_best_matching_field` — A title-only match produces a headline highlighting the title text, not a random content snippet
- `test__search__headline_is_none_when_no_query` — When no search query, `search_headline` is `None`
- `test__search__headline_is_none_for_ilike_fallback` — When ILIKE fallback triggers, `search_headline` is `None`
- `test__search__headline_with_null_content` — Entity with NULL content doesn't crash headline generation (coalesce handles it)
- `test__list_bookmarks__search_headline_in_response` — API response includes `search_headline` field when `q` is provided
- `test__list_bookmarks__search_headline_null_without_query` — `search_headline` is null when no query
- Same pattern for notes, prompts, and content endpoints

---

## Milestone 4: Unified Content Search — FTS for `search_all_content()`

### Goal & Outcome
Update the unified content search in `content_service.py` to use FTS with `ts_rank` for the UNION ALL query across bookmarks, notes, and prompts. No ILIKE fallback for unified search — the individual entity endpoints have it, and the UNION complexity isn't worth it.

After this milestone:
- `GET /content/` endpoint uses FTS for text search across all content types
- Results are ranked by `ts_rank` (comparable across entity types since all use the same `'english'` config and weight scheme)
- ILIKE on `Bookmark.url` is preserved as an OR condition in the bookmark subquery
- `ts_headline` snippets included in unified results
- `sort_by: "relevance"` supported with proper default resolution

### Implementation Outline

**1. Update `_apply_entity_filters()` in `content_service.py`**

This function currently builds ILIKE filters from `text_search_fields`. Replace the ILIKE text search with FTS:
- Accept the `search_vector` column and optional `url_ilike_column` parameters
- Build FTS filter: `search_vector.op('@@')(tsquery)`
- For bookmarks, also include `Bookmark.url.ilike(pattern)` as an OR condition
- No ILIKE fallback — keep the function as a flat filter list

```python
def _apply_entity_filters(
    filters: list,
    model: type,
    junction_table: Table,
    search_vector_column,  # The model's search_vector column
    url_ilike_column=None,  # Optional, for bookmark URL matching
    ...
)
```

**2. Add `ts_rank` to UNION subqueries**

Each entity subquery needs `ts_rank(search_vector, tsquery)` as a computed column for cross-type relevance sorting:

```python
if query:
    tsquery = func.websearch_to_tsquery('english', query)
    rank_col = func.ts_rank(Bookmark.search_vector, tsquery).label("search_rank")
else:
    rank_col = literal(0).label("search_rank")
```

**3. Add `ts_headline` to UNION subqueries**

Add `ts_headline` using the same `concat_ws` pattern from Milestone 3, with entity-specific field concatenation.

**4. Update sorting and router**

Add `"relevance"` to the `sort_by` Literal in `search_all_content()` and the `/content/` router. Pass `query` to `resolve_filter_and_sorting()`. When relevance sort is active, order by `search_rank DESC` with tiebreakers.

**5. Empty tsquery handling**

Apply the same empty tsquery guard as Milestone 2: if `websearch_to_tsquery` produces an empty result (all stop words), return zero results immediately.

### Testing Strategy

**Core FTS behavior:**
- `test__search_all_content__fts_matches_across_types` — A query matching a bookmark title and a note content returns both, ranked by relevance
- `test__search_all_content__fts_title_match_ranks_higher` — A bookmark with the query in its title ranks above a note with the query only in content

**Bookmark URL matching:**
- `test__search_all_content__url_match_included` — Searching "github.com" returns bookmarks with that URL

**No ILIKE fallback in unified search:**
- `test__search_all_content__no_ilike_fallback` — Searching for a code symbol like "useState" returns zero results in unified search (individual entity endpoints have fallback; unified does not)

**Relevance sorting:**
- `test__search_all_content__default_sort_relevance_with_query` — When query present and sort_by not specified, results sorted by relevance
- `test__search_all_content__explicit_sort_overrides_relevance` — `sort_by="title"` with a query sorts by title

**Snippets:**
- `test__search_all_content__headline_included` — Search results include `search_headline` with marked-up terms

**Cross-type score comparability:**
- `test__search_all_content__scores_comparable_across_types` — A strong title match on a note ranks above a weak content match on a bookmark

---

## Notes for the Agent

### Key Files to Modify
- `backend/src/db/migrations/versions/` — new migration file (columns, triggers, trigger functions, indexes, backfill)
- `backend/src/models/bookmark.py`, `note.py`, `prompt.py` — add `search_vector` column
- `backend/src/services/base_entity_service.py` — core search refactor
- `backend/src/services/bookmark_service.py`, `note_service.py`, `prompt_service.py` — entity-specific FTS + ILIKE fallback
- `backend/src/services/content_service.py` — unified search FTS (no fallback)
- `backend/src/schemas/bookmark.py`, `note.py`, `prompt.py`, `content.py` — add `search_headline`
- `backend/src/api/routers/bookmarks.py`, `notes.py`, `prompts.py`, `content.py` — add `"relevance"` sort, default `sort_by` to `None`
- `backend/src/api/helpers.py` — update `resolve_filter_and_sorting()` to accept `query` param
- `backend/tests/services/` and `backend/tests/api/` — new and updated tests

### Documentation to Read Before Implementing
- PostgreSQL FTS docs: https://www.postgresql.org/docs/current/textsearch.html
- `websearch_to_tsquery`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-PARSING-QUERIES
- `ts_rank`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-RANKING
- `ts_headline`: https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-HEADLINE
- SQLAlchemy TSVector: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#full-text-search

### Migration Rules
- **Never create migration files manually.** Always use `make migration message="description"` to autogenerate, then edit the generated file to add raw SQL (triggers, backfill, etc.) that autogenerate can't detect.
- Run `make migrate` to apply migrations. Run `make backend-tests` to verify.

### Important Implementation Details
- Use `websearch_to_tsquery` (not `plainto_tsquery` or `to_tsquery`) — it handles Google-like syntax safely without injection risks
- The `'english'` text search configuration provides stemming. This is intentional for v1.
- `search_vector` is trigger-maintained, not a generated column. The trigger only recomputes when content fields change. SQLAlchemy should not write to this column.
- `ts_rank` output is a float — it's comparable across entities using the same tsvector config and weight scheme
- The ILIKE fallback is individual entity search only (not unified search). It's a second query that only runs when FTS count is 0 **and** the tsquery is non-empty.
- Guard against empty tsquery (all stop words) — return zero results, don't fall back to ILIKE
- `ts_headline` runs on a concatenation of all searchable fields (not just content) so the snippet reflects whichever field matched. Cap content at 5,000 chars with `func.left()`.
- Existing tests that search for exact substrings may need updating if the FTS path doesn't match them (e.g., partial word matches). These tests should use the fallback behavior or be updated to use FTS-friendly queries.
