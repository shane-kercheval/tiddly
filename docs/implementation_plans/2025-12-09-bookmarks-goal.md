# Bookmark Management System

## Vision

There don't seem to be any good bookmark management solutions. I'm currently using Instapaper. It's alright. But I want something better integrated with my workflow. I don't care about offline reading—mainly just want a better way to organize, tag, and retrieve bookmarks. Also, I want to integrate it with AI tools for better search and summarization.

---

## Tech Stack

- **Backend**: Python with FastAPI
- **Frontend**: React (simple, modern, clean UI)
- **Database**: PostgreSQL with pgvector extension (for embeddings/semantic search)
- **Migrations**: Alembic
- **Authentication**: Auth0
- **Deployment**: Railway (simple, good DX) or Render (generous free tier)
- **LLM Integration**: [sik-llms](https://github.com/shane-kercheval/sik-llms) library
    - Provides common interface for OpenAI and Anthropic models
    - Users provide their own API keys
    - Model selection from `SUPPORTED_MODELS` (OpenAI + Anthropic)

---

## Architecture Decisions

- **Multi-tenant from day 1**: Every table includes `user_id` foreign key. Minimal overhead (~1-2 hours total), but retrofitting later is painful. Auth0 already provides user identification via JWT.
- **Vector storage**: pgvector keeps everything in Postgres (simpler ops, sufficient for personal/small-scale use)
- **Content fetching**: Best-effort auto-fetch; if URL is behind paywall/auth, leave content empty and allow manual copy/paste

---

## Data Model (Conceptual)

```
User
├── Bookmarks (url, title, description, content, tags[], created, accessed, archived)
├── Notes (markdown, linked_bookmark_ids[], created, updated)
├── Todos (title, description, due_date?, priority?, linked_bookmark_id?, completed)
└── Views (name, filters for bookmarks/notes/todos)
```

---

## Core Features

### Bookmarks

- **Add bookmarks** via web form (no browser extension initially)
    - Copy-paste URL, auto-fetch title/content/description (best-effort; allow manual paste if fetch fails)
    - Optional tags, descriptions, notes
    - Option to automatically generate tags using AI
        - LLM has access to existing tags for consistency
- **View bookmarks** in list
    - Sort by date added, title, etc.
    - Filter by tags
- **Edit/delete bookmarks**
- **Recently accessed view**
    - Shows "last clicked" bookmarks
    - Shortcut to open bookmark without marking as accessed (e.g., "wtf is this link?" scenario)
    - Visual "aging" by dimming bookmarks not accessed in a while
- **Archive bookmarks**
    - Moved to archive, not deleted
    - Hidden from main list and search unless explicitly searching archive
- **Suggest related bookmarks** when adding a bookmark
    - Based on tags, content similarity (embeddings), etc.
- **Reminders** to revisit bookmarks
    - snooze/dismiss/resnooze
    - User sets reminder date when adding/viewing
    - System surfaces reminder (e.g., move to top of list with special icon)

- Do we need a way to distinguish between bookmarks vs google docs/confluence pages? Maybe by url pattern? 
- We need a way to distinguish between material that is important to save vs ephemeral material (e.g. news articles).
    - Expiration date? Expired bookmarks either have auto-archive option or get moved to expired list to confirm/snooze/archive
    - Similarly, some material is like important "reference material" like "hey it's good to know about this if you're working on something related" but some material is "This is super important for my current project"—maybe a priority flag?
- Do we want users to be able to upload docs e.g. PDFs? Maybe.
- Do we want to support collections of bookmarks (e.g. folders)? Probably not.
- Is there an auto-complete LLM like code-complete?  

### Content Storage

- Stored in Postgres
- Option to store only metadata (title, url, tags, description) without full content (e.g., for privacy when integrating with Google Docs or Confluence later)
- On bookmark access, fetch and store newer version of content (if no 404/error)
- Optional version history of bookmark content
    - Store new version each time accessed
    - Allow viewing previous versions

### Search

- **Text search**: by title, tags, content
- **Semantic search**: using AI embeddings (pgvector)
- **AI-enhanced search**:
    - Generate multiple search queries from single user query (rephrase to improve semantic matching)
    - Return structured output: LLM ranks/sorts search results and returns best matches

### Notes

- Create one or more notes associated with a bookmark
- Notes are simple markdown text
- View/edit in markdown editor
- AI can generate summaries of bookmark content or extract key points (editable by user, stored as markdown)

### Todos

- Simple todo management integrated with bookmarks and notes
- Create/complete/delete todos
- Optional: due dates, priorities
- Link todo to a bookmark (e.g., "Read this article", "Follow up on this resource")
- Show in custom views alongside bookmarks/notes

### Custom Views

- User-created views (e.g., "work-related", "personal", "research")
- Not just saved filters—predefined views the user configures
- Can include bookmarks, notes, and todos for a given topic
- Single API endpoint returns combined list for a view

---

## API & Integrations

- **REST API** exposing read/write operations for all core features
    - Used by frontend, CLI tools, browser extension (future), MCP, etc.
- **MCP integration**
    - Wrap REST API endpoints in MCP commands
    - Add/view/search bookmarks from MCP

---

## Phased Implementation

### Phase 1 (MVP)
- Add/edit/delete bookmarks with auto-fetch metadata
- Manual tagging
- List view with sort/filter by tags/date
- Simple text search (title, tags, description)
- Auth0 authentication

### Phase 2
- AI-powered auto-tagging
- Semantic search with embeddings (pgvector)
- Notes on bookmarks
- "Recently accessed" tracking

### Phase 3
- Custom views
- Todos (linked to bookmarks)
- Reminders
- Version history for bookmark content
- Related bookmark suggestions
- Archive functionality

### Phase 4
- MCP integration
- Advanced AI search (query rephrasing, structured ranking)

---

## Future Ideas

- Link related bookmarks together (e.g., "this bookmark is related to that bookmark")
- Link notes together
- Collections of bookmarks (group related bookmarks)
- Versioned/snapshot notes
    - If AI edits a note, automatically snapshot previous version before applying changes
- Browser extension for quick bookmark adding
- Option to scan all bookmarks in give list of that no longer resolve (404) and prompt user to archive/delete/update

---

## Notes / TODO

- LLM instructions (TBD)