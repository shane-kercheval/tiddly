# Tip candidates — tags (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Click any tag on a card to filter by it | 20 | Real proactive workflow — high-discoverability win for new users. |
| 2 | Tags are shared across bookmarks, notes, and prompts | drop | Foundational mental model; obvious from Settings page and docs. Same family as `filters:3` (dropped). |
| 3 | Renaming a tag rewrites it everywhere | 15 | Strong power-user feature — bulk rename / consolidate. Hidden in Settings. |
| 4 | Toggle tag filters between Match all / Match any | drop | Toggle visible in UI when ≥2 tags selected. Same as `search:10` dropped. |
| 5 | Tag filters are remembered per view | drop | Auto-behavior; users don't act on it. |
| 6 | Comma adds a tag without leaving the input | 30 | Real proactive efficiency tip — many users press Enter then click +tag. |
| 7 | Tab-to-complete in tag filter input | drop | Bordering on universal autocomplete convention. |
| 8 | Tags inherit from saved filter you're viewing | drop | Auto-behavior; consistent with `bookmarks:6`, `notes:15`, `filters:4` dropped. |
| 9 | Pro: AI suggests tags as you edit | dup | `ai:1` (priority 30). |
| 10 | Tag autocomplete shows usage counts | drop | Auto-display; same as `filters:11` dropped. |
| 11 | Tag format enforced: lowercase, numbers, hyphens | drop | Validation; auto-normalized as you type. |
| 12 | Settings → Tags surfaces inactive tags for cleanup | drop | Already explained on the Settings page; same as `docs-sweep:29` dropped. |
| 13 | A tag used in a saved filter blocks delete | drop | Auto / defensive; same as `filters:12` dropped. |
| 14 | Sort tags by usage in Settings to find favorites | 30 | Real proactive workflow — promote frequently-used tags to saved filters. |
| S1 | Backspace removes the last tag | drop | Standard chip-input idiom. |
| S2 | Tag filter selections persist via URL | drop | Agent's own verification overhead. |
| S3 | Filter by tag from command palette | drop | Niche; palette-internal. |
| S4 | Suggested tags exclude what's already on the item | drop | Basic UI affordance. |

## Final keepers (preserved details from the agent file)

### #3 — Renaming a tag rewrites it everywhere — priority 15

From Settings → Tags, renaming a tag updates it across every bookmark, note, prompt, saved filter, and active filter view in one operation. Use this to consolidate `js` and `javascript` instead of editing items one by one.

- Reference: `frontend/src/pages/settings/SettingsTags.tsx:269`
- Tags: workflow | power-user

### #1 — Click any tag on a card to filter by it — priority 20

Tags rendered on bookmark, note, and prompt cards are clickable — clicking adds the tag to the current view's tag filter (with autocomplete suggestions still available for stacking more). Faster than opening the filter input.

- Reference: `frontend/src/components/Tag.tsx:42`
- Tags: feature | new-user

### #6 — Comma adds a tag without leaving the input — priority 30

When inline-editing tags on a note, bookmark, or prompt, press `,` (or Enter) to commit the current tag and keep the input open for the next one. Backspace on an empty input removes the previous tag.

- Reference: `frontend/src/components/InlineEditableTags.tsx:203`
- Tags: feature | power-user

### #14 — Sort tags by usage in Settings to find favorites — priority 30

The Settings → Tags sort dropdown supports Count desc/asc in addition to Name. Sort by Count desc to see your most-used tags first — useful for deciding which tags to promote to saved filters.

- Reference: `frontend/src/pages/settings/SettingsTags.tsx:370`
- Tags: workflow | power-user

## Cross-category tracking

- `tags:9` ↔ `ai:1` — AI suggests tags as you edit. `ai:1` is canonical.
