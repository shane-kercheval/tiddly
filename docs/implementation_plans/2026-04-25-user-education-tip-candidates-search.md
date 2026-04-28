# Tip candidates — search

## Strong candidates (strongest first)

### Press `/` to jump straight into search
- Description: From anywhere in the app (when not typing in a field), tap `/` to focus the search bar. Pressing `/` on a content list opens the page's own search input; pressing it from anywhere else opens the command palette directly into its search sub-view.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/hooks/useKeyboardShortcuts.ts:114-119; /Users/shanekercheval/repos/bookmarks/frontend/src/components/CommandPalette.tsx:6-9
- Tags: feature | new-user

### Use `Cmd+Shift+P` to search across everything from anywhere
- Description: The command palette (`Cmd+Shift+P`) runs a unified search across bookmarks, notes, and prompts without leaving the page you're on. Works even while you're typing in another field. Useful when you're deep in a note and want to grab a snippet from a bookmark.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/hooks/useKeyboardShortcuts.ts:81-86; /Users/shanekercheval/repos/bookmarks/frontend/src/components/CommandPalette.tsx:1-10
- Tags: workflow | power-user

### Wrap a phrase in quotes for exact-match search
- Description: Without quotes, words become AND clauses and stemming may match variants like `learn` for `learning`. Wrap the phrase — e.g. `"machine learning"` — to require the exact sequence. (Note: this tip already exists at `frontend/src/data/tips/tips.ts:59` — flag for consolidator.)
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/api/routers/content.py:65-67; /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:108-114
- Tags: feature | all

### Exclude noise with `-term`
- Description: Prefix any term with `-` to drop matches that contain it. `python -django` returns Python content but skips Django-related items. Combine with quotes: `python -"web framework"`.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:115-118; /Users/shanekercheval/repos/bookmarks/backend/src/api/routers/content.py:65-67
- Tags: feature | power-user

### Use `OR` to widen a search across synonyms
- Description: `python OR ruby` returns items mentioning either term. Useful when you don't remember which language/library you wrote about, or to gather results across a topic family in one query.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:119-123
- Tags: feature | power-user

### Search title, description, content, and (for bookmarks) URL — all weighted by field
- Description: A query matches across all four fields. Title hits rank highest, then description, then content, then URL. So searching for a domain like `github.com` surfaces bookmarks pointing there even if their title doesn't contain it.
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:22-32; /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:60-90
- Tags: feature | new-user

### Stemming finds related word forms automatically
- Description: A search for `running` matches `run`, `runner`, `runs`. Useful when you don't recall the exact form you wrote. To turn it off, wrap the term in quotes for an exact-form match.
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:271; /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:40-43
- Tags: feature | new-user

### Toggle "Active" + "Archived" to search across what you've put away
- Description: In the command palette search and All Content views, click both the Active and Archived chips to widen the search to archived items. Archived results are penalized in ranking so active items still win on ties.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/ui/ViewFilterChips.tsx:1-49; /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:459-465
- Tags: workflow | all

### Code symbols, partial words, and punctuation still match
- Description: Tiddly runs a substring match alongside full-text search, so `useEff` finds `useEffect`, `auth0` finds `Auth0`, and `2025-04` finds dates inside content. You don't need to use special syntax — just type the fragment.
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:561-610; /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:44-48
- Tags: feature | power-user

### Combine search with tag filters using `Match: all` vs `Match: any`
- Description: Pair a search query with one or more tag chips. Switch the tag-match mode to AND (`all`) to narrow, or OR (`any`) to widen. Both apply on top of the search query — results must satisfy the search and the tag rule.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:130-145; /Users/shanekercheval/repos/bookmarks/backend/src/api/routers/content.py:28-31
- Tags: workflow | all

### Filter the result list to a single content type with the type chips
- Description: When searching across All Content (or the command palette), the bookmark / note / prompt chips narrow which types appear. Useful when you remember "I wrote a note about this" but don't want bookmarks polluting the list.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CommandPalette.tsx:208-211; /Users/shanekercheval/repos/bookmarks/frontend/src/pages/AllContent.tsx:167-178
- Tags: workflow | all

### Press `s` to focus the page search bar without scrolling
- Description: When you're already on a content list, `s` jumps focus straight to that page's search input — no need to grab the mouse, no need to leave the view via the command palette.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/hooks/useKeyboardShortcuts.ts:121-126
- Tags: feature | power-user

### `Cmd+F` opens an in-document find inside notes and prompts
- Description: The note/prompt editor includes the CodeMirror search panel. Hit `Cmd+F` to find within the document you're editing — handy for long notes where the global search would surface other items.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CodeMirrorEditor.tsx:19
- Tags: feature | power-user

## Speculative

### Sort search results by date instead of relevance
- Description: When searching, the sort defaults to relevance. Switch to "Recently created/updated" if you want the freshest match rather than the strongest match — useful for "what was that thing I saved last week".
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/api/routers/content.py:32-43; /Users/shanekercheval/repos/bookmarks/frontend/src/components/CommandPalette.tsx:93-96
- Tags: workflow | power-user
- Hesitation: borderline UI affordance — visible in the sort dropdown — but the default-to-relevance behavior is non-obvious enough to mention.

### Single-word common queries can return zero results
- Description: Stop-word-only queries (e.g. `the`, `and or`) yield no matches by design — they would otherwise match almost everything. Add a meaningful term alongside.
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:252-261
- Tags: feature | power-user
- Hesitation: edges into limitation territory; only useful as a "huh, why no results?" explainer.

### Operators inside quoted phrases are inert
- Description: Inside a quoted phrase, `OR`, `-`, and other operators are treated as literal characters. `"python OR ruby"` matches the literal string, not "python or ruby".
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:600-603
- Tags: feature | power-user
- Hesitation: niche — matters only for users mixing quotes with operators.

### Search is two-tier: FTS for ranking, substring as a safety net
- Description: Tiddly runs a Postgres full-text query (stemmed, ranked) and a substring match in parallel and unions them. So you get smart ranking on full words and a fallback for code symbols, partial words, and punctuation that stemming would otherwise miss.
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/services/content_service.py:255-263; /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:33-53
- Tags: feature | power-user
- Hesitation: leans toward internal plumbing; restating it as a tip may feel pedagogical rather than actionable.

### Filter views inherit search — type within a saved filter to narrow it further
- Description: When viewing a saved filter (e.g. "Reading List"), the page's search bar applies on top of the filter expression. Use it to find a specific item inside an already-narrow view without resetting your filter.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/AllContent.tsx:249-264; /Users/shanekercheval/repos/bookmarks/backend/src/api/routers/content.py:75-79
- Tags: workflow | power-user
- Hesitation: overlaps with the saved-filters category — flag for consolidator to decide which category owns it.
