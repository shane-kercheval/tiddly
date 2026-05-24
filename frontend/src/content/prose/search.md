---
route: /docs/features/search
title: Docs - Search
description: How Tiddly search works — two-tier full-text and substring matching, field relevance weighting, search operators, combining search with tags, and in-content search via API and MCP.
---

# Search

Search across all your bookmarks, notes, and prompts. Tiddly uses a two-tier search system combining full-text search with substring matching for comprehensive results.

## Quick Access

- **Search bar** — press `{{shortcut:app.focusSearch}}` to focus the search bar and start typing
- **Command palette** — press `{{shortcut:app.commandPalette}}` for quick search and navigation across all content

## How Search Works

When you type a query, Tiddly runs two search strategies in parallel and combines the results:

1. **Full-text search** — stemmed matching (e.g. "running" matches "run") with relevance ranking
2. **Substring matching** — exact substring match for partial words, code symbols, and terms that stemming misses

Results are ranked by a combined relevance score weighted by field: title matches rank highest, then description, then content, then URL (bookmarks only).

## What Gets Searched

| Field | Applies To | Relevance Weight |
| --- | --- | --- |
| Title | All | Highest |
| Description | All | High |
| Content | All | Medium |
| URL | Bookmarks only | Lowest |

## Search Operators

Use operators to refine your queries:

| Operator | Example | Effect |
| --- | --- | --- |
| `"quotes"` | `"react hooks"` | Exact phrase match |
| `-term` | `python -django` | Exclude results containing term |
| `OR` | `react OR vue` | Match either term |

## Combining Search with Tags

Search queries can be combined with tag filters for precise results. When both are active, results must match the search query *and* the tag criteria.

- **Tag match: all** — results must have all selected tags (AND)
- **Tag match: any** — results must have at least one selected tag (OR)

Saved filters combine tag expressions with search for reusable views. See [Tags & Filters](/docs/features/tags-filters).

## In-Content Search

Search *within* a single item's fields via the API. This is useful for finding specific text in long documents without loading the full content.

- **Literal matching** — finds exact string occurrences (not stemmed)
- **Field selection** — search in content, title, description, or any combination
- **Case sensitivity** — optional case-sensitive matching
- **Context lines** — returns surrounding lines for each match

> [!tip]
> In-content search is available via the API and MCP. AI assistants use it to find specific information in your content without loading entire documents.
