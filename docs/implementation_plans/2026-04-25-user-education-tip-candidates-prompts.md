# Tip candidates — prompts (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

**Verification flag (see Follow-ups section in the plan):** several tips below claim Jinja2 features working through the API → template-renderer pipeline. Before authoring those tips in M5, write unit tests confirming the API path actually exposes the claimed behavior. Tips needing verification are marked `verify`.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Preview a prompt to test it before agents see it | 15 | **Merged with #11** — combined into one tip about the Preview dialog as both sandbox (testing before MCP) and one-off renderer (copy the rendered output to clipboard). |
| 2 | `{%- if %}` whitespace control | 20 (verify) | **Canonical home** for `docs-sweep:10`. Foundational Jinja behavior; verify via unit test that the API renders this correctly. |
| 3 | Tag a prompt with `skill` to export | dup | `cli:7` (priority 15) and `cli:D2` (priority 5) cover this. |
| 4 | Argument descriptions are read by the AI agent | 20 | **Canonical home** for `docs-sweep:13` (refined: "AI assistants see your prompt's full metadata"). |
| 5 | Generate arguments from your template with one click | dup | `ai:4` (priority 15). |
| 6 | Jinja2 filters: `\| default("...")`, `\| upper`, `\| join(", ")` | 25 (verify) | Strong power-user authoring tip. **Verify via unit test** that filters work through the API render path. |
| 7 | Prompt names follow strict kebab-case | drop | Validation; auto-lowercased on type. |
| 8 | Required vs optional changes how agents fill arguments | 20 | Real authoring decision. |
| 9 | Templates use strict undefined — typos surface immediately | 25 | **Canonical home** for `docs-sweep:11`. Confirmed via `template_renderer.py:21`. |
| 10 | Jinja2 comment `{# #}` for non-rendering notes | 30 (verify) | Real proactive feature. **Verify via unit test** that `{# #}` is stripped on render. |
| 11 | Copy rendered prompt from Preview dialog | merged | Merged into #1. |
| 12 | Quick-copy template content from list view | drop | Card-action; obvious. |
| 13 | Loop over list-typed argument with `{% for %}` | 25 (verify) | **Verify via unit test** that the API/MCP path accepts list-typed arguments and the renderer handles them. The argument schema may not currently express "list" — if it doesn't, this tip needs reframing or dropping. |
| 14 | Slash commands work in prompt editor with Jinja entries | dup | Will be folded into seed `note-slash-commands` per `editor:2 + 23` merge note. |
| 15 | `Cmd+Shift+S` saves and closes | dup | `editor:27` (priority 30). |
| 16 | `--tags`, `--tag-match` for skill export | drop | Too much CLI detail. |
| 17 | Project-scoped skills land in `.claude/skills/` | dup | `cli:8` (priority 25). |
| 18 | Use `description` to teach agents when to invoke (skill) | 20 | Strong skill-export authoring tip. |
| 19 | Save changes before previewing | drop | Defensive UX. |
| 20 | Prompts can link to notes and bookmarks for context | dup | `bookmarks:S7` (priority 20). |
| 21 | Prompt history — restore past version | dup | `notes:9` (priority 25, canonical for version-history). |
| S1 | Argument names underscore vs prompt names hyphen | drop | Validation plumbing. |
| S2 | Generate-all vs per-row sparkles mutually exclusive | drop | Internal UX. |
| S3 | Track-usage bumps `last_used_at` | drop | Auto-behavior. |
| S4 | Templates without arguments still render via Preview | drop | Niche. |
| S5 | Drafts in localStorage auto-cleaned | drop | Migration plumbing. |
| S6 | Pre-populate arguments from current tag filter | drop | Auto-behavior. |

## Final keepers (preserved details from the agent file)

### #1 (merged with #11) — The Preview dialog is your prompt sandbox — priority 15

On any saved prompt, click `Preview` (top-right toolbar) to fill in argument values and render the template. Useful for two flows:

- **Testing before MCP**: sanity-check Jinja conditionals, whitespace control, and argument descriptions before agents start using the prompt.
- **One-off rendering without MCP**: after rendering, click the copy icon next to "Prompt" to copy the fully-rendered output. Lets you paste a filled-in prompt into ChatGPT, Cursor, or anywhere else.

- Reference: `frontend/src/components/PreviewPromptModal.tsx:99,144`, `frontend/src/components/Prompt.tsx:927`
- Tags: workflow | new-user

### #2 — `{%- if %}` whitespace control — priority 20 (verify) — canonical home for `docs-sweep:10`

Use `{%- if optional_arg %}` (note the leading dash) instead of plain `{% if %}` around optional sections. The dash strips surrounding whitespace, so when the argument is empty you don't get blank lines in the rendered prompt. The editor's slash menu has an "If block (trim)" entry that inserts this for you.

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx:79`
- Tags: feature | power-user

### #4 — AI assistants see your prompt's full metadata — priority 20 — canonical home for `docs-sweep:13`

When an AI assistant fetches a prompt via MCP, it reads everything: prompt name, description, argument names, argument descriptions, and required/optional flags. The AI uses all of that to decide whether to invoke the prompt and what to pass for each argument. Treat the prompt and its arguments like docstrings — vague text leads to bad fills.

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx:43`, `backend/src/services/skill_converter.py:88`
- Tags: workflow | power-user

### #8 — Required vs optional changes how agents fill arguments — priority 20

A required argument must be supplied at render time (rendering errors otherwise); an optional one defaults to empty string. Make an argument required when you want the agent to fail loudly if it forgets context — make it optional when the prompt should still render usefully without it.

- Reference: `backend/src/services/template_renderer.py:62`, `frontend/src/components/ArgumentsBuilder.tsx:166`
- Tags: feature | new-user

### #18 — Use `description` to teach the agent when to invoke a skill — priority 20

When a prompt is exported as a skill, the description goes into the SKILL.md frontmatter and is what agents use to decide whether to invoke it. Write it like a trigger: *"Reviews a Python file for bugs and style issues. Use when the user pastes Python code."* Not just *"code review."*

- Reference: `backend/src/services/skill_converter.py:65`
- Tags: workflow | power-user

### #6 — Jinja2 filters for inline transforms (`| default`, `| upper`, `| join`) — priority 25 (verify)

Apply Jinja2 filters with the pipe syntax to transform argument values inline:

- `{{ note | default("(no notes provided)") }}` substitutes a fallback when an optional argument is empty.
- `{{ name | upper }}` uppercases the value.
- `{{ items | join(", ") }}` joins a list with commas.

Combine multiple filters: `{{ tags | default([]) | join(", ") }}`.

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx:87`
- Tags: feature | power-user

**Verification needed:** unit-test that the API → template-renderer path actually supports each of `| default`, `| upper`, `| join`. If a filter isn't supported, drop it from this tip's example list.

### #9 — Templates use strict undefined — typos surface immediately — priority 25 — canonical home for `docs-sweep:11`

Referencing a variable that isn't declared as an argument raises an error at render time instead of silently producing an empty string. The editor also catches this before save — undefined variables block saving with a "Template uses undefined variable(s)" error. Catches typos before they reach the agent.

- Reference: `backend/src/services/template_renderer.py:21`, `frontend/src/components/Prompt.tsx:631`
- Tags: feature | power-user

### #13 — Loop over a list-typed argument with `{% for %}` — priority 25 (verify) — DRAFT

Pass a list (or any iterable) and render it with `{% for item in items %}- {{ item }}\n{% endfor %}`. Agents calling your prompt can supply arrays for arguments — handy for things like "review these files" or "summarize these issues."

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx:91`
- Tags: workflow | power-user

**Verification needed (load-bearing):** the argument schema may not currently express list/iterable types — every argument might be string-typed at the API contract level. Before authoring this tip, unit-test:
1. Can a prompt declare an argument as a list/iterable type?
2. Does the API/MCP `get_prompt` accept a JSON array as an argument value?
3. Does the template renderer expose the value as iterable to the Jinja `{% for %}` loop?

If only string args are supported, either drop this tip or reframe to "agents can pass JSON-stringified lists; parse them with a Jinja filter" (which is uglier and may not be worth a tip).

### #10 — Add a Jinja2 comment to leave non-rendering notes — priority 30 (verify)

`{# this is a comment #}` is a Jinja2 comment — invisible in the rendered output. Useful for leaving instructions to your future self ("regenerate after schema migration") without polluting what the agent sees.

- Reference: `frontend/src/components/Prompt.tsx:85`
- Tags: feature | power-user

**Verification needed:** unit-test that `{# #}` comments are stripped on render through the API.

## Cross-category tracking

- `prompts:1` — local; merged from #11.
- `prompts:2` ⟵ canonical for `docs-sweep:10`.
- `prompts:4` ⟵ canonical for `docs-sweep:13`.
- `prompts:9` ⟵ canonical for `docs-sweep:11`.
- All `verify` tips — see plan's Follow-ups section for the API-Jinja unit-test requirement.
