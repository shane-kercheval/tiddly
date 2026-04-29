# Tip candidates — search (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

Sparse category — most search tips are either auto-behaviors (stemming, substring matching, field weighting) or already covered by the seed `search-quoted-phrase` tip. Net unique: 2 (both are search-operator tips that could fold into the seed wording at consolidation).

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Press `/` to jump straight into search | dup | **Canonical home `shortcuts`** (the keystroke); cross-tracked from `bookmarks:S2`. |
| 2 | `Cmd+Shift+P` for unified search across everything | dup | **Canonical home `shortcuts`**; cross-tracked from `bookmarks:12`. |
| 3 | Wrap a phrase in quotes for exact-match search | dup | Already in seed corpus as `search-quoted-phrase` (priority 40). |
| 4 | Exclude noise with `-term` | 25 | **Canonical home** for `docs-sweep:3`. Candidate to fold into seed `search-quoted-phrase` wording at consolidation. |
| 5 | Use `OR` to widen across synonyms | 25 | Candidate to fold into seed `search-quoted-phrase` wording at consolidation (alongside #4). |
| 6 | Field-weighted search (title > description > content > URL) | drop | Internal mechanism; user doesn't proactively act on field weighting. |
| 7 | Stemming finds related word forms automatically | drop | Auto-behavior. The "to turn off, wrap in quotes" angle is already covered by seed `search-quoted-phrase`. |
| 8 | Toggle Active + Archived to widen recall | drop | Obvious from the chip toggles when on the search page. |
| 9 | Code symbols, partial words, punctuation still match | drop | Auto-behavior; user just types and it works. |
| 10 | Combine search with tag filters using `all`/`any` match | drop | Toggle visible in UI; not hidden. |
| 11 | Filter result list to a single content type with chips | drop | Card-action / chip toggle visible in UI. |
| 12 | Press `s` to focus page search bar | dup | **Canonical home `shortcuts`**; cross-tracked from `bookmarks:S2`. |
| 13 | `Cmd+F` for in-document find inside notes/prompts | dup | `editor:8` (priority 20). |
| S1 | Sort search results by date instead of relevance | drop | UI affordance visible in sort dropdown. |
| S2 | Single-word common queries return zero | drop | Limitation framing. |
| S3 | Operators inert inside quoted phrases | drop | Niche. |
| S4 | Two-tier FTS + substring | drop | Internal plumbing. |
| S5 | Filter views inherit search | drop | Auto-behavior. |

## Final keepers (preserved details from the agent file)

### #4 — Exclude noise with `-term` — priority 25 — canonical home for `docs-sweep:3`

Prefix any term with `-` to drop matches that contain it. `python -django` returns Python content but skips Django-related items. Combine with quotes: `python -"web framework"`.

- Reference: `frontend/src/pages/docs/DocsSearch.tsx:115`
- Tags: feature | power-user

### #5 — Use `OR` to widen a search across synonyms — priority 25

`python OR ruby` returns items mentioning either term. Useful when you don't remember which language/library you wrote about, or to gather results across a topic family in one query.

- Reference: `frontend/src/pages/docs/DocsSearch.tsx:119`
- Tags: feature | power-user

## Consolidation suggestion

The three search-operator tips together (#3 quoted-phrase already in seed, #4 `-term` exclusion, #5 `OR` widening) are tightly related. Same pattern as the editor merges (`note-slash-commands`, `shortcut-select-next-occurrence` got extensions), the seed `search-quoted-phrase` tip's wording could be extended at consolidation to cover all three:

> Search supports operators: wrap a phrase in quotes (`"machine learning"`) for exact match, prefix with `-` to exclude (`python -django`), and use `OR` to widen across synonyms (`python OR ruby`). They combine: `"web framework" -django OR rails`.

This collapses #4 and #5 into the seed tip and reduces three separate "search operator" entries to one. Final call at consolidation; for now keeping #4 and #5 listed separately so the alternative (three distinct tips) is also on the table.

## Cross-category tracking

- `search:1`, `search:2`, `search:12` → `shortcuts` canonical.
- `search:3` → seed `search-quoted-phrase` canonical (with proposed extension).
- `search:13` → `editor:8` canonical.
- `search:4`, `search:5` → fold into seed `search-quoted-phrase` at consolidation, OR keep separate. Decision deferred.
