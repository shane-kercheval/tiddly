---
route: /docs/features/tags-filters
title: Docs - Tags & Filters
description: How Tiddly organizes content with global tags, saved filters built from boolean tag expressions, collections, and sidebar organization.
---

# Tags & Filters

Tags let you organize content across all types. Saved filters combine tags into reusable views, and collections group filters in the sidebar.

## Tags

Tags are shared across bookmarks, notes, and prompts — a tag you create on a bookmark is the same tag available on notes and prompts.

- **Global scope** — one tag namespace across all content types
- **Case-insensitive** — "Python" and "python" are the same tag
- **Autocomplete** — start typing to see suggestions with usage counts
- **Inline editing** — add and remove tags directly on any content item

### Managing Tags

Tags can be managed from **Settings > Tags**:

- **Rename** — renames the tag globally across all content and filters
- **Delete** — removes the tag from all content (doesn't delete the content itself)

> [!warning]
> Tags used in saved filters can't be deleted until removed from those filters first. The app will show which filters depend on the tag.

## Saved Filters

Saved filters let you create reusable views based on tag combinations. Filters appear in the sidebar for quick access.

### Filter Expressions

Filters use boolean expressions built from tag groups:

- **AND groups** — tags within a group are combined with AND (e.g. *python* AND *tutorial* matches items with both tags)
- **OR between groups** — groups are combined with OR (e.g. (*python* AND *tutorial*) OR (*javascript* AND *guide*))

> [!tip]
> Use AND within groups for narrowing (must have all tags) and OR between groups for broadening (match any group).

### Filter Options

- **Content type** — restrict to bookmarks, notes, prompts, or any combination
- **Default sort** — set a custom sort order (created date, updated date, title, etc.)
- **Name** — displayed in the sidebar for quick identification

### Default Filters

New accounts come with three default filters: *All Bookmarks*, *All Notes*, and *All Prompts* — each scoped to a single content type.

## Collections

Collections group related filters together in the sidebar. Use them to organize filters by project, topic, or workflow.

- **Drag and drop** — reorder filters and move them between collections
- **Collapsible** — collapse collections to keep the sidebar tidy
- **Delete safely** — deleting a collection moves its filters back to the sidebar root (doesn't delete the filters)

## Sidebar Organization

The sidebar shows your filters and collections alongside built-in views:

- **All** — everything (bookmarks + notes + prompts)
- **Archived** — items you've archived
- **Trash** — soft-deleted items (recoverable for 30 days)
- **Filters** — your saved filters and collections

The entire sidebar order is persisted — drag items to arrange them however you like.
