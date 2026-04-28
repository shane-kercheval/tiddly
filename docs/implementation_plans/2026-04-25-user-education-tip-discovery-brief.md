# Tip Discovery Brief — User Education (M4)

Companion to [2026-04-25-user-education.md](./2026-04-25-user-education.md) M4.

This doc supports spinning up a dozen parallel agents to find candidate tips. Each agent is responsible for a single tip category and explores the codebase freely to find behaviors that fit. After all agents finish, the implementing agent (me, on a follow-up turn) reads the per-category candidate files, critiques them, dedupes, and produces a single recommended list for M5 to author from.

## Goal

We're building a Tips & Tricks page for Tiddly users. We need ideas: short, focused tips that help users discover useful behaviors they wouldn't notice from the UI alone.

### Two kinds of users — give equal weight to both

- **New users** — what would a first-week user be glad to be told about? Things they wouldn't figure out on their own.
- **Power users** — what makes a regular user faster, more productive, or unlocks workflows they didn't know were possible?

A tip can serve one or both. Don't let one perspective dominate the list.

### Two shapes of tip — give equal weight to both

- **Feature tips**: a specific behavior users get more value from once they know about it. *Example: "⌘+D selects the next occurrence in the editor — repeat to add more."*
- **Workflow tips**: a combination of features that solves a real task. *Example: "Save bookmarks fast with ⌘+V from any list view, then organize them with a tag-based filter you can revisit."*

Both shapes are equally valuable. Don't over-index on either.

### What's *not* a tip

- Bug reports or current limitations (those belong in Known Issues)
- Basic UI affordances the user has already discovered ("click the save button to save")
- Internal plumbing with no user-facing surface

### Calibration

Look at the seed corpus at `frontend/src/data/tips/tips.ts` for tone — terse, descriptive, no marketing language. Concrete examples:
- "Press ⌘+V on the All Content view to paste a URL and create a bookmark."
- "Type `/` at the start of a line in the note or prompt editor to open the command menu."
- "Wrap a phrase in quotes — `\"machine learning\"` — for exact-match search."

## Agent prompt template

Copy this block for each category. Replace `{{CATEGORY}}` and `{{CATEGORY_DESCRIPTION}}` with values from the categories list below.

```
You are looking for candidate tips in the {{CATEGORY}} category for a Tips & Tricks
page in Tiddly — a multi-tenant SaaS for managing bookmarks, notes, and prompt
templates (FastAPI backend, React frontend, Go CLI, Chrome extension, MCP servers).

Read the code with the question "what would a user be glad to be told about?" in
mind — not "what does this function do?" The best tips emerge from imagining how
both new and power users actually interact with the product.

Category scope: {{CATEGORY_DESCRIPTION}}

Look for both kinds of users (give equal weight):
- New users — what would a first-week user be glad to know that isn't obvious?
- Power users — what makes a regular user faster, more productive, or unlocks
  workflows they didn't know existed?

Look for both shapes of tip (give equal weight):
- Feature tips — specific behaviors that unlock value once known.
- Workflow tips — combinations of features that solve a real task.

The relevant code can live anywhere — frontend components, backend services, docs
pages, CLI, Chrome extension, MCP servers. Use grep, find, file search, or import
following to discover what's relevant; you're not restricted to a particular path.

Match the seed corpus tone at frontend/src/data/tips/tips.ts: terse, descriptive,
no marketing language. If a tip relies on specific syntax or a shortcut, include
the literal example in the description (e.g., 'wrap a phrase in quotes like
"machine learning"' — not just 'wrap a phrase in quotes').

For each tip you find, capture:
- A short suggested title
- A one-sentence description of what it is and why it's useful (with concrete
  example if relevant)
- A pointer to the code or doc that demonstrates the behavior
- A note tagging it as feature/workflow and new-user/power-user (one of each)

Generate freely. Don't worry about polish, overlap with other categories, schema
fields, or audience tagging — we'll dedupe and trim during consolidation. Skip
obvious UI basics, bugs, and internal plumbing.

Write your output to:
docs/implementation_plans/2026-04-25-user-education-tip-candidates-{{CATEGORY}}.md

Format:

# Tip candidates — {{CATEGORY}}

## <tip title>
- Description: ...
- Reference: path/to/file.tsx:42
- Tags: feature | new-user

## <next tip title>
- Description: ...
- Reference: ...
- Tags: workflow | power-user

## Speculative

Tips you found but weren't sure were strong enough — flag them here for the
consolidator's judgment rather than dropping them.

- <one-line tip + brief reason for hesitation>
```

## Categories

Each agent owns one of the categories below. The category names match the `TipCategory` taxonomy at `frontend/src/data/tips/types.ts:10–23`.

- **`bookmarks`** — saving, scraping, organizing, and managing URL-based content (creation flow, scraping, content extraction, bookmark cards, edit page).
- **`notes`** — markdown note creation, editing, viewing, organization, and lifecycle.
- **`prompts`** — Jinja2 prompt templates, argument detection, rendering, the run dialog, and how prompts work via MCP.
- **`editor`** — the markdown editor itself: Milkdown, formatting, slash commands, view options (word wrap, line numbers, monospace, reading mode, table of contents). **Special scope**: the editor wraps CodeMirror for code blocks and prompt editing. For this category you should also surface CodeMirror-native power-user features that work because of the integration — multi-cursor, select-next-occurrence, find-replace, fold, jump-to-line, rectangular selection, etc. Use your own knowledge of CodeMirror and web search alongside codebase exploration. This is the slot for "all the cool things developers/power-users would love to know about the editor."
- **`search`** — full-text search across content, query operators (quoted phrases, OR, exclusion), unified search, and in-content search.
- **`filters`** — saved tag-based filter views (ContentFilter): boolean expressions, OR-of-AND groups, default sort, content-type scoping.
- **`tags`** — tag management: creation, autocomplete, rename-as-global-rename, archived/inactive tag handling, settings page.
- **`ai`** — LLM-powered features: AI suggestions, availability, cost tracking, AI settings, tier-gated behaviors.
- **`mcp`** — MCP servers (Content MCP, Prompt MCP) for AI assistant integration. Tools, search semantics, edit semantics, prompt invocation.
- **`cli`** — the Go CLI: OAuth flow, content commands, MCP setup, skills export, dry-run mode, token management.
- **`extension`** — Chrome browser extension: bookmark saver popup, background service worker, configuration, search-from-Chrome workflows.
- **`shortcuts`** — global and per-page keyboard shortcuts, the command palette, modifier-key behaviors (e.g., ⌘+click).

## Docs sweep (orthogonal pass)

In addition to the per-category agents above, run one more agent dedicated to walking the existing docs pages — `frontend/src/pages/docs/` and `frontend/public/llms.txt`. The docs prose already describes plenty of non-obvious behaviors; this is a high-yield, low-cost source of candidates. The output may overlap with category agents (a tip in `DocsSearch.tsx` might also be surfaced by the `search` agent) — that's fine, the consolidation step dedupes.

Use the same prompt template, with `{{CATEGORY}}` = `docs-sweep` and `{{CATEGORY_DESCRIPTION}}`:

> Walk every file under `frontend/src/pages/docs/` and `frontend/public/llms.txt`. The docs prose describes user-facing behaviors that may not be obvious to read about in code. Surface anything that fits the "would a user be glad to be told this?" bar.

## Consolidation step (my job after agents finish)

After all agents have written their per-category candidate files, I'll:

1. **Critique pass.** Read every per-category file and flag candidates that are obvious, fabricated, or low-value. Cut the weakest 30–50%.
2. **Dedupe overlap.** Same tip surfaced from multiple categories collapses to one entry, retaining the strongest description and noting the cross-category applicability (the schema supports `categories: TipCategory[]`).
3. **Promote/demote speculative.** Each agent's `## Speculative` section gets a second look — promote the strong ones, drop the rest.
4. **Suggested ordering.** Group the consolidated list with a proposed ranking (which tips should rank highest on `/docs/tips`) plus rationale per group. You override the order; M5 picks up wherever it lands.
5. **Output.** A single working file at `docs/implementation_plans/2026-04-25-user-education-tip-candidates.md` — the input for M5's authoring agent. Per-category candidate files stay in place as raw artifacts (working files, not committed).

The per-category candidate files and the consolidated candidate list are working artifacts and don't need to be permanent commits.
