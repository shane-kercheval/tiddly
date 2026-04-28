# Tip candidates — prompts

## Strong candidates (strongest first)

### Preview a prompt to test it before agents see it
- Description: On any saved prompt that has arguments, the `Preview` button (top-right toolbar) opens a dialog where you can fill in argument values and render the template. Useful for sanity-checking Jinja conditionals, whitespace control, and argument descriptions before relying on it through MCP.
- Reference: frontend/src/components/PreviewPromptModal.tsx:99, frontend/src/components/Prompt.tsx:927
- Tags: feature | new-user

### Wrap conditional sections with `{%- if %}` to keep output clean
- Description: Use `{%- if optional_arg %}` (note the leading dash) instead of plain `{% if %}` around optional sections. The dash strips surrounding whitespace, so when the argument is empty you don't get blank lines in the rendered prompt. The editor's slash menu has an "If block (trim)" entry that inserts this for you.
- Reference: frontend/src/pages/docs/DocsPrompts.tsx:79, frontend/src/utils/slashCommands.ts:96
- Tags: feature | power-user

### Tag a prompt with `skill` to export it as an Agent Skill
- Description: Prompts tagged `skill` get exported as SKILL.md files for Claude Code, Claude Desktop, or Codex via Settings → AI Integration (or `tiddly skills configure` in the CLI). Skills auto-invoke based on context — a prompt named `code-review` tagged `skill` becomes a skill the agent can pick up without you typing the prompt name.
- Reference: cli/cmd/skills.go:54, frontend/src/pages/docs/DocsPrompts.tsx:138, backend/src/services/skill_converter.py:38
- Tags: workflow | power-user

### Argument descriptions are read by the AI agent
- Description: When an AI agent calls your prompt via MCP, it sees each argument's description to decide what value to pass. A description like "PR diff in unified format" yields better results than leaving it blank — the model uses it to ground the value it provides.
- Reference: frontend/src/pages/docs/DocsPrompts.tsx:43, backend/src/services/skill_converter.py:88
- Tags: feature | new-user

### Generate arguments from your template with one click
- Description: After writing a template with `{{ placeholders }}`, click the sparkle icon in the Arguments header to have AI propose argument names, descriptions, and required flags for every placeholder you haven't defined yet. Per-row sparkles refine a single argument's blank fields.
- Reference: frontend/src/components/ArgumentsBuilder.tsx:317, frontend/src/hooks/useAIArgumentIntegration.ts:64
- Tags: feature | new-user

### Use `| default("...")` to keep optional args from rendering as empty
- Description: Optional arguments default to empty string when omitted. Use the Jinja filter `{{ note | default("No notes provided") }}` to substitute a fallback instead of producing blanks. Combine with `| upper`, `| join(", ")`, etc. for inline transforms.
- Reference: frontend/src/pages/docs/DocsPrompts.tsx:87
- Tags: feature | power-user

### Prompt names follow a strict kebab-case format
- Description: Prompt names must be lowercase letters, digits, and hyphens (e.g. `code-review`, `pr-summary-v2`). The name auto-lowercases as you type and is the identifier agents use through MCP — pick something descriptive and stable, since it ends up in the agent's tool list.
- Reference: frontend/src/constants/validation.ts:6, frontend/src/components/Prompt.tsx:751
- Tags: feature | new-user

### Required vs optional changes how agents fill arguments
- Description: A required argument must be supplied at render time (rendering errors otherwise); an optional one defaults to empty string. Make an argument required when you want the agent to fail loudly if it forgets context — make it optional when the prompt should still render usefully without it.
- Reference: backend/src/services/template_renderer.py:62, frontend/src/components/ArgumentsBuilder.tsx:166
- Tags: feature | new-user

### Templates use strict undefined — typos surface immediately
- Description: Referencing a variable that isn't declared as an argument raises an error at render time instead of silently producing an empty string. The editor also catches this before save — undefined variables block saving with a "Template uses undefined variable(s)" error. Catches typos before they reach the agent.
- Reference: backend/src/services/template_renderer.py:21, frontend/src/components/Prompt.tsx:631
- Tags: feature | power-user

### Add a Jinja2 comment to leave notes that don't render
- Description: `{# this is a comment #}` is a Jinja2 comment — invisible in the rendered output. Useful for leaving instructions to your future self ("regenerate after schema migration") without polluting what the agent sees.
- Reference: frontend/src/components/Prompt.tsx:85
- Tags: feature | power-user

### Copy the rendered prompt straight from the Preview dialog
- Description: After rendering a prompt in the Preview dialog, the copy icon next to "Prompt" copies the fully-rendered output to your clipboard. Lets you paste a one-off filled prompt into ChatGPT, Cursor, or anywhere else without going through MCP.
- Reference: frontend/src/components/PreviewPromptModal.tsx:144, frontend/src/components/PreviewPromptModal.tsx:47
- Tags: workflow | power-user

### Quick-copy a prompt's content from any list view
- Description: Hover a prompt card and click the copy icon to copy the raw template (with `{{ placeholders }}` intact) to clipboard — no need to open the prompt. Fast way to grab a template for editing somewhere else or pasting into a chat.
- Reference: frontend/src/components/PromptCard.tsx:256, frontend/src/components/ui/CopyContentButton.tsx:31
- Tags: feature | power-user

### Loop over a list-typed argument with `{% for %}`
- Description: Pass a list (or any iterable) and render it with `{% for item in items %}- {{ item }}\n{% endfor %}`. Agents calling your prompt can supply arrays for arguments — handy for things like "review these files" or "summarize these issues."
- Reference: frontend/src/pages/docs/DocsPrompts.tsx:91
- Tags: workflow | power-user

### Slash commands work in the prompt editor — including Jinja-specific ones
- Description: Type `/` at the start of a line in the editor to open a menu. The Jinja2 section (Variable, If block, If block trim) is the first group when editing a prompt — select one to insert the boilerplate without retyping braces.
- Reference: frontend/src/utils/slashCommands.ts:78, frontend/src/components/CodeMirrorEditor.tsx:646
- Tags: feature | new-user

### `Cmd+Shift+S` saves and closes the prompt in one shot
- Description: Cmd+S saves and stays in the editor; Cmd+Shift+S saves and closes back to the list. Useful when you've finished editing and want to jump back to where you came from without reaching for the close button.
- Reference: frontend/src/components/Prompt.tsx:516
- Tags: feature | power-user

### Filter prompts to a tag-set for skill export
- Description: `tiddly skills configure --tags python,api --tag-match all` only exports prompts that have *both* tags; `--tag-match any` exports prompts with at least one. Lets you maintain different skill packs (e.g. work vs personal) by tagging strategically.
- Reference: cli/cmd/skills.go:163, cli/cmd/skills.go:114
- Tags: workflow | power-user

### Project-scoped skills land in `.claude/skills/` instead of your home dir
- Description: `tiddly skills configure --scope directory` writes SKILL.md files to `.claude/skills/` or `.agents/skills/` in the current project. Commit them and your team gets the same prompts as project-local skills — no need for everyone to sync from Tiddly individually.
- Reference: cli/cmd/skills.go:162, cli/cmd/skills.go:121
- Tags: workflow | power-user

### Use the `description` field to teach the agent when to invoke a prompt
- Description: When a prompt is exported as a skill, the description goes into the SKILL.md frontmatter and is what agents use to decide whether to invoke it. Write it like a trigger: "Reviews a Python file for bugs and style issues. Use when the user pastes Python code." not just "code review."
- Reference: backend/src/services/skill_converter.py:65, frontend/src/components/Prompt.tsx:1060
- Tags: workflow | power-user

### Save changes before previewing a prompt
- Description: The Preview button is disabled while the editor has unsaved changes — preview always renders the *saved* version, not your in-progress edits. Save first, then preview, otherwise you'll be testing a stale template.
- Reference: frontend/src/components/Prompt.tsx:929
- Tags: feature | new-user

### Prompts can link to notes and bookmarks for context
- Description: Use the link icon in the prompt header to attach related content. A `code-review` prompt can link to your team's style-guide note; a `research-summary` prompt can link to source bookmarks. Linked content shows up in the prompt detail and is reachable from MCP via `get_context`.
- Reference: frontend/src/components/Prompt.tsx:1086, frontend/src/components/LinkedContentChips.tsx
- Tags: workflow | power-user

### Prompt history is automatic — restore any past version
- Description: Every save snapshots the prompt. Click the History icon in the toolbar to see prior versions and restore one. Useful when an AI-suggested rewrite or template tweak made the agent worse — roll back instead of trying to remember the wording.
- Reference: frontend/src/components/Prompt.tsx:944, frontend/src/components/HistorySidebar.tsx
- Tags: feature | power-user

## Speculative

### Argument names use underscores; prompt names use hyphens
- Description: Argument names must be `lower_snake_case` (must start with a letter; lowercase letters, digits, underscores). Prompt names are `kebab-case`. They look similar but the editor will reject the wrong one — useful to remember which is which when typing fast.
- Reference: frontend/src/constants/validation.ts:6, frontend/src/constants/validation.ts:9
- Tags: feature | power-user
- Hesitation: Validation feels like plumbing — only worth a tip if the inconsistency actually trips users.

### Generate-all and per-row sparkles are mutually exclusive in flight
- Description: While generate-all is running, per-row sparkles are disabled, and vice versa. Prevents index-shift races when both are operating on the arguments list.
- Reference: frontend/src/components/ArgumentsBuilder.tsx:121, frontend/src/components/ArgumentsBuilder.tsx:257
- Tags: feature | power-user
- Hesitation: This is a UX-of-AI-tools detail that most users won't notice unless they hit it.

### `track-usage` updates `last_used_at` whenever you open a prompt
- Description: Opening a prompt detail page in the app pings the backend to bump `last_used_at`, so sorting by "last used" surfaces what you've actually been working with. Sort menu in any prompt list.
- Reference: frontend/src/hooks/usePrompts.ts:82, frontend/src/pages/PromptDetail.tsx:135
- Tags: feature | power-user
- Hesitation: Useful but very passive — users may already infer this from the sort option existing.

### Templates without arguments still render via Preview
- Description: A static prompt (no `{{ }}` placeholders, no arguments) can still be opened in Preview — click Render to see the static content displayed. Doubles as a "view raw" surface for prompts you keep just for copy-paste.
- Reference: frontend/src/components/PreviewPromptModal.tsx:124
- Tags: feature | new-user
- Hesitation: Niche — most users will figure this out by clicking Preview anyway.

### Drafts in localStorage are auto-cleaned on prompt mount
- Description: An older Tiddly version stored in-progress drafts under `prompt_draft_*` keys in localStorage. Opening any prompt now deletes those orphans automatically — no action required.
- Reference: frontend/src/components/Prompt.tsx:487
- Tags: feature | new-user
- Hesitation: This is migration plumbing, not user-facing behavior worth surfacing.

### Pre-populate arguments from the current tag filter
- Description: When you create a prompt while a tag filter is active in the All Content view, those tags pre-populate on the new prompt. Saves a step if you organize prompts by topic and just clicked into "python" to find one.
- Reference: frontend/src/pages/PromptDetail.tsx:79, frontend/src/components/Prompt.tsx:226
- Tags: workflow | power-user
- Hesitation: Behavior is shared across all content types; may be better as a general "filters seed new items" tip rather than prompt-specific.
