# Tip candidates — filters

## Strong candidates (strongest first)

### Save a tag combo as a reusable sidebar filter
- Description: Click `+ Filter` at the bottom of the sidebar to turn any tag combination into a saved view. Saved filters live in the sidebar for one-click access — no need to re-pick tags every time you want the same slice.
- Reference: frontend/src/components/sidebar/Sidebar.tsx:594
- Tags: feature | new-user

### Combine AND + OR in one filter expression
- Description: Tags within a group are ANDed; groups are ORed. So `(python AND tutorial) OR (javascript AND guide)` becomes two AND-groups joined by OR — useful for "either of two specific topics" without making two separate filters.
- Reference: frontend/src/components/FilterExpressionBuilder.tsx:223
- Tags: feature | power-user

### Filters span bookmarks, notes, and prompts together
- Description: A filter can include any combination of bookmarks, notes, and prompts via the Content Types checkboxes. Tag a meeting note `q2-launch`, the launch deck bookmark `q2-launch`, and the recap prompt `q2-launch`, then a single saved filter shows all three side-by-side.
- Reference: frontend/src/components/FilterModal.tsx:194
- Tags: workflow | new-user

### New items pre-fill tags from the current filter
- Description: Open a saved filter, then click +Bookmark / +Note / +Prompt. The new item form pre-fills the tags from the filter's first AND group, so anything you create from inside `work + reading-list` lands there automatically.
- Reference: frontend/src/components/sidebar/Sidebar.tsx:148
- Tags: workflow | power-user

### Pin a default sort per filter
- Description: Each saved filter remembers its own sort field and direction. Set `Reading List` to sort by `created_at` ascending (oldest first), and `Inbox` to `last_used_at` descending — they each open in their own order without you toggling each time.
- Reference: frontend/src/components/FilterModal.tsx:222
- Tags: feature | power-user

### Group related filters into Collections
- Description: Click `+ Collection` to make a sidebar group, then drag filters into it. Use one Collection per project or context (Work, Personal, Research) to keep the sidebar tidy when you have a lot of saved filters.
- Reference: frontend/src/components/sidebar/Sidebar.tsx:602
- Tags: feature | new-user

### Drag to reorder filters, collections, and built-in views
- Description: The entire sidebar is draggable — including All, Archived, Trash, and the Command Palette entry. Pin the views you use most to the top, drop filters into and out of Collections, and the order is saved per-account.
- Reference: frontend/src/components/sidebar/Sidebar.tsx:587
- Tags: feature | power-user

### Use OR groups to merge synonym tags without renaming
- Description: If you have both `js` and `javascript` (or `ml` and `machine-learning`), make a filter with two single-tag OR groups: `(js) OR (javascript)`. You get one unified view without bulk-renaming or losing either tag's history.
- Reference: frontend/src/components/FilterExpressionBuilder.tsx:187
- Tags: workflow | power-user

### Single-type filters: Bookmarks-only, Notes-only, Prompts-only
- Description: Uncheck two of the three Content Types in the filter modal to scope a filter to one type. Pair with a tag like `inbox` to make a "Notes inbox" or "Bookmarks to read" without mixing in other content.
- Reference: frontend/src/components/FilterModal.tsx:170
- Tags: workflow | new-user

### Default filters ship with new accounts
- Description: New accounts come with `All Bookmarks`, `All Notes`, and `All Prompts` — each scoped to one content type. Useful as starting points; rename, edit, or delete them like any other saved filter.
- Reference: backend/src/services/content_filter_service.py:100
- Tags: feature | new-user

### Tag autocomplete shows usage counts
- Description: When adding tags to a filter group, the suggestion dropdown shows how many items each tag is on. Lets you spot popular tags worth saving a filter for, and avoids picking a near-empty tag by mistake.
- Reference: frontend/src/components/FilterExpressionBuilder.tsx:144
- Tags: feature | power-user

### Tags used by a filter are protected from deletion
- Description: Trying to delete a tag from Settings > Tags will block if any saved filter still references it — and tells you which filters. Edit those filters first (or accept the cleanup), then re-delete.
- Reference: frontend/src/pages/docs/DocsTagsFilters.tsx:37
- Tags: feature | power-user

### Deleting a Collection keeps its filters
- Description: Removing a Collection moves its filters back to the sidebar root — it does not delete them. Safe to reorganize as your project list changes.
- Reference: frontend/src/pages/docs/DocsTagsFilters.tsx:93
- Tags: feature | new-user

## Speculative

### Per-column sort overrides don't change the filter's saved default
- Description: Clicking a column header to re-sort within a filter is a one-off override; the filter's stored default sort is untouched. To make the change permanent, edit the filter and update Default Sort.
- Reference: frontend/src/pages/AllContent.tsx:192
- Tags: feature | power-user
- Hesitation: Documenting an absence-of-behavior; may read as a bug-report rather than a tip.

### Empty AND groups are dropped on save
- Description: When you save a filter, any group with no tags is silently removed — so you can leave a half-built OR group in place, save, and keep editing without it polluting the expression.
- Reference: frontend/src/components/FilterModal.tsx:99
- Tags: feature | power-user
- Hesitation: Internal cleanup detail; users probably don't need to know unless they hit it.

### Filter content-type acts as an upper bound, not equality
- Description: A filter with `Bookmarks + Notes` selected can be narrowed further at view-time via the content-type filter chips — you'll never see prompts, but you can hide notes ad-hoc without editing the filter.
- Reference: backend/src/api/routers/content.py:75
- Tags: feature | power-user
- Hesitation: Subtle; depends on UI exposing per-view content-type chips inside a filter view, which may or may not be present everywhere.

### Filter views are scoped to active content (use Archived/Trash separately)
- Description: Saved filters apply within the Active view — Archived and Trash are separate top-level sidebar entries, not filter scopes. To find archived items by tag, switch to Archived first, then use the tag filter chips there.
- Reference: frontend/src/pages/docs/DocsTagsFilters.tsx:103
- Tags: workflow | new-user
- Hesitation: Edges into limitation territory rather than discoverable feature.
