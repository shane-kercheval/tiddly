# Tip candidates — tags

## Strong candidates (strongest first)

### Click any tag on a card to filter by it
- Description: Tags rendered on bookmark, note, and prompt cards are clickable — clicking adds the tag to the current view's tag filter (with autocomplete suggestions still available for stacking more). Faster than opening the filter input.
- Reference: frontend/src/components/Tag.tsx:42, frontend/src/components/BookmarkCard.tsx:36, frontend/src/components/ContentCard/ContentCardTags.tsx:28
- Tags: feature | new-user

### Tags are shared across bookmarks, notes, and prompts
- Description: There is one global tag namespace. A tag named `python` on a bookmark is the same tag as `python` on a note or prompt — autocomplete and filters reflect the union.
- Reference: frontend/src/pages/docs/DocsTagsFilters.tsx:18, frontend/src/stores/tagsStore.ts:36
- Tags: feature | new-user

### Renaming a tag rewrites it everywhere
- Description: From Settings > Tags, renaming a tag updates it across every bookmark, note, prompt, saved filter, and active filter view in one operation. Use this to consolidate `js` and `javascript` instead of editing items one by one.
- Reference: frontend/src/pages/settings/SettingsTags.tsx:269, frontend/src/stores/tagFilterStore.ts:103
- Tags: workflow | power-user

### Toggle tag filters between Match all and Match any
- Description: When two or more tags are filtered, a Match all / Match any selector appears next to the chips. Match all narrows (must have every tag); Match any broadens (has at least one). Per-view — different views remember different modes.
- Reference: frontend/src/components/ui/SelectedTagsDisplay.tsx:54, frontend/src/stores/tagFilterStore.ts:80
- Tags: feature | new-user

### Tag filters are remembered per view
- Description: All Content, Archived, each saved filter, and even the command palette each keep their own tag selection and match mode. Switching between views doesn't clobber the tags you had selected somewhere else.
- Reference: frontend/src/stores/tagFilterStore.ts:13, frontend/src/pages/AllContent.tsx:151
- Tags: feature | power-user

### Comma adds a tag without leaving the input
- Description: When inline-editing tags on a note, bookmark, or prompt, press `,` (or Enter) to commit the current tag and keep the input open for the next one. Backspace on an empty input removes the previous tag.
- Reference: frontend/src/components/InlineEditableTags.tsx:203, frontend/src/components/InlineEditableTags.tsx:229
- Tags: feature | power-user

### Tab-to-complete in the tag filter input
- Description: In the tag filter input, pressing Tab while suggestions are open commits the top suggestion and keeps the input focused so you can immediately add another. Enter on a single-match list also auto-selects.
- Reference: frontend/src/components/TagFilterInput.tsx:91, frontend/src/components/TagFilterInput.tsx:87
- Tags: feature | power-user

### Tags inherit from the saved filter you're viewing
- Description: Creating a new bookmark, note, or prompt while viewing a saved filter pre-fills the new item's tags from the filter's first AND-group. Saving inside `python AND tutorial` starts you with both tags applied.
- Reference: frontend/src/utils.ts:350, frontend/src/components/Note.tsx:177, frontend/src/components/Prompt.tsx:226
- Tags: workflow | power-user

### Pro: AI suggests tags as you edit
- Description: On Pro, the tag dropdown shows two columns: AI Suggestions on the left (relevant to the current item's content) and Your Tags on the right. Arrow keys walk both columns; Enter adds the highlighted tag.
- Reference: frontend/src/components/InlineEditableTags.tsx:310, frontend/src/components/AddTagButton.tsx:288
- Tags: feature | new-user

### Tag autocomplete shows usage counts
- Description: The number next to each tag suggestion is how many items already use it. Useful for picking the canonical spelling — prefer the one with 47 items over the typo with 1.
- Reference: frontend/src/components/TagFilterInput.tsx:148, frontend/src/components/AddTagButton.tsx:361
- Tags: feature | power-user

### Tag format is enforced: lowercase, numbers, hyphens
- Description: Tags are auto-normalized to lowercase and underscores become hyphens (`Machine_Learning` -> `machine-learning`). Anything else is rejected with an inline error. Plan tag names accordingly.
- Reference: frontend/src/utils.ts:281, frontend/src/utils.ts:302
- Tags: feature | new-user

### Settings > Tags surfaces inactive tags for cleanup
- Description: The Tags settings page splits Active Tags from Inactive Tags. Inactive tags appear when their only items are archived or trashed — a quick way to spot orphans and decide whether to delete or restore content.
- Reference: frontend/src/pages/settings/SettingsTags.tsx:444, frontend/src/pages/settings/SettingsTags.tsx:38
- Tags: feature | power-user

### A tag used in a saved filter blocks delete
- Description: Deleting a tag fails if any saved filter references it; the toast lists the blocking filters. Edit those filters first (or rename the tag), then re-try the delete.
- Reference: frontend/src/pages/settings/SettingsTags.tsx:312
- Tags: feature | power-user

### Sort tags by usage in Settings to find favorites
- Description: The Settings > Tags sort dropdown supports Count desc/asc in addition to Name. Sort by Count desc to see your most-used tags first — useful for deciding which tags to promote to saved filters.
- Reference: frontend/src/pages/settings/SettingsTags.tsx:370, frontend/src/utils.ts:320
- Tags: workflow | power-user

## Speculative

### Backspace removes the last tag
- Description: With the inline tag input focused and empty, pressing Backspace removes the last tag on the item. Faster than reaching for the X button.
- Reference: frontend/src/components/InlineEditableTags.tsx:229
- Tags: feature | power-user
- Hesitation: Standard chip-input idiom — many users already expect it.

### Tag filter selections persist across page reloads via URL
- Description: Selected tags and match mode round-trip through query parameters, so a tag-filtered view is shareable and bookmarkable.
- Reference: frontend/src/pages/AllContent.tsx:253, frontend/src/hooks/useContentUrlParams.ts
- Tags: workflow | power-user
- Hesitation: Couldn't fully confirm whether tag state lives in URL params vs. just store; needs verification before publishing.

### Filter by tag from the command palette
- Description: The command palette has its own tag filter — narrow palette results by tag without leaving the keyboard, independent of any open page's filters.
- Reference: frontend/src/components/CommandPalette.tsx:436, frontend/src/components/CommandPalette.tsx:97
- Tags: workflow | power-user
- Hesitation: Overlaps with broader command-palette tips; may belong in a palette category instead.

### Suggested tags exclude what's already on the item
- Description: The autocomplete dropdown automatically hides tags already applied to the current item, so you never see noisy duplicates while typing.
- Reference: frontend/src/components/AddTagButton.tsx:88, frontend/src/hooks/useTagAutocomplete.ts:98
- Tags: feature | new-user
- Hesitation: Borderline "basic UI affordance" — users may not need this called out.
