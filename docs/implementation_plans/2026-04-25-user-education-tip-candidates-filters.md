# Tip candidates — filters (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Save a tag combo as a reusable sidebar filter | 15 | Foundational discovery — many users won't realize the `+ Filter` affordance exists. |
| 2 | Combine AND + OR in one filter expression | 15 | **Canonical home** for `docs-sweep:6`. Pull this version at consolidation. |
| 3 | Filters span bookmarks, notes, and prompts together | drop | Obvious from the Content Types checkboxes in the filter modal. |
| 4 | New items pre-fill tags from current filter | drop | Auto-behavior; same rationale as `bookmarks:6` dropped. |
| 5 | Pin a default sort per filter | 25 | Real proactive config choice. |
| 6 | Group related filters into Collections | 20 | Real organization feature. |
| 7 | Drag to reorder sidebar (built-ins included) | 30 | **dup** with `docs-sweep:33`. Canonical home could be `filters` or `account` — pick at consolidation. |
| 8 | Use OR groups to merge synonym tags without renaming | 25 | Clever workflow for tag-naming inconsistency (`js` vs `javascript`). |
| 9 | Single-type filters (Bookmarks-only, etc.) | drop | Trivial config option (same as `docs-sweep:7` dropped). |
| 10 | Default filters ship with new accounts | drop | Auto-behavior. |
| 11 | Tag autocomplete shows usage counts | drop | Auto-display; user doesn't act on it. |
| 12 | Tags used by a filter are protected from deletion | drop | Auto / defensive UX. |
| 13 | Deleting a Collection keeps its filters | drop | Reassurance, not proactive. |
| S1 | Per-column sort overrides don't change saved default | drop | Documenting absence-of-behavior. |
| S2 | Empty AND groups dropped on save | drop | Internal cleanup. |
| S3 | Filter content-type acts as upper bound | drop | Verging on developer-mental-model. |
| S4 | Filters scoped to active content | drop | Limitation framing. |

## Final keepers (preserved details from the agent file)

### #1 — Save a tag combo as a reusable sidebar filter — priority 15

Click `+ Filter` at the bottom of the sidebar to turn any tag combination into a saved view. Saved filters live in the sidebar for one-click access — no need to re-pick tags every time you want the same slice.

- Reference: `frontend/src/components/sidebar/Sidebar.tsx:594`
- Tags: feature | new-user

### #2 — Combine AND + OR in one filter expression — priority 15 — canonical home for `docs-sweep:6`

Tags within a group are ANDed; groups are ORed. So `(python AND tutorial) OR (javascript AND guide)` becomes two AND-groups joined by OR — useful for "either of two specific topics" without making two separate filters.

- Reference: `frontend/src/components/FilterExpressionBuilder.tsx:223`
- Tags: feature | power-user

### #6 — Group related filters into Collections — priority 20

Click `+ Collection` to make a sidebar group, then drag filters into it. Use one Collection per project or context (Work, Personal, Research) to keep the sidebar tidy when you have a lot of saved filters.

- Reference: `frontend/src/components/sidebar/Sidebar.tsx:602`
- Tags: feature | new-user

### #5 — Pin a default sort per filter — priority 25

Each saved filter remembers its own sort field and direction. Set `Reading List` to sort by `created_at` ascending (oldest first), and `Inbox` to `last_used_at` descending — they each open in their own order without you toggling each time.

- Reference: `frontend/src/components/FilterModal.tsx:222`
- Tags: feature | power-user

### #8 — Use OR groups to merge synonym tags without renaming — priority 25

If you have both `js` and `javascript` (or `ml` and `machine-learning`), make a filter with two single-tag OR groups: `(js) OR (javascript)`. You get one unified view without bulk-renaming or losing either tag's history.

- Reference: `frontend/src/components/FilterExpressionBuilder.tsx:187`
- Tags: workflow | power-user

### #7 — Drag to reorder filters, collections, and built-in views — priority 30 — dup of `docs-sweep:33`

The entire sidebar is draggable — including All, Archived, Trash, and the Command Palette entry. Pin the views you use most to the top, drop filters into and out of Collections, and the order is saved per-account.

- Reference: `frontend/src/components/sidebar/Sidebar.tsx:587`
- Tags: feature | power-user

## Cross-category tracking

- `filters:2` ↔ `docs-sweep:6` — AND/OR expressions. Canonical home `filters`; `docs-sweep` defers.
- `filters:7` ↔ `docs-sweep:33`, possibly `account` — sidebar drag. Canonical home tbd.
