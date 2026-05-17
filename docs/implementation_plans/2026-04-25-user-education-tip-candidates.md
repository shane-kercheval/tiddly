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

**Let your AI assistant read and edit your bookmarks and notes directly**

Open Settings → AI Integration, pick your AI tool (Claude Desktop, Claude Code, Codex), and run the displayed `tiddly mcp configure` command. Your AI assistant can then search, read, and edit your bookmarks and notes directly — no copy-paste, no exporting. Ask it *"find the article I saved about transformers"* or *"fix the typo in my last meeting note"* and it goes straight at your library.

- Categories: cli, mcp, bookmarks, notes
- Audience: all
- relatedDocs: [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 6. `editor-command-menu` — priority 10

**Open the editor command menu with `⌘+/`**

Press `⌘+/` anywhere in a note or prompt to open a filterable menu of every editor action — including formatting, save, discard, reading mode, version history, and the table of contents. Great for when you forget an editor shortcut.

- Categories: editor, notes, prompts
- Audience: all
- shortcut: ['⌘', '/']
- areas: ['/app/notes', '/app/prompts']

### 7. `note-slash-commands` — priority 10 (seed, refine)

**Use slash commands in the note and prompt editors**

Type `/` at the start of a line — or after a space mid-line — to open a menu of common formatting: headings, lists, code blocks, callouts, and more. In the prompt editor, the menu also includes Jinja2 building blocks (variables, if blocks) so you can scaffold a template without retyping braces.

- Categories: notes, prompts, editor
- Audience: beginner
- starter: true, starterPriority: 1
- areas: ['/app/notes', '/app/prompts']
- **Refinement note**: existing seed tip extended to mention mid-line activation and the prompt-specific Jinja entries.

### 8. `auto-configure-mcp` — priority 15

**Set up MCP for every AI tool with one command**

Run `tiddly mcp configure` with no arguments to set up every detected AI tool at once. The CLI finds Claude Desktop, Claude Code, and Codex, mints a dedicated token per tool/server, and writes both `tiddly_notes_bookmarks` and `tiddly_prompts` entries. Any custom MCP entries you've added by hand (e.g., `work_prompts`) are left untouched.

- Categories: cli, mcp
- Audience: beginner
- relatedDocs: [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 9. `click-checkbox-raw-editor` — priority 35

**Toggle checkboxes in the raw markdown editor by clicking them**

Tick off a `- [ ]` task without switching to reading mode — just click the `[ ]` or `[x]` glyph and it flips. The markdown updates immediately and saves like any other edit. Useful for checklists you want to read and edit in the same view.

- Categories: editor, notes, prompts
- Audience: beginner
- areas: ['/app/notes', '/app/prompts']

### 10. `combine-and-or-filters` — priority 15

**Use filter groups to mix AND and OR**

Tiddly filters use a two-level structure: tags inside the same group must all match (AND), and any matching group wins (OR). So two groups `[python, tutorial]` and `[javascript, guide]` together mean "Python tutorials *or* JavaScript guides" — one filter, two related topics, no duplication. Add another group from the filter builder when "OR something else" is what you want.

- Categories: filters
- Audience: power
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 11. `generate-prompt-arguments` — priority 15

**Let AI fill in prompt arguments from your `{{ placeholders }}`**

After drafting a template with `{{ placeholders }}`, click the sparkle icon in the Arguments header. AI scans the template and proposes a name, description, and required setting for every placeholder you haven't already defined. Or click the sparkle on a single row to fill just that argument's empty fields.

- Categories: prompts, ai
- Audience: beginner
- minTier: pro (verify)
- areas: ['/app/prompts']

### 12. `palette-shortcut` — priority 15

**Open the command palette with `⌘+Shift+P`**

Press `⌘+Shift+P` to open the command palette — works even while typing in an input. Jump to any sidebar filter, settings page, or New Note / New Bookmark / New Prompt action without touching the mouse. Type to filter the list.

- Categories: shortcuts
- Audience: beginner
- shortcut: ['⌘', 'Shift', 'P']
- starter: true, starterPriority: 2

### 13. `paste-page-content` — priority 30

**Improve search for bookmarks of login-only pages**

Login-protected pages — an internal Google Doc, a Confluence page, a paywalled article — don't auto-scrape, so the bookmark's Page Content stays empty and full-text search can't match it. Fix: expand the section under the bookmark and paste your own text (highlights, excerpt, summary). The Chrome extension scrapes from your already-signed-in tab and usually handles this for you; manual paste is the fallback.

- Categories: bookmarks
- Audience: power
- areas: ['/app/bookmarks']

### 14. `preview-prompt-as-sandbox` — priority 15

**Try a prompt before agents use it**

On any saved prompt, click `Preview` to fill in argument values and render the template. Two uses: see the exact text the agent will receive (handy for checking how Jinja whitespace renders after substitution), or copy the rendered output to paste into ChatGPT, Cursor, or anywhere outside MCP.

- Categories: prompts
- Audience: beginner
- areas: ['/app/prompts']

### 15. `rename-tag-everywhere` — priority 15

**Rename a tag once to update it across everything**

From Settings → Tags, renaming a tag rewrites it across every bookmark, note, prompt, and saved filter in one operation. For example, consolidate `js` and `javascript` (or fix a typo) without editing items one by one.

- Categories: tags
- Audience: power
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 16. `save-tag-combo-as-filter` — priority 15

**Save a recurring tag combo as a one-click sidebar filter**

If you keep picking the same tags to find the same slice of content, click `+ Filter` at the bottom of the sidebar to save the combination as a permanent view. Saved filters live in the sidebar for one-click access; they can also restrict to a content type or pin a default sort.

- Categories: filters
- Audience: beginner
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 17. `schedule-auto-archive` — priority 15

**Set bookmarks and notes to archive themselves**

For reference material with a known expiration — a project plan, a temporary doc, an event page — open the bookmark or note and click its "Auto-archive: None" pill. Presets for 1 week, end of month, 3/6/12 months, or custom. The item drops out of your active list automatically once the date passes.

- Categories: bookmarks, notes
- Audience: power
- areas: ['/app/bookmarks', '/app/notes']

### 19. `audit-ai-edits-via-history` — priority 18

**Audit and undo AI edits with version history**

When AI assistants edit your notes or prompts via MCP, every change is logged in version history with the source `MCP`. Open the History sidebar (`⌘+⇧+\`) to see what the agent changed, view the diff for each save, and restore any previous version. Lets you hand edit access to AI without losing oversight — every change is diffable and restorable.

- Categories: notes, prompts, ai, mcp
- Audience: power
- shortcut: ['⌘', 'Shift', '\\']

### 20. `ai-sees-prompt-metadata` — priority 20

**Agents pick and fill prompts based on your names, descriptions, and arguments**

When an AI assistant fetches a prompt via MCP, it reads everything: prompt name, description, argument names, argument descriptions, and required/optional flags. The AI uses all of it to decide whether to invoke the prompt and what to pass for each argument. Vague text leads to the wrong prompt getting picked or arguments filled with garbage — give each field a meaningful description.

- Categories: prompts, mcp
- Audience: power

### 21. `bring-your-own-api-key` — priority 20

**Use your own API key for higher AI limits and model choice**

In Settings → AI Configuration, paste a Google, OpenAI, or Anthropic key per use case. BYOK keys get a higher daily limit than the platform default and let you pick a specific model from a curated allowlist. Keys live in browser localStorage only — never on the server.

- Categories: ai, account
- Audience: power
- minTier: pro (verify)
- relatedDocs: [AI features → /docs/features/ai](/docs/features/ai)

### 22. `claude-summarize-bookmark-content` — priority 35

**Ask Claude to rewrite a bookmark's content for better search hits**

Page Content feeds full-text search — but the auto-scrape is often noisy boilerplate that buries the keywords you'd actually search for. Ask an MCP-connected agent (Claude, etc.) to read the bookmark, write a dense summary keyed on the terms you'd reach for later, and save it back via the `update_item` tool. Replaces the raw scrape with something denser and more findable.

- Categories: bookmarks, mcp, ai
- Audience: power
- minTier: tbd
- areas: ['/app/bookmarks']

### 23. `editor-find-and-replace` — priority 20

**Find, replace, and regex inside a note or prompt with `⌘+F`**

`⌘+F` opens an editor search panel with regex, case-sensitive, and replace toggles — enough to refactor a long note without leaving edit mode. Walk through matches with `⌘+G` (next) and `⌘+⇧+G` (previous).

- Categories: editor, notes, prompts
- Audience: beginner
- shortcut: ['⌘', 'F']

### 24. `export-to-json` — priority 20

**Export your library to JSON for backup or scripting**

`tiddly export --output backup.json` writes every bookmark, note, and prompt to a single JSON file. Use `--types bookmark,note` to scope; `--include-archived` to include archived items. Default output is stdout — pipe into `jq` to filter or transform.

- Categories: cli
- Audience: power
- relatedDocs: [CLI reference → /docs/cli/reference](/docs/cli/reference)

### 25. `global-search-shortcut` — priority 5

**Search across all your content with `/`**

Press `/` (outside an input) to open the global search dialog. It searches bookmarks, notes, and prompts together and ranks results by relevance — unlike the in-filter search, which is scoped to the current filter.

- Categories: shortcuts
- Audience: beginner
- shortcut: ['/']
- starter: true, starterPriority: 3

### 26. `group-filters-into-collections` — priority 20

**Tame a long filter sidebar with Collections**

When you accumulate enough saved filters to make the sidebar messy, click `+ Collection` to make a group and drag filters into it. One Collection per project or context (Work, Personal, Research) keeps things scannable. Removing a Collection moves its filters back to the sidebar root — your filters aren't deleted.

- Categories: filters
- Audience: beginner
- relatedDocs: [Tags & filters → /docs/features/tags-filters](/docs/features/tags-filters)

### 28. `link-content-for-context` — priority 20

**Link bookmarks, notes, and prompts together — no new tags needed**

From any item, the "Link content" button attaches related notes, prompts, or bookmarks. Linked items appear as clickable chips you can navigate through later — handy for binding meeting notes to a source article, a code-review prompt to a style-guide note, or any cluster of related items without inventing tags to group them.

- Categories: bookmarks, notes, prompts
- Audience: power

### 29. `prompt-template-arguments` — priority 20 (seed)

**Define prompt arguments with double-brace placeholders**

Prompts are Jinja2 templates. Wrap a placeholder in double braces — e.g. `{{ topic }}` — then add a matching row in the Arguments panel before saving (the sparkle icon in the Arguments header can fill rows in from your placeholders automatically). At invocation time, agents and the run dialog prompt for argument values.

- Categories: prompts
- Audience: beginner
- starter: true, starterPriority: 4
- areas: ['/app/prompts']
- relatedDocs: [Prompts → /docs/features/prompts](/docs/features/prompts)

### 30. `quick-create-linked-content` — priority 20

**Create a linked bookmark, note, or prompt without losing your place**

Open the link picker on any item and click one of the "Create linked" icon buttons (note, bookmark, or prompt). A fresh detail page opens pre-linked back to the item you came from. Save and close — you land back in the source with the new link already wired up. For capturing related items mid-flow without the "I'll link it later" trap.

- Categories: notes, bookmarks, prompts
- Audience: power

### 31. `reading-mode-toggle` — priority 20

**Read your note rendered without losing your place**

Press `⌘+⇧+M` to switch a note or prompt between raw markdown editing and a fully rendered Milkdown preview. Scroll position is preserved across the toggle, so you can read formatted then jump back to where you were typing.

- Categories: editor, notes, prompts
- Audience: beginner
- shortcut: ['⌘', 'Shift', 'M']

### 32. `required-vs-optional-args` — priority 20

**Required arguments fail loudly; optional ones default to empty**

A required argument must be supplied at render time — missing it raises an error. An optional one defaults to empty string and the prompt still renders. Make an argument required when you want the agent to fail loudly if it forgets context; make it optional when the prompt should still render usefully without it.

- Categories: prompts
- Audience: beginner
- areas: ['/app/prompts']

### 33. `search-from-extension` — priority 20

**Find a saved bookmark without leaving the page you're on**

From the Chrome extension popup, click the Search tab next to Save — type to query across bookmark titles, descriptions, URLs, and scraped page content. Filter by tag; sort by relevance, last used, or date modified.

- Categories: extension
- Audience: power

### 34. `shortcuts-dialog` — priority 20

**Find any shortcut with `⌘+⇧+/`**

Forget a shortcut? Press `⌘+⇧+/` from anywhere — even mid-typing — to open the full shortcuts dialog. Find what you need, close, get back to work.

- Categories: shortcuts
- Audience: beginner
- shortcut: ['⌘', 'Shift', '/']

### 35. `sparkle-generate-metadata` — priority 20

**One sparkle click fills every empty metadata field**

Click the sparkle icon on any title, description, or (prompt) name field to fill in whichever of those fields are still empty. On a fresh bookmark with no title or description, one click generates both. Saves a step on bookmarks where the auto-fetch missed.

- Categories: ai, bookmarks, notes, prompts
- Audience: beginner
- minTier: pro (verify)

### 36. `tag-click-to-filter` — priority 20

**Click any tag chip on a card to filter by it**

Tags rendered on bookmark, note, and prompt cards are clickable. Click one to add it to the current view's filter — faster than opening the filter input and typing the tag.

- Categories: tags
- Audience: beginner

### 37. `whitespace-control-jinja` — priority 20 (verify)

**Keep optional Jinja blocks from leaving blank lines**

Add a `-` inside a Jinja tag (`{%- if optional_arg %}…{%- endif %}`) to strip surrounding whitespace. Without it, an empty optional block leaves a blank line in the rendered prompt. The slash menu's "If block (trim)" entry inserts the dashed form for you.

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']
- **verify**: unit-test that the API → renderer pipeline strips whitespace as expected.

### 40. `cmd-click-link-raw-editor` — priority 25

**Follow a markdown link without switching to reading mode**

In the raw markdown editor, hold `⌘` and click a `[text](url)` link to open the URL. The editor explicitly suppresses Cmd+click-to-add-cursor over a link, so the link opens cleanly.

- Categories: editor, notes, prompts
- Audience: beginner

### 41. `cmd-click-new-tab` — priority 25

**Open a card in a new tab to keep your list in place**

Use `{{shortcut:card.openInNewTab}}` on any bookmark, note, or prompt card to open its detail page in a new tab. Same affordance as a browser link.

- Categories: shortcuts
- Audience: power
- shortcut: ['⌘', 'Click']

### 42. `collapse-sidebar` — priority 25

**Free up screen space for long notes**

Press `{{shortcut:app.toggleSidebar}}` to collapse or expand the main sidebar. Works even while typing.

- Categories: shortcuts
- Audience: power
- shortcut: ['⌘', '\\']

### 43. `extension-default-tags` — priority 25

**Pre-tag every save by setting default tags in the Chrome extension**

Open the extension settings and pick default tags (e.g., `reading-list`). They're pre-selected on every save — clear them with the inline Clear link if a particular page doesn't fit.

- Categories: extension
- Audience: beginner

### 45. `jinja-filters` — priority 25 (verify)

**Transform argument values with Jinja2 filters**

Use the pipe syntax to transform argument values inline: `{{ name | upper }}` uppercases; `{{ note | default("(no notes)", true) }}` substitutes a fallback when the arg is empty or unset (the second argument is required — without it, `default` only fires on undefined, but optional args default to `""`). Chain filters: `{{ name | lower | replace("_", " ") }}`.

- Categories: prompts
- Audience: power
- areas: ['/app/prompts']
- **verify**: unit-test that the API render path supports `default`, `upper`, `join`.

### 46. `link-shortcut-wraps-selection` — priority 25

**Paste a URL onto selected text with `⌘+K`**

Highlight some text, press `⌘+K`, and Tiddly turns it into `[selected](url)` with the URL field pre-selected so you can paste the destination immediately. Works in the note and prompt editors.

- Categories: editor, notes, prompts
- Audience: beginner
- shortcut: ['⌘', 'K']

### 47. `multi-cursor-above-below` — priority 25

**Edit parallel lines at once with multi-cursors (`⌘+⌥+↑/↓`)**

Hold `⌘+⌥` and press the up or down arrow to add a second (or third) cursor on the line above or below. Type once and the same edit lands on every cursor — useful for editing list items or import statements in lockstep.

- Categories: editor
- Audience: power
- shortcut: ['⌘', '⌥', '↑/↓']

### 50. `per-directory-mcp-scope` — priority 25

**Keep work and personal accounts separate with `--scope directory`**

Run `tiddly mcp configure --scope directory` (or the same flag on `skills configure`) inside a project to restrict Tiddly access to that directory only. Claude Code writes to `~/.claude.json` under the project key; Codex writes `.codex/config.toml` in the cwd; skills land in `.claude/skills/` or `.agents/skills/`.

- Categories: cli
- Audience: power
- relatedDocs: [CLI MCP setup → /docs/cli/mcp](/docs/cli/mcp)

### 51. `pin-default-sort-per-filter` — priority 25

**Each saved filter remembers its own sort order**

Set a sort field and direction on a filter and Tiddly persists it. Set "Reading List" to `created_at` ascending (oldest first), "Inbox" to `last_used_at` descending — each opens in its own order without you toggling the sort every time.

- Categories: filters
- Audience: power

### 53. `restore-older-version` — priority 25

**Undo any edit by restoring an earlier version**

Open History on any note or prompt to see every saved revision with diffs. Click Restore on an older version and the current content is replaced — restoration creates a new version, so nothing is ever truly lost. Available via the toolbar History icon or `⌘+⇧+\`.

- Categories: notes, prompts, editor
- Audience: beginner
- shortcut: ['⌘', 'Shift', '\\']
- relatedDocs: [Versioning → /docs/features/versioning](/docs/features/versioning)

### 54. `save-with-extension` — priority 25

**Skip copy-pasting URLs — save with the Tiddly Chrome extension**

The Tiddly Bookmarks extension saves the page you're on with one click. Works in Chrome, Edge, Brave, Arc, and other Chromium browsers. Pair with default tags in extension settings to pre-tag every save.

- Categories: extension, bookmarks
- Audience: beginner
- relatedDocs: [Chrome extension → /docs/extensions/chrome](/docs/extensions/chrome)

### 57. `shift-cmd-click-silent-open` — priority 25

**Peek at a bookmark without bumping its last-used timestamp**

Use `{{shortcut:bookmark.openLinkSilent}}` on a bookmark's title, favicon, or URL to open it without updating `last_used_at`. Useful when "Recently used" is your default sort and you don't want a one-off peek to reshuffle the list.

- Categories: bookmarks
- Audience: power

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

### 64. `comma-add-tag` — priority 30

**Add and remove tags from the keyboard alone**

When inline-editing tags on a note, bookmark, or prompt, press `,` (or Enter) to commit the current tag and keep the input open for the next one. Press Backspace on an empty input to remove the previous tag.

- Categories: tags
- Audience: power

### 65. `drag-sidebar` — priority 30

**Reorder the sidebar — including built-in views — by dragging**

The entire sidebar is draggable, including All Content, Archived, Trash, and the Command Palette entry. Pin the views you use most to the top, drop filters into and out of Collections, and the order is saved per-account.

- Categories: filters, account
- Audience: power

### 66. `full-width-layout` — priority 30

**Switch to a wider content view with `w`**

Press `w` (no modifiers, outside inputs) to flip between centered and full-width content layout. Useful for wider notes, code-heavy prompts, or scanning long bookmark lists.

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

**Route cheap AI calls to small models, save big models for high-stakes**

BYOK lets you map each use case (Suggestions today; Transform, Auto-Complete, Chat coming soon) to a different model from a curated allowlist. Route cheap calls (tag suggestions) to a smaller model and reserve a larger model for higher-stakes cases.

- Categories: ai, account
- Audience: power
- minTier: pro (verify)

### 69. `extension-keyboard-save` — priority 22

**Save the current page without leaving the keyboard**

Press `{{shortcut:extension.openPopup}}` to open the Tiddly popup, then hit Enter to save — focus lands on the Save button automatically. On restricted pages like `chrome://newtab/` the popup opens to Search with the input focused, so you can find a bookmark without touching the mouse either. Rebind the shortcut at `chrome://extensions/shortcuts` if it conflicts with another extension.

- Categories: extension, shortcuts
- Audience: all
- shortcut: ['Alt', 'Shift', 'S']
- relatedDocs: [Chrome extension → /docs/extensions/chrome](/docs/extensions/chrome)

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

**Tune the editor view from the keyboard with `⌥+Z/L/M/T`**

`⌥+Z` toggles word wrap, `⌥+L` toggles line numbers, `⌥+M` toggles monospace font, and `⌥+T` opens the Table of Contents sidebar. Preferences persist across sessions.

- Categories: editor
- Audience: power

### 74. `jump-to-line` — priority 35

**Jump to a specific line in the editor with `⌘+⌥+G`**

Press `⌘+⌥+G` to open a small "go to line" prompt. Pair with line numbers (`⌥+L`) on long notes to navigate quickly.

- Categories: editor
- Audience: power
- shortcut: ['⌘', '⌥', 'G']

### 77. `shift-click-linked-chip` — priority 35

**Open a linked bookmark inside Tiddly with `Shift+click`**

When a bookmark is linked from another note, prompt, or bookmark, clicking the chip opens the URL in a new tab. Hold `Shift` while clicking instead to navigate to the bookmark's detail page in Tiddly — useful when you want to edit metadata or relationships.

- Categories: bookmarks
- Audience: power

### 79. `search-quoted-phrase` — priority 40 (seed, refine)

**Sharpen search results with quoted phrases, `-term`, and `OR`**

Wrap a phrase in quotes — e.g. `"machine learning"` — to match it exactly. Use `-term` to exclude matches (`python -django`). Use `OR` to widen across synonyms (`python OR ruby`). Combine them: `"web framework" -django OR rails`. Without operators, words become AND clauses and stemming may match variants like `learn` for `learning`.

- Categories: search
- Audience: all
- starter: true, starterPriority: 6
- areas: ['/app/content']
- relatedDocs: [Search → /docs/features/search](/docs/features/search)
- **Refinement note**: existing seed extended to cover all three operators (quoted phrase + `-term` exclusion + `OR` widening). Could also be re-prioritized lower (e.g., 20) once it covers the broader story.

### 80. `shortcut-select-next-occurrence` — priority 50 (seed, refine)

**Select the next match — or every match — to rename them together**

With your cursor on a word in a note or prompt, press `⌘+D` to extend the selection to the next match — repeat to add more, then type once and they all rename together. Use `⌘+⇧+L` instead to grab every match in one shot.

- Categories: shortcuts, editor
- Audience: power
- shortcut: ['⌘', 'D']
- areas: ['/app/notes', '/app/prompts']
- relatedDocs: [Keyboard shortcuts → /docs/features/shortcuts](/docs/features/shortcuts)
- **Refinement note**: existing seed extended to mention `⌘+⇧+L` for select-all-matches.

### 81. `search-dialog-vs-filter-search` — priority 18

**The search dialog ranks by relevance; in-filter search doesn't**

Tiddly has two search surfaces. The **search dialog** (press `/`) ranks results by relevance — the closer your query matches, the higher it lands. The **search input inside a saved filter or list view** doesn't rank; it just filters the list and keeps it in the filter's chosen sort (date modified, title, etc.). So if you type the exact name of a note, the dialog puts it at the top while the in-filter search may bury it under newer items. Use the dialog when you remember *what* you're looking for; use in-filter search when you're narrowing *within* a sort context.

- Categories: search, shortcuts
- Audience: all
- shortcut: ['/']
- relatedDocs: [Search → /docs/features/search](/docs/features/search)
- **Origin**: [KAN-133](https://tiddly.atlassian.net/browse/KAN-133) — filed as a search-ranking bug, turned out to be a surface-mismatch confusion.

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
