# Tip candidates — authored (M4 → M5 input)

This is the consolidated, authored output of the M4 review pass. Every keeper from the per-category reviews has a draft title and body here; M5 will convert these into the actual `Tip` objects in `tips.ts`.

## How to read this file

Each tip has:
- A `tip-id` (kebab-case slug, stable identifier).
- A title and a draft body (this is the actual prose that ships, not a description-of-the-tip).
- Metadata: priority (lower = higher rank), categories, audience, and references.
- Optional flags: `(verify)` = needs unit-test verification before shipping; `(seed)` = already in `tips.ts`; `(refine seed)` = existing seed tip whose wording should be extended; `minTier:` = tier-gated.

Tips are sorted by priority ascending. Where two tips share a priority, ordered by id.

---

## Tips

### 1. `use-prompts-in-claude-code` — priority 5

**Call your Tiddly prompts as slash commands in Claude Code**

Once Tiddly's prompt MCP server is connected (Settings → AI Integration), every saved prompt is invocable in Claude Code as a slash command. Type `/` to browse — Claude Code lists every prompt from connected MCP servers alongside its built-in commands. Pick one and pass arguments space-separated, e.g. `/pr-review 456`. Build prompts once in Tiddly, run them from any project.

- Categories: prompts, mcp
- Audience: power
- relatedDocs: [Prompts → /docs/features/prompts](/docs/features/prompts), [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 2. `use-prompts-in-claude-desktop` — priority 5

**Attach a Tiddly prompt to a Claude Desktop conversation**

Once `tiddly_prompts` is connected, click the `+` button below the message input in Claude Desktop, choose "Add from tiddly_prompts," pick a saved prompt, fill in its arguments, and click "Add prompt." The rendered prompt joins your message as an attachment Claude can read and act on. Useful for one-off runs without leaving the chat — note that Claude Desktop treats prompts as attachments rather than executable commands, which is a Claude Desktop choice, not a Tiddly limitation.

- Categories: prompts, mcp
- Audience: power
- relatedDocs: [Prompts → /docs/features/prompts](/docs/features/prompts), [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 3. `use-prompts-in-codex` — priority 5

**Use Tiddly prompts in Codex via Skills**

Codex doesn't support invoking MCP prompts directly. Workaround: export them as Agent Skills. Tag prompts with `skill` in Tiddly, then open Settings → AI Integration, pick Codex, and run the displayed `tiddly skills configure` command. Codex surfaces the exported skills as `$skill-name` invocations or auto-selects them based on task context. Same template behavior as MCP prompts, different invocation surface.

- Categories: prompts, cli, mcp
- Audience: power
- relatedDocs: [CLI Skills → /docs/cli/skills](/docs/cli/skills), [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 4. `agent-authors-prompts` — priority 5

**Have your AI agent draft and refine prompts for you**

Once `tiddly_prompts` is connected, your AI agent can search, read, create, and edit prompts through MCP tools. Ask it to draft new prompts from scratch (*"write me a code-review prompt that takes a diff argument"*), iterate on existing wording (*"rewrite this prompt to be more concise"*), or rename arguments across many prompts at once. Often faster than hand-authoring for non-trivial templates — and edits land in version history with the source `MCP`, fully diffable and restorable.

- Categories: prompts, ai, mcp
- Audience: power
- relatedDocs: [Prompts → /docs/features/prompts](/docs/features/prompts), [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 5. `connect-ai-tool-to-content` — priority 8

**Let Claude read and edit your bookmarks and notes directly**

Open Settings → AI Integration, pick your AI tool (Claude Desktop, Claude Code, Codex), and run the displayed `tiddly mcp configure` command. Your AI assistant can then search, read, and edit your bookmarks and notes directly — no copy-paste, no exporting. Ask it *"find the article I saved about transformers"* or *"fix the typo in my last meeting note"* and it goes straight at your library.

- Categories: cli, mcp, bookmarks, notes
- Audience: all
- relatedDocs: [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 6. `editor-command-palette` — priority 10

**Open the editor command menu with `⌘+/`**

Press `⌘+/` anywhere in a note or prompt to open a filterable menu of every formatting, insertion, and editor action — including save, discard, reading mode, version history, and the table of contents. Faster than memorizing individual shortcuts.

- Categories: editor, notes, prompts
- Audience: power
- shortcut: ['⌘', '/']
- areas: ['/app/notes', '/app/prompts']

### 7. `note-slash-commands` — priority 10 (seed, refine)

**Use slash commands in the note and prompt editors**

Type `/` after whitespace (start of line or mid-line) to open a menu of block-level formatting: headings, lists, code blocks, callouts, and more. The prompt editor's menu adds Jinja2 building blocks — variable, if block, if block (trim) — so you can scaffold a template without retyping braces.

- Categories: notes, prompts, editor
- Audience: beginner
- starter: true, starterPriority: 1
- areas: ['/app/notes', '/app/prompts']
- **Refinement note**: existing seed tip extended to mention mid-line activation and the prompt-specific Jinja entries.

### 8. `auto-configure-mcp` — priority 15

**Set up MCP for every AI tool with one command**

Run `tiddly mcp configure` with no arguments. The CLI auto-detects Claude Desktop, Claude Code, and Codex, mints a dedicated PAT per tool/server, and writes both `tiddly_notes_bookmarks` and `tiddly_prompts` MCP entries. Existing custom entries (e.g., a hand-added `work_prompts`) are preserved untouched.

- Categories: cli, mcp
- Audience: beginner
- relatedDocs: [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 9. `click-checkbox-raw-editor` — priority 15

**Toggle checkboxes in the raw markdown editor by clicking them**

In the raw markdown editor, you don't have to switch to reading mode to tick off a `- [ ]` task. Click directly on the `[ ]` or `[x]` glyph to flip it. The markdown updates and saves on next save — useful for checklists you want to read and edit in one view.

- Categories: editor, notes
- Audience: beginner
- areas: ['/app/notes']

### 10. `combine-and-or-filters` — priority 15

**Combine AND and OR in a single filter expression**

Within a filter group, tags are ANDed (all must match). Between groups, ORed (any group can match). So `(python AND tutorial) OR (javascript AND guide)` joins two AND-groups with OR — useful for "either of two specific topics" without making two separate filters.

- Categories: filters
- Audience: power
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 11. `generate-prompt-arguments` — priority 15

**Generate prompt arguments from your `{{ placeholders }}`**

After drafting a prompt template with `{{ placeholders }}`, click the sparkle icon in the Arguments header. AI scans the template and proposes a name, description, and required flag for every placeholder you haven't already defined. Per-row sparkles refine a single argument's blank fields.

- Categories: prompts, ai
- Audience: beginner
- minTier: pro (verify)
- areas: ['/app/prompts']

### 12. `palette-shortcut` — priority 15

**Open the command palette with `⌘+Shift+P`**

Press `⌘+Shift+P` to open the command palette — works even while typing in an input. Jump to any sidebar filter, settings page, or `New Note`/`New Bookmark`/`New Prompt` action without touching the mouse. Tab-completion narrows the list as you type.

- Categories: shortcuts
- Audience: beginner
- shortcut: ['⌘', 'Shift', 'P']
- starter: true, starterPriority: 2

### 13. `paste-page-content` — priority 15

**Paste your own text into a bookmark's Page Content to make it searchable**

A bookmark's "Page Content" exists to feed full-text search — you don't typically read it. Expand the section under the bookmark and paste in your own text (highlights, an excerpt, a summary you wrote). That text now matches when you search, even for stub bookmarks where the auto-scrape didn't capture much.

- Categories: bookmarks
- Audience: power
- areas: ['/app/bookmarks']

### 14. `preview-prompt-as-sandbox` — priority 15

**Use the Preview dialog to test prompts and copy filled outputs**

On any saved prompt, click `Preview` to fill in argument values and render the template. Two flows: sanity-check the prompt before agents start using it (catches Jinja typos, whitespace issues, vague descriptions); or fill in arguments once and copy the rendered output to paste into ChatGPT, Cursor, or anywhere else outside MCP.

- Categories: prompts
- Audience: beginner
- areas: ['/app/prompts']

### 15. `rename-tag-everywhere` — priority 15

**Rename a tag from Settings to update it everywhere at once**

From Settings → Tags, renaming a tag rewrites it across every bookmark, note, prompt, saved filter, and active filter view in one operation. Use this to consolidate `js` and `javascript` (or fix a typo) without editing items one by one.

- Categories: tags
- Audience: power
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 16. `save-tag-combo-as-filter` — priority 15

**Save a tag combination as a reusable sidebar filter**

Click `+ Filter` at the bottom of the sidebar to turn any tag combination into a saved view. Saved filters live in the sidebar for one-click access — no need to re-pick tags every time you want the same slice. Filters can also restrict to a content type or pin a default sort.

- Categories: filters
- Audience: beginner
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 17. `schedule-auto-archive` — priority 15

**Schedule a bookmark or note to auto-archive on a future date**

Click the "Auto-archive: None" pill in a bookmark or note's metadata row to schedule it to archive itself — presets for 1 week, end of month, in 3/6/12 months, or a custom date. Useful for reference material that should drop out of your active list once a project ends.

- Categories: bookmarks, notes
- Audience: power
- areas: ['/app/bookmarks', '/app/notes']

### 18. `sync-prompts-as-skills` — priority 15

**Tag a prompt `skill` to export it to Claude Code, Claude Desktop, or Codex**

Tag prompts with `skill`, then run `tiddly skills configure` to auto-detect Claude Code, Claude Desktop, and Codex and write each prompt as a `SKILL.md` file. Agents auto-invoke skills based on context, or you call them with `/<name>` (Claude Code) or `$<name>` (Codex). This is the only way to invoke prompts from Codex, which doesn't support MCP-style prompt invocation.

- Categories: cli, prompts, mcp
- Audience: power
- relatedDocs: [CLI Skills → /docs/cli/skills](/docs/cli/skills)

### 19. `audit-ai-edits-via-history` — priority 18

**Audit and undo AI edits with version history**

When AI assistants edit your notes or prompts via MCP, every change is logged in version history with the source `MCP`. Open the History sidebar (`⌘+⇧+\`) to see what the agent changed, view the diff for each save, and restore any previous version. The safety net that makes letting AI edit your content feel safe — you can always see what it did and undo it.

- Categories: notes, prompts, ai, mcp
- Audience: power
- shortcut: ['⌘', 'Shift', '\\']

### 20. `ai-sees-prompt-metadata` — priority 20

**Write prompt names, descriptions, and arguments like docstrings**

When an AI assistant fetches a prompt via MCP, it reads everything: prompt name, description, argument names, argument descriptions, and required/optional flags. The AI uses all of it to decide whether to invoke the prompt and what to pass for each argument. Vague text leads to bad fills — write descriptions like docstrings, not labels.

- Categories: prompts, mcp
- Audience: power

### 21. `bring-your-own-api-key` — priority 20

**Use your own API key for higher AI limits and model choice**

In Settings → AI Configuration, paste a Google, OpenAI, or Anthropic key per use case. BYOK keys get a separate, higher daily limit than the platform default and let you pick a specific model from a curated allowlist. Keys live in browser localStorage only — never on the server.

- Categories: ai, account
- Audience: power
- minTier: pro (verify)
- relatedDocs: [AI features → /docs/features/ai](/docs/features/ai)

### 22. `claude-summarize-bookmark-content` — priority 20

**Have Claude rewrite a bookmark's content for better search**

A bookmark's "Page Content" exists to feed full-text search — you don't usually read it. Ask Claude (or another MCP-connected agent) to fetch the bookmark's URL, write a dense summary focused on the keywords you'd search for later, and save it back via the MCP `update_item` tool. Replaces the raw scrape with something denser and more findable.

- Categories: bookmarks, mcp, ai
- Audience: power
- minTier: tbd
- areas: ['/app/bookmarks']

### 23. `editor-find-and-replace` — priority 20

**Find and replace inside a note or prompt with `⌘+F`**

`⌘+F` opens a search panel at the top of the editor. `⌘+G` jumps to the next match, `⌘+⇧+G` to the previous. The panel exposes regex, case-sensitive toggles, and replace — handy for refactoring a long note without leaving edit mode.

- Categories: editor, notes, prompts
- Audience: beginner
- shortcut: ['⌘', 'F']

### 24. `export-to-json` — priority 20

**Export your library to JSON for backup or scripting**

`tiddly export --output backup.json` streams every bookmark, note, and prompt to a single JSON file with low memory use. Use `--types bookmark,note` to scope, `--include-archived` to include archived items. Default output is stdout — pipe straight into `jq` to filter or transform.

- Categories: cli
- Audience: power
- relatedDocs: [CLI reference → /docs/cli/reference](/docs/cli/reference)

### 25. `global-search-shortcut` — priority 20

**Press `/` to focus the global search bar**

From anywhere outside an input, press `/` to focus the global search. Inside the command palette, the same key drops you into its search sub-view. Useful when you want to find something fast without picking up the mouse.

- Categories: shortcuts
- Audience: beginner
- shortcut: ['/']
- starter: true, starterPriority: 3

### 26. `group-filters-into-collections` — priority 20

**Organize sidebar filters into Collections**

Click `+ Collection` to make a sidebar group, then drag filters into it. Use one Collection per project or context (Work, Personal, Research) to keep the sidebar tidy when you have a lot of saved filters. Removing a Collection moves its filters back to the sidebar root — your filters aren't deleted.

- Categories: filters
- Audience: beginner
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 27. `jinja-rename-via-cmd-d` — priority 20

**Rename a Jinja variable across a prompt template with `⌘+D`**

In a prompt editor, type `/var` Enter to drop a `{{ }}` placeholder. Name it once, then put your cursor on it and press `⌘+D` to extend the selection to the next match — repeat to grab them all, then type the new name once and they all rename together. Tiddly auto-detects the named variables on save.

- Categories: prompts, editor
- Audience: power
- shortcut: ['⌘', 'D']
- areas: ['/app/prompts']

### 28. `link-content-for-context` — priority 20

**Link bookmarks, notes, and prompts together to build context bundles**

From any item, the "Link content" button attaches related notes, prompts, or bookmarks. Linked items appear as clickable chips you can navigate through later — handy for binding meeting notes to source articles, code-review prompts to style-guide notes, or research bundles without inventing tags.

- Categories: bookmarks, notes, prompts
- Audience: power

### 29. `prompt-template-arguments` — priority 20 (seed)

**Define prompt arguments with double-brace placeholders**

Prompts are Jinja2 templates. Wrap a placeholder in double braces — e.g. `{{ topic }}` — and Tiddly auto-detects it as a required argument when you save. Use the run dialog to fill them in.

- Categories: prompts
- Audience: beginner
- starter: true, starterPriority: 4
- areas: ['/app/prompts']
- relatedDocs: [Prompts → /docs/features/prompts](/docs/features/prompts)

### 30. `quick-create-linked-content` — priority 20

**Create a linked bookmark, note, or prompt without losing your place**

In the link picker on any item (the link icon in the metadata row), pick "Create new bookmark/note/prompt." A fresh detail page opens pre-linked back to the item you came from. Save and close — you land back in the source with the new link already wired up. Useful for capturing related items mid-flow without the "I'll link it later" trap.

- Categories: notes, bookmarks, prompts
- Audience: power

### 31. `reading-mode-toggle` — priority 20

**Toggle between editor and reading mode with `⌘+⇧+M`**

Press `⌘+⇧+M` to switch a note or prompt between raw markdown editing and a fully rendered Milkdown preview. Scroll position is preserved across the toggle, so you can read a note formatted, then jump back to where you were typing.

- Categories: editor, notes, prompts
- Audience: beginner
- shortcut: ['⌘', 'Shift', 'M']

### 32. `required-vs-optional-args` — priority 20

**Pick required vs optional carefully — it changes how agents fill the prompt**

A required argument must be supplied at render time (rendering errors otherwise); an optional one defaults to empty string. Make required when you want the agent to fail loudly if it forgets context. Make optional when the prompt should still render usefully without it.

- Categories: prompts
- Audience: beginner
- areas: ['/app/prompts']

### 33. `search-from-extension` — priority 20

**Search your library from the Chrome extension**

The extension popup has a Search tab next to Save — type to query across titles, descriptions, URLs, and scraped page content; filter by tag, sort by relevance/last-used/modified/title. Useful when you're browsing and remember saving something but don't want to leave the page to look it up.

- Categories: extension
- Audience: power

### 34. `shortcuts-dialog` — priority 20

**Press `⌘+⇧+/` to pop up the shortcuts cheat sheet**

Forget a shortcut? Press `⌘+⇧+/` from anywhere — even mid-typing — to open the full shortcuts dialog. Find what you need, close, get back to work.

- Categories: shortcuts
- Audience: beginner
- shortcut: ['⌘', 'Shift', '/']

### 35. `sparkle-generate-metadata` — priority 20

**Generate titles and descriptions with the sparkle icon**

Each title and description field has a sparkle icon. Click the title sparkle to generate a title from the description/content; click the description sparkle to generate from content. If both fields are empty, one click on either generates both at once. Saves a step on bookmarks where the auto-fetch missed.

- Categories: ai, bookmarks, notes, prompts
- Audience: beginner
- minTier: pro (verify)

### 36. `tag-click-to-filter` — priority 20

**Click any tag chip on a card to filter by it**

Tags rendered on bookmark, note, and prompt cards are clickable. Click one to add it to the current view's tag filter — autocomplete is still available for stacking more. Faster than opening the filter input and typing the tag.

- Categories: tags
- Audience: beginner

### 37. `whitespace-control-jinja` — priority 20 (verify)

**Use `{%- if %}` instead of `{% if %}` to keep optional sections clean**

Add a `-` inside a Jinja tag (`{%- if optional_arg %}…{%- endif %}`) to strip surrounding whitespace. Without it, an empty optional block leaves a blank line in the rendered prompt. The slash menu's "If block (trim)" entry inserts the dashed form for you.

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']
- **verify**: unit-test that the API → renderer pipeline strips whitespace as expected.

### 38. `skill-description-as-trigger` — priority 20

**Write skill descriptions as invocation triggers, not labels**

When a prompt is exported as a skill, the description goes into the SKILL.md frontmatter and is what the agent reads to decide whether to invoke it. Write it like a trigger — *"Reviews a Python file for bugs and style issues. Use when the user pastes Python code."* Not just *"code review."*

- Categories: prompts, cli
- Audience: power

### 39. `ai-suggest-related-items` — priority 25

**Find related bookmarks, notes, and prompts via the linked content input**

Open the linked content input on any item to get AI-suggested cross-type relationships. The backend searches by title and shared tags first, then asks the LLM to filter for genuinely related candidates. Surfaces connections across bookmarks, notes, and prompts you might have missed.

- Categories: ai, bookmarks, notes, prompts
- Audience: beginner
- minTier: pro (verify)

### 40. `cmd-click-link-raw-editor` — priority 25

**Open a markdown link from the raw editor with `⌘+click`**

In the raw markdown editor, hold `⌘` and click a `[text](url)` link to open the URL — without switching to reading mode. The editor explicitly suppresses the default Cmd+click-to-add-cursor behavior so the link opens cleanly.

- Categories: editor, notes, prompts
- Audience: beginner

### 41. `cmd-click-new-tab` — priority 25

**Open a card in a new tab with `⌘+click`**

Hold `⌘` (or `Ctrl` on Windows/Linux) and click any bookmark, note, or prompt card to open its detail page in a new tab — keeping your current list view in place. Same affordance as a browser link.

- Categories: shortcuts
- Audience: power
- shortcut: ['⌘', 'Click']

### 42. `collapse-sidebar` — priority 25

**Collapse the sidebar with `⌘+\`**

Press `⌘+\` (or `Ctrl+\`) to collapse or expand the main sidebar — useful when reading or writing a long note. Works even while typing.

- Categories: shortcuts
- Audience: power
- shortcut: ['⌘', '\\']

### 43. `extension-default-tags` — priority 25

**Pre-tag every save by setting default tags in the extension**

Open the extension settings and pick default tags (e.g., `reading-list`). They're pre-selected on every save — clear them per-bookmark with the inline Clear link if a particular page doesn't fit. Handy for a recurring workflow like always tagging saves with `reading-list`.

- Categories: extension
- Audience: beginner

### 44. `for-loop-list-arg` — priority 25 (verify)

**Loop over a list-typed argument with `{% for %}`**

Pass a list and render it with `{% for item in items %}- {{ item }}\n{% endfor %}`. Agents calling your prompt can supply arrays for arguments — useful for things like "review these files" or "summarize these issues."

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']
- **verify (load-bearing)**: argument schema may not currently express list types end-to-end. Drop or reframe if not supported.

### 45. `jinja-filters` — priority 25 (verify)

**Transform argument values with Jinja2 filters**

Use the pipe syntax in a template to transform values inline: `{{ note | default("(no notes)") }}` substitutes a fallback for empty optional args; `{{ name | upper }}` uppercases; `{{ items | join(", ") }}` joins a list. Chain them: `{{ tags | default([]) | join(", ") }}`.

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']
- **verify**: unit-test that the API render path supports `default`, `upper`, `join`.

### 46. `link-shortcut-wraps-selection` — priority 25

**Wrap a selection as a link with `⌘+K`**

Highlight some text, press `⌘+K`, and Tiddly turns it into `[selected](url)` with the URL field pre-selected so you can paste the destination immediately. Works in the note and prompt editors.

- Categories: editor, notes, prompts
- Audience: beginner
- shortcut: ['⌘', 'K']

### 47. `multi-cursor-above-below` — priority 25

**Drop multi-cursors above or below with `⌘+⌥+↑/↓`**

Hold `⌘+⌥` and press the up or down arrow to add a second (or third) cursor on the line above or below. Type once and the same edit lands on every cursor — useful for editing parallel lines like list items or import statements.

- Categories: editor
- Audience: power
- shortcut: ['⌘', '⌥', '↑/↓']

### 48. `or-groups-merge-synonym-tags` — priority 25

**Merge synonym tags into one filter without renaming**

If you have both `js` and `javascript` (or `ml` and `machine-learning`), make a filter with two single-tag OR groups: `(js) OR (javascript)`. You get one unified view without bulk-renaming or losing either tag's history.

- Categories: filters, tags
- Audience: power
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 49. `pat-generation-from-cli` — priority 25

**Generate Personal Access Tokens from the CLI**

`tiddly tokens create "CI Pipeline" --expires 90` mints a 90-day PAT and prints it once — copy it immediately. List with `tiddly tokens list`, delete with `tiddly tokens delete <id>`. PAT auth can't manage tokens — use OAuth login first.

- Categories: cli, account
- Audience: power
- relatedDocs: [CLI reference → /docs/cli/reference](/docs/cli/reference)

### 50. `per-directory-mcp-scope` — priority 25

**Configure MCP per project with `--scope directory`**

Run `tiddly mcp configure --scope directory` (or the same flag on `skills configure`) inside a project to restrict Tiddly access to that directory only. Claude Code writes to `~/.claude.json` under the project key; Codex writes `.codex/config.toml` in the cwd; skills land in `.claude/skills/` or `.agents/skills/`. Useful for separating work and personal accounts.

- Categories: cli
- Audience: power
- relatedDocs: [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 51. `pin-default-sort-per-filter` — priority 25

**Pin a default sort on each saved filter**

Each saved filter remembers its own sort field and direction. Set "Reading List" to `created_at` ascending (oldest first), "Inbox" to `last_used_at` descending — they each open in their own order without you toggling the sort each time.

- Categories: filters
- Audience: power

### 52. `refine-prompt-arg-per-row` — priority 25

**Refine one prompt argument at a time with the per-row sparkle**

Each argument row has its own sparkle. Fill in just the name and click it to suggest a description; fill in just the description to suggest a name. Leave both blank for AI to infer name, description, and the required flag from the template.

- Categories: prompts, ai
- Audience: power
- minTier: pro (verify)
- areas: ['/app/prompts']

### 53. `restore-older-version` — priority 25

**Restore a previous version from the History sidebar**

Open History on any note or prompt to see every saved revision with diffs. Click Restore on an older version and the current content is replaced — restoration creates a new version, so nothing is ever truly lost. Available via the toolbar History icon or `⌘+⇧+\`.

- Categories: notes, prompts, editor
- Audience: beginner
- shortcut: ['⌘', 'Shift', '\\']
- relatedDocs: [Versioning → /docs/features/versioning](/docs/features/versioning)

### 54. `save-with-extension` — priority 25

**Save the current page with the Tiddly Chrome extension**

Install the Tiddly Bookmarks extension to save the page you're on with one click — no copy-pasting URLs into the web app. Works in Chrome, Edge, Brave, Arc, and other Chromium browsers. Pair with default tags in extension settings to pre-tag every save.

- Categories: extension, bookmarks
- Audience: beginner
- relatedDocs: [Chrome extension → /docs/extensions/chrome](/docs/extensions/chrome)

### 55. `save-with-ext-organize-in-app`  — priority 25

**Capture in the extension, curate in the web app**

Use the extension while browsing — title, description, and content auto-fill from the page. Later, open tiddly.me to edit, tag, link bookmarks together, or move them into saved filters. Two surfaces, two jobs: capture in-context, curate later.

- Categories: extension, bookmarks
- Audience: beginner

### 56. `select-lines-make-checklist` — priority 25

**Turn a block of lines into a checklist with `⌘+⇧+9`**

Select a block of lines and press `⌘+⇧+9` — every line gets a `- [ ]` prefix. Press it again on those same lines to remove the prefix. Pair with click-to-toggle in the raw editor to tick items off later.

- Categories: editor, notes
- Audience: beginner
- shortcut: ['⌘', 'Shift', '9']

### 57. `shift-cmd-click-silent-open` — priority 25

**Open a bookmark URL silently with `Shift+⌘+click`**

Hold `Shift+⌘` (or `Shift+Ctrl`) when clicking a bookmark's title, favicon, or URL to open the link without bumping its `last_used_at` timestamp. Useful when you want to peek at a saved page without skewing your "Recently used" sort order.

- Categories: bookmarks
- Audience: power

### 58. `strict-undefined-typos` — priority 25

**Typos in prompts surface immediately, not silently**

Referencing a variable that isn't declared as an argument raises an error at render time instead of silently producing an empty string. The editor catches this before save — undefined variables block saving with a "Template uses undefined variable(s)" error. Catches typos before they reach the agent.

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']

### 59. `swap-list-or-heading-level` — priority 25

**Swap a list type or heading level in one keystroke**

To convert a numbered list to bullets, select the lines and press `⌘+⇧+7`. To swap heading levels (e.g., H2 → H1), put your cursor on the heading line and press `⌘+⇧+1`. The shortcut overwrites the existing prefix instead of nesting or duplicating it.

- Categories: editor
- Audience: power
- shortcut: ['⌘', 'Shift', '7']

### 60. `tiddly-status` — priority 25

**Run `tiddly status` to see everything in one shot**

`tiddly status` prints CLI version, login status, API latency, content counts, MCP server config across user and directory scopes, and installed skills — all read-only, no files modified. Use `--path /your/project` to inspect a different directory's project-scoped config.

- Categories: cli
- Audience: beginner
- relatedDocs: [CLI reference → /docs/cli/reference](/docs/cli/reference)

### 61. `toc-jump-around` — priority 25

**Open the Table of Contents with `⌥+T` to jump around long notes**

Press `⌥+T` to open the ToC sidebar. It lists every heading in the note — click one to scroll the editor to that line and place the cursor there. Combine with `⌘+⌥+G` for non-heading jumps.

- Categories: editor, notes
- Audience: power
- shortcut: ['⌥', 'T']

### 62. `bookmark-paste-url` — priority 30 (seed)

**Save a bookmark by pasting its URL**

Copy a URL anywhere, then press `⌘+V` from the All Content view (or any saved-filter, archived, or trash view) — outside an input field. The new-bookmark form opens pre-filled with the URL; title and description get auto-fetched.

- Categories: bookmarks, shortcuts
- Audience: beginner
- starter: true, starterPriority: 5
- shortcut: ['⌘', 'V']
- areas: ['/app/content']

### 63. `click-suggested-tag-chips` — priority 30

**Click AI-suggested tag chips to add them**

When you open the tag input on a bookmark, note, or prompt, AI-suggested tags appear as muted chips to the right of your existing tags. Click one to add it to your tag list. Suggestions are based on the item's title, description, and content.

- Categories: ai, tags
- Audience: beginner
- minTier: pro (verify)

### 64. `comma-add-tag` — priority 30

**Add multiple tags fast with comma**

When inline-editing tags on a note, bookmark, or prompt, press `,` (or Enter) to commit the current tag and keep the input open for the next one. Backspace on an empty input removes the previous tag.

- Categories: tags
- Audience: power

### 65. `drag-sidebar` — priority 30

**Reorder the sidebar — including built-in views — by dragging**

The entire sidebar is draggable, including All Content, Archived, Trash, and the Command Palette entry. Pin the views you use most to the top, drop filters into and out of Collections, and the order is saved per-account.

- Categories: filters, account
- Audience: power

### 66. `full-width-layout` — priority 30

**Toggle full-width layout with `w`**

Press `w` (no modifiers, outside inputs) to flip between centered and full-width content layout — useful for wider notes, code-heavy prompts, or scanning long bookmark lists.

- Categories: shortcuts
- Audience: power
- shortcut: ['w']

### 67. `jinja-comment` — priority 30 (verify)

**Leave non-rendering notes in a prompt with `{# ... #}`**

`{# this is a comment #}` is a Jinja2 comment — invisible in the rendered output. Useful for leaving instructions to your future self ("regenerate after schema migration") without polluting what the agent sees.

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']
- **verify**: unit-test that `{# #}` is stripped on render through the API.

### 68. `pick-model-per-use-case` — priority 30

**Map each AI use case to a different model**

BYOK lets you map each use case (Suggestions today; Transform, Auto-Complete, Chat coming soon) to a different model from a curated allowlist. Route cheap calls (tag suggestions) to a smaller model and reserve a larger model for higher-stakes cases.

- Categories: ai, account
- Audience: power
- minTier: pro (verify)

### 69. `pin-extension-keyboard-shortcut` — priority 30

**Pin the Tiddly extension and bind it to a keyboard shortcut**

After installing, pin Tiddly Bookmarks to the toolbar, then open `chrome://extensions/shortcuts` and bind a key (e.g., `Ctrl+Shift+S`) to launch the popup without reaching for the mouse.

- Categories: extension
- Audience: power

### 70. `save-and-close` — priority 30

**Save and close in one shortcut: `⌘+⇧+S`**

`⌘+S` saves and stays in the editor; `⌘+⇧+S` saves and closes the editor view in one keystroke. Both also live in the `⌘+/` palette.

- Categories: editor, notes, prompts
- Audience: power
- shortcut: ['⌘', 'Shift', 'S']

### 71. `sort-tags-by-usage` — priority 30

**Sort tags by usage count to surface your favorites**

The Settings → Tags sort dropdown supports Count desc/asc in addition to Name. Sort by Count desc to see your most-used tags first — useful for deciding which tags to promote into saved filters.

- Categories: tags
- Audience: power

### 72. `view-toggles` — priority 30

**Toggle word wrap, line numbers, monospace, and ToC from the keyboard**

`⌥+Z` toggles word wrap, `⌥+L` toggles line numbers, `⌥+M` toggles monospace font, and `⌥+T` opens the Table of Contents sidebar. Preferences persist across sessions.

- Categories: editor
- Audience: power

### 73. `cancel-scheduled-archive` — priority 35

**Cancel a scheduled archive directly from the card**

When a bookmark has a future auto-archive date set, an indicator appears on the card with a one-click cancel — no need to open the bookmark to undo the schedule.

- Categories: bookmarks
- Audience: power

### 74. `jump-to-line` — priority 35

**Jump to a specific line in the editor with `⌘+⌥+G`**

Press `⌘+⌥+G` to open a small "go to line" prompt. Pair with line numbers (`⌥+L`) on long notes to navigate quickly.

- Categories: editor
- Audience: power
- shortcut: ['⌘', '⌥', 'G']

### 75. `mcp-configure-dry-run` — priority 35

**Preview MCP config changes with `--dry-run`**

Add `--dry-run` to `tiddly mcp configure` to see the exact diff (entries added, tokens that would be created) without writing any files or hitting the token API. Pair with `--force` to preview an overwrite of a mismatched CLI-managed entry.

- Categories: cli, mcp
- Audience: power

### 76. `servers-scope-flag` — priority 35

**Install only one MCP server with `--servers`**

By default `tiddly mcp configure` installs both servers. Pass `--servers content` for bookmarks/notes only or `--servers prompts` for prompts only. Same flag on `tiddly mcp remove --servers content --delete-tokens` cleans up just one server's PAT.

- Categories: cli, mcp
- Audience: power

### 77. `shift-click-linked-chip` — priority 35

**Open a linked bookmark inside Tiddly with `Shift+click`**

When a bookmark is linked from another note, prompt, or bookmark, clicking the chip opens the URL in a new tab. Hold `Shift` while clicking instead to navigate to the bookmark's detail page in Tiddly — useful when you want to edit metadata or relationships.

- Categories: bookmarks
- Audience: power

### 78. `test-byok-key` — priority 35

**Test your BYOK API key before relying on it**

After pasting an API key in Settings → AI Configuration, hit Test. The backend makes a minimal call against your selected model to catch wrong-key/wrong-provider mistakes before they trigger real suggestions.

- Categories: ai, account
- Audience: power
- minTier: pro (verify)

### 79. `search-quoted-phrase` — priority 40 (seed, refine)

**Match exact phrases or use search operators**

Wrap a phrase in quotes — e.g. `"machine learning"` — to match it exactly. Use `-term` to exclude matches (`python -django`). Use `OR` to widen across synonyms (`python OR ruby`). Combine them: `"web framework" -django OR rails`. Without operators, words become AND clauses and stemming may match variants like `learn` for `learning`.

- Categories: search
- Audience: all
- starter: true, starterPriority: 6
- areas: ['/app/content']
- relatedDocs: [Search → /docs/features/search](/docs/features/search)
- **Refinement note**: existing seed extended to cover all three operators (quoted phrase + `-term` exclusion + `OR` widening). Could also be re-prioritized lower (e.g., 20) once it covers the broader story.

### 80. `shortcut-select-next-occurrence` — priority 50 (seed, refine)

**Select the next occurrence in the editor with `⌘+D`**

With your cursor on a word in a note or prompt, press `⌘+D` to extend the selection to the next match — repeat to add more, then type once and they all rename together. Use `⌘+⇧+L` instead to grab every match in one shot.

- Categories: shortcuts, editor
- Audience: power
- shortcut: ['⌘', 'D']
- areas: ['/app/notes', '/app/prompts']
- relatedDocs: [Keyboard shortcuts → /docs/features/shortcuts](/docs/features/shortcuts)
- **Refinement note**: existing seed extended to mention `⌘+⇧+L` for select-all-matches.

---

## Tips needing verification before authoring

Four tips are flagged `(verify)` because they claim Jinja2 features working through the API → template-renderer pipeline. Before shipping, write unit tests confirming the API path actually exposes the claimed behavior. See plan's Follow-up #3.

- #34 `whitespace-control-jinja` — `{%- if %}` whitespace stripping
- #41 `for-loop-list-arg` — `{% for %}` over a list-typed argument (highest-risk: argument schema may not currently express list types)
- #42 `jinja-filters` — `| default`, `| upper`, `| join` filters
- #64 `jinja-comment` — `{# #}` comments stripped on render

## Tips with `minTier: pro` (verify)

Eight tips currently mark `minTier: pro` (verify). The schema doesn't yet support `minTier` — see plan's Follow-up #1. Before shipping, add the schema field and confirm each of these is actually Pro-gated:

- #8 `generate-prompt-arguments`
- #18 `bring-your-own-api-key`
- #32 `sparkle-generate-metadata`
- #36 `ai-suggest-related-items`
- #49 `refine-prompt-arg-per-row`
- #60 `click-suggested-tag-chips`
- #65 `pick-model-per-use-case`
- #75 `test-byok-key`

Plus #19 `claude-summarize-bookmark-content` — `minTier: tbd` (not gated by Tiddly's AI tier; depends on the user's external AI subscription).

## Architectural follow-ups (in plan)

See `2026-04-25-user-education.md` "Follow-ups discovered during M4 review":

1. **Tier flag on `Tip` schema** — add `minTier?: 'standard' | 'pro'` and tier-badge + upgrade-CTA rendering.
2. **MCP-consumability of tips** — narrowed; hand-curate cross-tool agent workflows into MCP `instructions.md` rather than building a new schema field.
3. **Verify tips that claim API/Jinja behavior via unit tests** — applies to the four `verify`-flagged prompt tips above.

## Counts

- Total tips: **77** (74 authored + 5 seed; 2 seed tips are duplicates with refinements applied = 77 net)
- Wait, actually: 5 seed (1 untouched + 3 with refinements + 1 with extended priority) + 72 newly authored = 77

  Let me actually count: the file above has tips #1–#77.

  Of those:
  - Seed tips: #4 `note-slash-commands`, #26 `prompt-template-arguments`, #59 `bookmark-paste-url`, #76 `search-quoted-phrase`, #77 `shortcut-select-next-occurrence` = 5 seed
  - Newly authored from review: 72 tips

- Tips at top tier (priority ≤ 15): 15 tips
- Tips needing verification (Jinja API): 4 tips
- Tips needing tier-flag verification: 8 tips
