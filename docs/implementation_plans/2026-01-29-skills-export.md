# Implementation Plan: Skills Export Feature

## Overview

Export prompts as Claude/Codex skills via a new API endpoint. Skills are markdown files (`SKILL.md`) that AI assistants can auto-invoke based on context OR invoke manually.

**Problem:** The user has prompts (like `python-coding-guidelines`) that are better suited as auto-invoked skills rather than user-initiated prompts. Skills work across Claude Code, Claude Desktop, and Codex, making them a universal format.

**Solution:**
1. Tag prompts with `skill` (or any custom tag) to mark them for export
2. New API endpoint exports matching prompts as a tar.gz containing `{prompt-name}/SKILL.md` files
3. Users run a single curl command to sync skills to their local directories

---

## Research: Platform Comparison

### Skills Support by Platform

| Platform | Installation | Manual Invocation | Auto-Invocation | Our Export Support |
|----------|--------------|-------------------|-----------------|-------------------|
| **Claude Code** | `~/.claude/skills/` or `.claude/skills/` | `/skill-name` slash command | Yes (by model) | Direct (tar.gz) |
| **Claude Desktop** | Upload `.zip` via Settings → Capabilities | Natural language only | Yes (by model) | Manual repackage needed |
| **Codex CLI** | `~/.codex/skills/` | `$skill-name` prefix | Yes (by model) | Direct (tar.gz) |
| **ChatGPT** | Built-in only (in `/home/oai/skills`) | Natural language only | Yes (by model) | Not supported |

### Key Findings

**Claude Code** is the most feature-rich:
- Skills can be invoked via `/skill-name` slash command (the `name` field becomes the command)
- Skills merged with slash commands in v2.1.3 (January 2026)
- Model can also auto-invoke based on `description` matching the task
- Full filesystem and script execution support
- **Direct tar.gz support** - extract directly to skills directory

**Claude Desktop**:
- Skills uploaded as `.zip` files through Settings → Capabilities → Skills
- No slash commands - invoke via natural language ("use my code review skill")
- No network access - skills can't fetch from internet or hit APIs
- **Requires manual repackaging** - user must extract tar.gz, then zip individual skill folders for upload

**Codex CLI**:
- Uses `$skill-name` syntax (NOT slash commands)
- `/skills` is a built-in command to list/select skills, not invoke them
- Can type `$` to mention a skill in your prompt
- Skills currently behind feature flag: `codex --enable skills`
- **Direct tar.gz support** - extract directly to skills directory

**ChatGPT**:
- Skills feature still in development (codenamed "hazelnuts")
- Only OpenAI's built-in skills exist in Code Interpreter's `/home/oai/skills`
- User skill upload not yet available
- **Not supported** by our export feature

### Sources

- [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills - OpenAI Codex](https://developers.openai.com/codex/skills/)
- [Create skills - OpenAI Codex](https://developers.openai.com/codex/skills/create-skill/)
- [Slash commands in Codex CLI](https://developers.openai.com/codex/cli/slash-commands/)
- [The Definitive Guide to Claude SKILLS](https://limitededitionjonathan.substack.com/p/the-definitive-guide-to-claude-skills)
- [OpenAI are quietly adopting skills - Simon Willison](https://simonwillison.net/2025/Dec/12/openai-skills/)

---

## Research: SKILL.md Format Specification

### Required Fields (All Platforms)

The Agent Skills specification (adopted by both Anthropic and OpenAI) requires only:

```yaml
---
name: skill-name        # Required: max 100 chars, lowercase-with-hyphens
description: What it does and when to use it  # Required: max 500 chars
---

Markdown instructions here...
```

**There is NO formal "arguments" section in the specification.** The body is free-form Markdown.

### Optional Frontmatter Fields (Claude Code)

Claude Code supports additional frontmatter options:

| Field | Description |
|-------|-------------|
| `disable-model-invocation` | Set `true` to prevent auto-invocation (manual `/name` only) |
| `user-invocable` | Set `false` to hide from `/` menu (model-only) |
| `allowed-tools` | Tools Claude can use without permission when skill is active |
| `context` | Set `fork` to run in isolated subagent |
| `argument-hint` | Hint shown during autocomplete, e.g., `[filename] [format]` |

### Arguments: Claude Code's Runtime System

Claude Code has a **runtime argument system** for skills (different from our Jinja2 template variables):

| Syntax | Description |
|--------|-------------|
| `$ARGUMENTS` | All arguments passed when invoking the skill |
| `$ARGUMENTS[N]` | Access specific argument by 0-based index |
| `$0`, `$1`, `$2` | Shorthand for `$ARGUMENTS[0]`, etc. |

**Example:**
```yaml
---
name: fix-issue
description: Fix a GitHub issue
---

Fix GitHub issue $ARGUMENTS following our coding standards.
```

When user runs `/fix-issue 123`, Claude receives "Fix GitHub issue 123 following our coding standards."

**This is different from our Jinja2 template variables.** Our prompts use `{{ code }}` which is a placeholder the LLM fills in contextually. Claude Code's `$ARGUMENTS` is for explicit user-provided values at invocation time.

### Implication for Export

Our exported skills will contain Jinja2 syntax (`{{ variable }}`). This is fine because:
1. LLMs understand Jinja2 and can infer what to substitute
2. The variables are documented in the description
3. This matches how skills with contextual placeholders work

We do NOT convert to `$ARGUMENTS` syntax because:
1. Our prompts don't have positional arguments
2. `$ARGUMENTS` is for explicit user input, not contextual inference
3. Jinja2 is more expressive (filters, defaults, conditionals)

---

## Background: Skills vs MCP Prompts

| Feature | MCP Prompts | Skills |
|---------|-------------|--------|
| Invocation | User-initiated (`/prompt-name` in Claude Code) | Auto-invoked OR manual (`/skill-name`, `$skill-name`, natural language) |
| Arguments | Formal argument definitions with types | No formal system; documented in body or use `$ARGUMENTS` |
| Support | Claude Code only (via MCP) | Claude Code, Claude Desktop, Codex |
| Location | MCP server | Local filesystem (tar.gz) or uploaded `.zip` |
| Execution | Always user-triggered | Model decides OR user triggers |

**Key insight:** Skills are the universal format. Exporting prompts as skills makes them usable across all platforms.

---

## SKILL.md Format (Our Export)

Based on the research, our export format:

```markdown
---
name: code-review
description: Review code for bugs, style issues, and improvements. Requires: code. Optional: language.
---

## Template Variables

This skill uses template variables that you should fill in contextually:

- **{{ code }}** (required): The code to review
- **{{ language }}** (optional): Programming language (defaults to auto-detect)

## Instructions

Review the following {{ language | default('') }} code for:
- Bugs and potential issues
- Style improvements
- Performance optimizations

{{ code }}
```

**Design decisions:**
1. **Keep Jinja2 syntax** - LLMs understand it and can substitute contextually
2. **Document variables in body** - Helps both humans and LLMs understand what's needed
3. **Include in description** - "Requires: X. Optional: Y." helps model decide when to use skill
4. **No conversion to `$ARGUMENTS`** - Our variables are contextual, not positional user input

**Directory structure in tarball:**
```
code-review/
  SKILL.md
git-commit/
  SKILL.md
python-coding-guidelines/
  SKILL.md
```

---

## Sync Commands

### macOS / Linux (single piped command)

```bash
# Claude Code
curl -sH "Authorization: Bearer $PROMPTS_TOKEN" \
  "https://prompts-mcp.tiddly.me/api/prompts/export/skills?tag=skill" \
  | tar -xzf - -C ~/.claude/skills/

# Codex
curl -sH "Authorization: Bearer $PROMPTS_TOKEN" \
  "https://prompts-mcp.tiddly.me/api/prompts/export/skills?tag=skill" \
  | tar -xzf - -C ~/.codex/skills/
```

### Windows (PowerShell - Windows 10+)

```powershell
$url = "https://prompts-mcp.tiddly.me/api/prompts/export/skills?tag=skill"
$tmp = "$env:TEMP\skills.tar.gz"
curl.exe -sH "Authorization: Bearer $env:PROMPTS_TOKEN" $url -o $tmp
tar -xzf $tmp -C "$env:USERPROFILE\.claude\skills"
Remove-Item $tmp
```

---

## Milestone 1: Conversion Function and API Endpoint

### Goal

Create the `prompt_to_skill_md()` conversion function and `GET /prompts/export/skills` endpoint that returns a tar.gz archive.

### Success Criteria

- `prompt_to_skill_md()` correctly converts prompts to SKILL.md format
- Endpoint returns a valid tar.gz with `{prompt-name}/SKILL.md` structure
- Supports filtering by tag (default: `skill`)
- Supports `tag_match` parameter (`all` or `any`, default: `all`)
- Supports `view` parameter (`active`, `archived`, `deleted`, default: `active`)
- Returns empty tar.gz (valid archive with no entries) when no prompts match
- Authentication uses `get_current_user` (allows PAT access for sync scripts)

### Key Changes

**New file: `backend/src/services/skill_converter.py`**

Conversion function that transforms a prompt to SKILL.md format:

```python
def prompt_to_skill_md(prompt: Prompt) -> str:
    """
    Convert a prompt to SKILL.md format for Claude/Codex skills.

    The SKILL.md format includes:
    - YAML frontmatter with name and description (required by spec)
    - Template Variables section documenting Jinja2 placeholders (optional)
    - Instructions section with the raw Jinja2 template content

    Template variables are documented in the body because skills don't have
    formal argument definitions. LLMs understand Jinja2 syntax and can infer
    what to substitute based on context.
    """
    ...
```

Key conversion logic:
- Use `prompt.name` for the skill name (already lowercase-with-hyphens)
- Build description from `prompt.description`, appending "Requires: ..." and "Optional: ..." based on arguments
- If no description, use `prompt.title` or fall back to a generic "Skill: {name}"
- Generate `## Template Variables` section if prompt has arguments, listing each with required/optional marker and the `{{ name }}` syntax
- `## Instructions` section contains the raw Jinja2 template (`prompt.content`)
- Handle edge cases: no arguments, no description, no content

**Update: `backend/src/api/routers/prompts.py`**

Add the export endpoint:

```python
@router.get("/export/skills")
async def export_skills(
    tag: str = Query(default="skill", description="Tag to filter prompts for export"),
    tag_match: Literal["all", "any"] = Query(default="all", description="Tag matching mode"),
    view: Literal["active", "archived", "deleted"] = Query(default="active", description="View filter"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> StreamingResponse:
    """
    Export prompts as Claude/Codex skills in tar.gz format.

    Returns a tarball containing {prompt-name}/SKILL.md for each matching prompt.
    Use with: curl ... | tar -xzf - -C ~/.claude/skills/
    """
    ...
```

Implementation notes:
- Query prompts using existing `PromptService.search()` with `tags=[tag]`, `tag_match=tag_match`, `view=view`
- Build tarball in memory using `tarfile` and `io.BytesIO`
- Each prompt becomes `{prompt.name}/SKILL.md` in the archive
- Return `StreamingResponse` with `media_type="application/gzip"` and appropriate headers
- Set `Content-Disposition: attachment; filename=skills.tar.gz`

**Tarball generation pattern:**

```python
import tarfile
import io
from datetime import datetime

buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
    for prompt in prompts:
        skill_md = prompt_to_skill_md(prompt)
        content = skill_md.encode("utf-8")

        # Create TarInfo for the file
        info = tarfile.TarInfo(name=f"{prompt.name}/SKILL.md")
        info.size = len(content)
        info.mtime = int(datetime.now().timestamp())

        tar.addfile(info, io.BytesIO(content))

buffer.seek(0)
return StreamingResponse(
    buffer,
    media_type="application/gzip",
    headers={"Content-Disposition": "attachment; filename=skills.tar.gz"},
)
```

### Testing Strategy

**New file: `backend/tests/services/test_skill_converter.py`**

Unit tests for `prompt_to_skill_md()`:

1. **Basic conversion:** Prompt with name, description, arguments, content → valid SKILL.md
2. **Required and optional arguments:** Verify "Requires:" and "Optional:" in description
3. **Template variables section:** Verify `## Template Variables` section lists variables with `{{ name }}` syntax
4. **No arguments:** Prompt without arguments → no "## Template Variables" section, no "Requires/Optional" in description
5. **No description:** Falls back to title or generic description
6. **No title or description:** Uses generic "Skill: {name}"
7. **No content:** Handles gracefully (empty Instructions section)
8. **Jinja2 preserved:** Template syntax ({{ var }}, {% if %}, filters) preserved in output
9. **YAML frontmatter valid:** Output starts with `---\nname: ...\n---`
10. **Description length:** Verify description doesn't exceed 500 chars (spec limit)

**New file: `backend/tests/api/test_prompts_export.py`**

API endpoint tests:

1. **Basic export:** Create prompts with `skill` tag, verify tar.gz contains correct SKILL.md files
2. **Tag filtering:** Create prompts with different tags, verify only matching ones exported
3. **tag_match=any:** Create prompts, verify OR matching works
4. **tag_match=all:** Create prompts with multiple tags, verify AND matching works
5. **View filter:** Create active and archived prompts, verify `view` parameter works
6. **Empty result:** No prompts match → valid empty tar.gz (extractable, no files)
7. **Response headers:** Verify Content-Type, Content-Disposition
8. **Directory structure:** Verify `{name}/SKILL.md` structure in tarball
9. **Auth required:** 401 without authentication
10. **PAT access allowed:** Verify PAT works (not Auth0-only)

### Dependencies

None - this is the first milestone.

### Risk Factors

- **Prompt names:** Prompt names should already be valid directory names (lowercase-with-hyphens). Verify no edge cases with special characters.
- **Large exports:** Many prompts with large content could create large tarballs. Consider if streaming is needed (current in-memory approach is fine for reasonable sizes).

---

## Milestone 2: Frontend Instructions

### Goal

Display instructions on the Settings page for syncing skills to each supported client.

### Success Criteria

- Settings page shows instructions for Claude Code, Codex, and Claude Desktop
- Each client has appropriate sync command or manual steps
- User can easily copy commands

### Key Changes

**Update: `frontend/src/pages/settings/SettingsMCP.tsx`** (or appropriate settings page)

Add a "Skills Export" section with tabs or expandable sections for each client:

```markdown
## Export as Skills

Export your prompts tagged with "skill" as SKILL.md files for use in AI coding assistants.

### Claude Code

Sync directly to your skills directory:

```bash
curl -sH "Authorization: Bearer YOUR_PAT" \
  "https://prompts-mcp.tiddly.me/api/prompts/export/skills?tag=skill" \
  | tar -xzf - -C ~/.claude/skills/
```

Skills will be available as `/skill-name` slash commands and auto-invoked when relevant.

### Codex CLI

Sync directly to your skills directory:

```bash
curl -sH "Authorization: Bearer YOUR_PAT" \
  "https://prompts-mcp.tiddly.me/api/prompts/export/skills?tag=skill" \
  | tar -xzf - -C ~/.codex/skills/
```

Enable skills with `codex --enable skills`. Invoke with `$skill-name` or let Codex auto-select.

### Claude Desktop

Claude Desktop requires `.zip` uploads. Manual steps:

1. Download and extract the tar.gz:
   ```bash
   curl -sH "Authorization: Bearer YOUR_PAT" \
     "https://prompts-mcp.tiddly.me/api/prompts/export/skills?tag=skill" \
     -o skills.tar.gz && tar -xzf skills.tar.gz
   ```

2. Zip each skill folder individually:
   ```bash
   cd skills && for d in */; do zip -r "${d%/}.zip" "$d"; done
   ```

3. Upload each `.zip` file in Claude Desktop → Settings → Capabilities → Skills

Invoke skills via natural language (e.g., "use my code review skill").
```

### Testing Strategy

- Manual verification that instructions display correctly
- Verify the API URL is correct for the environment
- Test the actual commands work as documented

### Dependencies

Milestone 1

### Risk Factors

- **UX complexity:** Three different clients with different instructions. Consider tabs, accordion, or separate sections for clarity.
- **Claude Desktop workflow:** The manual repackaging is cumbersome. Consider future enhancement to support `.zip` export format.

---

## Summary of Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/src/services/skill_converter.py` | `prompt_to_skill_md()` conversion function |
| `backend/tests/services/test_skill_converter.py` | Unit tests for conversion |
| `backend/tests/api/test_prompts_export.py` | API endpoint tests |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/api/routers/prompts.py` | Add `GET /prompts/export/skills` endpoint |
| `frontend/src/pages/settings/SettingsMCP.tsx` | Add skills export instructions for each client |

---

## Notes for Implementation

1. **No database changes:** Uses existing tags system. Users tag prompts with `skill` (or any tag) via the existing UI/API.

2. **Authentication:** Use `get_current_user` (not `_auth0_only`) to allow PAT access. Sync scripts need to work with PATs. Rate limits apply normally.

3. **Existing service reuse:** The endpoint should use `PromptService.search()` for querying, which already handles tag filtering, view filters, and pagination. Since we're exporting all matches (not paginating), either:
   - Use a high limit, or
   - Implement a generator/streaming approach if large exports become a concern

4. **tar.gz only:** Per discussion, only tar.gz is supported (not zip). tar.gz works on macOS, Linux, and Windows 10+ natively.

5. **Jinja2 vs $ARGUMENTS:** Our prompts use Jinja2 template variables (`{{ code }}`, `{{ language | default('') }}`). These are **contextual placeholders** that the LLM fills in based on the conversation. This is different from Claude Code's `$ARGUMENTS` system which is for **explicit user input** at invocation time (e.g., `/fix-issue 123`). We keep Jinja2 syntax because:
   - LLMs understand Jinja2 and can infer substitutions
   - Our variables are contextual, not positional
   - Jinja2 supports filters and defaults

6. **Description length limit:** The Agent Skills spec limits descriptions to 500 characters. If `prompt.description` + "Requires: ..." + "Optional: ..." exceeds this, truncate intelligently or omit the Requires/Optional suffix.

7. **Edge case - empty tag:** If user passes `tag=""`, should return all prompts or error? Recommend: treat empty tag as "no tag filter" and return all active prompts. Or reject with 400. The implementing agent should decide and test.

8. **Platform compatibility:** The exported tar.gz works directly on Claude Code and Codex. Claude Desktop requires `.zip` format, so users must manually extract and repackage:
   - **Claude Code / Codex:** Extract tar.gz directly to skills directory (single command)
   - **Claude Desktop:** Extract tar.gz, zip each skill folder individually, upload via Settings
   - **ChatGPT:** Not supported (no user skill upload available)
