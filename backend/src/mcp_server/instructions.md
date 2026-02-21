This is the Content MCP server for tiddly.me (also known as "tiddly"). When users mention
tiddly, tiddly.me, or their bookmarks/notes service, they're referring to this system.

This MCP server is a content manager for saving and organizing bookmarks and notes.
Supports full-text search, tagging, markdown notes, and AI-friendly content editing.

## Content Types

- **Bookmarks** have: url, title, description, content (scraped page text or user-provided), tags
- **Notes** have: title, description, content (markdown), tags

The `content` field is the main body text. For bookmarks, it's typically auto-scraped from the
URL but can be user-provided. For notes, it's user-written markdown.

## Tool Naming Convention

- **Item tools** (`search_items`, `get_item`, `update_item`): Operate on bookmark/note entities
- **Content tools** (`edit_content`, `search_in_content`): Operate on the content text field

## Available Tools

**Context:**
- `get_context`: Get a markdown summary of the user's content (counts, tags, filters with top items, recent items).
  Call this once at the start of a session to understand what the user has and how it's organized.
  Re-calling is only useful if the user significantly creates, modifies, or reorganizes content during the session.
  Use IDs from the response with `get_item` for full content. Use tag names with `search_items`.

**Search** (returns active items only - excludes archived/deleted):
- `search_items`: Search bookmarks and notes. Two matching modes run together:
  1. **Full-text search** (English stemming + ranking): "databases" matches "database",
     "running" matches "runners". Supports operators:
     - Multiple words: AND by default (`python flask` = must contain both)
     - Quoted phrases: `"machine learning"` = exact phrase match
     - OR: `python OR ruby` = either term
     - Negation: `-python` prefix excludes matches (`flask -django` = flask without django)
  2. **Substring matching**: catches partial words, code symbols, and punctuation that
     stemming misses (`auth` finds "authentication", `useState` finds "useState",
     `node.js` finds "node.js"). Bookmark URLs are also matched via substring.
  Results matching both modes rank highest. Ranked by relevance by default when query
  is provided. Use `type` to filter by content type. Use `filter_id` to search within
  a saved content filter (discover IDs via `list_filters`).
- `list_filters`: List filters relevant to bookmarks and notes, with IDs, names, and tag rules.
  Use filter IDs with `search_items(filter_id=...)` to search within a specific filter.
- `list_tags`: Get all tags with usage counts

**Read & Edit:**
- `get_item`: Get item by ID. Includes `relationships` array with linked content info.
  Use `include_content=false` to check size before loading large content.
- `edit_content`: Replace exact text in content via old_str/new_str substitution (not title/description/tags)
- `search_in_content`: Search within item's text for matches with line numbers and context

**Update:**
- `update_item`: Update metadata (title, description, tags, url) and/or fully replace content.
  For targeted text edits, use `edit_content` instead.

**Create:**
- `create_bookmark`: Save a new URL (metadata auto-fetched if not provided)
- `create_note`: Create a new note with markdown content

**Relationships:**
- `create_relationship`: Link two content items together. Idempotent: if the link already exists, returns it.

## Search Response Structure

`search_items` returns:
```
{
  "items": [...],   // List of items with content_length and content_preview
  "total": 150,     // Total matches (for pagination)
  "limit": 50,      // Page size
  "offset": 0,      // Current offset
  "has_more": true  // More results available
}
```

Each item includes: `id`, `title`, `description`, `tags`, `created_at`, `updated_at`,
`content_length`, `content_preview`
- Bookmarks also have: `url`
- Items have: `type` ("bookmark" or "note")

**Note:** Search results include `content_length` and `content_preview` (first 500 chars)
but NOT the full `content` field. Use `get_item(id, type)` to fetch full content.

## Updating Items

- **`edit_content`**: Replace exact text in content via old_str/new_str. Use for typos, inserting/deleting text.
- **`update_item`**: Update metadata and/or fully replace content. Use for metadata changes or complete rewrites.

## Optimistic Locking

All mutation tools (`update_item`, `edit_content`, `create_bookmark`, `create_note`) return
`updated_at` in their response. You can optionally pass this value as `expected_updated_at` on
`update_item` for optimistic locking. If the item was modified after this timestamp, returns a
conflict error with `server_state` containing the current version for resolution. Omit
`expected_updated_at` if you do not have the exact `updated_at` value.

## Limitations

- Delete/archive operations are only available via web UI
- Search returns active items only (not archived or deleted)

## Example Workflows

1. "Show me my reading list"
   - Call `list_tags()` to discover tag taxonomy
   - Call `search_items(tags=["reading-list"])` to filter by tag

2. "Find my Python tutorials"
   - Call `search_items(query="python tutorial", type="bookmark")` — results ranked by relevance

3. "Save this article: <url>"
   - Call `create_bookmark(url="<url>", tags=["articles"])`

4. "Create a meeting note"
   - Call `create_note(title="Meeting Notes", content="## Attendees\n...", tags=["meeting"])`

5. "Search all my content for Python resources"
   - Call `search_items(query="python")` — searches both bookmarks and notes, ranked by relevance

6. "Edit my meeting note to fix a typo"
   - Call `search_items(query="meeting", type="note")` to find the note → get `id` from result
   - Call `get_item(id="<uuid>", type="note")` to read content
   - Call `edit_content(id="<uuid>", type="note", old_str="teh mistake", new_str="the mistake")`

7. "Check size before loading large content"
   - Call `get_item(id="<uuid>", type="note", include_content=false)` to get content_length
   - If small enough, call `get_item(id="<uuid>", type="note")` to get full content

8. "Update a bookmark's tags"
   - Call `update_item(id="<uuid>", type="bookmark", tags=["new-tag", "another"])`

9. "What does this user have?"
   - Call `get_context()` to get an overview of their content, tags, filters, and recent activity

10. "Show me items from my Work Projects filter"
   - Call `list_filters()` to find the filter ID
   - Call `search_items(filter_id="<uuid>")` to get items matching that filter

Tags are lowercase with hyphens (e.g., `machine-learning`, `to-read`).
