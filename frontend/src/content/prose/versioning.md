---
route: /docs/features/versioning
title: Docs - Versioning
description: Version history for bookmarks, notes, and prompts — what gets tracked, the history sidebar, restoring versions, source tracking (web, MCP, API, iPhone), and retention by plan.
---

# Versioning

Every change to your bookmarks, notes, and prompts is tracked. You can view the full history of an item, see what changed between versions, and restore to any previous version.

## What Gets Tracked

Two types of actions are recorded:

### Content Versions

Numbered versions (v1, v2, v3...) that track actual content changes:

- **Create** — initial version when an item is created
- **Update** — any edit to title, description, content, URL, tags, or arguments
- **Restore** — restoring to a previous version creates a new version

### Audit Events

Recorded for the audit trail but don't create content versions:

- **Delete / Undelete** — moving to and from trash
- **Archive / Unarchive** — archiving and restoring from archive

## History Sidebar

Open the history sidebar with `{{shortcut:app.toggleHistorySidebar}}` while viewing any item to see its full version history:

- **Version list** — all versions with timestamps and action types
- **Change indicators** — see which fields changed in each version (title, content, tags, etc.)
- **Source tracking** — see where each change came from (web, MCP, API)
- **Inline diff** — select a version to see the before/after content changes

## Restoring a Version

Click the restore button on any content version in the history sidebar. Restoring creates a *new* version — no history is lost. The restored content becomes the current version, and the restore action itself is recorded in the history.

> [!info]
> Audit events (delete, archive) can't be "restored" — they represent lifecycle actions, not content states. Use the undelete or unarchive actions instead.

## Source Tracking

Each history entry records where the change originated:

| Source | Description |
| --- | --- |
| Web | Changes made through the Tiddly web app |
| MCP | Changes made by AI assistants via MCP servers |
| API | Changes made via Personal Access Tokens |
| iPhone | Changes made via the iOS shortcut |

## Retention

Version history retention and the maximum number of versions kept per item depend on your plan — see [Pricing](/pricing) for the limits on each tier.

> [!tip]
> Items in the trash are permanently deleted after 30 days, along with their entire version history.
