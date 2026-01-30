# Implementation Plan: Skills Export Feature

## Overview

Export prompts as Claude/Codex skills via a new API endpoint. Skills are markdown files (`SKILL.md`) that AI assistants can auto-invoke based on context OR invoke manually.

**Problem:** The user has prompts (like `python-coding-guidelines`) that are better suited as auto-invoked skills rather than user-initiated prompts. Skills work across Claude Code, Claude Desktop, and Codex, making them a universal format.

**Solution:**
1. Optionally tag prompts to filter which ones to export (default: all prompts)
2. New API endpoint exports matching prompts as an archive containing `{prompt-name}/SKILL.md` files
3. Users configure export in Settings → AI Integrations and run a single command to sync

For complete platform specifications, see [Appendix A: Platform Specifications](#appendix-a-platform-specifications).

---

## SKILL.md Format (Our Export)

Our exported SKILL.md format follows the [Agent Skills Standard](https://agentskills.io):

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
1. **Keep Jinja2 syntax** - LLMs understand it and can substitute contextually (see [Appendix A.4](#a4-jinja2-vs-arguments))
2. **Document variables in body** - Helps both humans and LLMs understand what's needed
3. **Include in description** - "Requires: X. Optional: Y." helps model decide when to use skill
4. **No conversion to `$ARGUMENTS`** - Our variables are contextual, not positional user input

**Directory structure in archive:**
```
code-review/
  SKILL.md
git-commit/
  SKILL.md
python-coding-guidelines/
  SKILL.md
```

---

## Milestone 0: Infrastructure Changes

### Goal

Update app configuration limits and add `include_content` parameter to `BaseEntityService.search()`.

### Success Criteria

- `max_prompt_name_length` changed from 255 to 100
- `max_description_length` changed from 2000 to 1000
- `BaseEntityService.search()` supports `include_content: bool = False` parameter
- When `include_content=True`, full content is loaded (no defer)
- When `include_content=False`, content is deferred (current behavior)
- Unit tests for the new parameter

### Key Changes

**Update: `backend/src/core/config.py`**

```python
max_prompt_name_length: int = Field(
    default=100,  # Changed from 255
    validation_alias="VITE_MAX_PROMPT_NAME_LENGTH",
)
# ...
max_description_length: int = Field(
    default=1000,  # Changed from 2000
    validation_alias="VITE_MAX_DESCRIPTION_LENGTH",
)
```

**Update: `backend/src/services/base_entity_service.py`**

Add `include_content` parameter to `search()`:

```python
async def search(
    self,
    db: AsyncSession,
    user_id: UUID,
    query: str | None = None,
    tags: list[str] | None = None,
    tag_match: Literal["all", "any"] = "all",
    sort_by: Literal[...] = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: int = 50,
    view: Literal["active", "archived", "deleted"] = "active",
    filter_expression: dict | None = None,
    include_content: bool = False,  # NEW PARAMETER
) -> tuple[list[T], int]:
    """
    Search and filter entities for a user with pagination.

    Args:
        ...
        include_content: If True, load full content. If False (default), defer content
                        loading and only compute content_length/content_preview.
    """
    # Build options based on whether content is needed
    if include_content:
        options = [selectinload(self.model.tag_objects)]
    else:
        options = [defer(self.model.content), selectinload(self.model.tag_objects)]

    base_query = (
        select(
            self.model,
            func.length(self.model.content).label("content_length"),
            func.left(self.model.content, CONTENT_PREVIEW_LENGTH).label("content_preview"),
        )
        .options(*options)
        .where(self.model.user_id == user_id)
    )
    # ... rest unchanged
```

### Testing Strategy

**Update: `backend/tests/services/test_base_entity_service.py`** (or appropriate test file)

1. **include_content=False (default):** Verify content is not loaded (deferred), content_length and content_preview are populated
2. **include_content=True:** Verify full content is loaded, content_length and content_preview still populated
3. **Pagination still works:** Verify offset/limit work with include_content=True

### Dependencies

None - this is the first milestone.

### Risk Factors

- **Breaking change for config:** Changing max lengths may affect existing data. See migration audit below.

### Migration Audit (Required Before Deployment)

Before deploying the config changes, run this query to identify affected data:

```sql
SELECT id, name, LENGTH(name) as name_len, LENGTH(description) as desc_len
FROM prompts
WHERE LENGTH(name) > 100 OR LENGTH(description) > 1000;
```

**If results found:**
- Names >100 chars: These prompts can still be read but cannot be edited without truncating the name
- Descriptions >1000 chars: Same behavior - readable but not editable without truncation

**Decision:** If violations exist, choose one of:
1. **Grandfather existing data** - Allow reads, block edits until user truncates (recommended)
2. **Auto-truncate** - Migration script truncates existing data (data loss risk)
3. **Delay deployment** - Wait until manual cleanup is done

---

## Milestone 1: Conversion Function and API Endpoint

### Goal

Create the `prompt_to_skill_md()` conversion function and `GET /prompts/export/skills` endpoint with client-specific export behavior.

### Success Criteria

- `prompt_to_skill_md()` correctly converts prompts to SKILL.md format with client-specific truncation (see [Appendix A.1](#a1-platform-constraints-summary))
- Endpoint returns a valid archive with `{prompt-name}/SKILL.md` structure
- Supports `client` parameter (`claude-code`, `claude-desktop`, `codex`)
- Archive format determined by client (see [Appendix A.1](#a1-platform-constraints-summary))
- Supports filtering by `tags` (list, default: no filter = all prompts)
- Supports `tag_match` parameter (`all` or `any`, default: `all`)
- Supports `view` parameter (`active`, `archived`, `deleted`, default: `active`)
- Handles pagination internally (loops until all matching prompts retrieved)
- Returns empty archive (valid, extractable, no entries) when no prompts match
- Authentication uses `get_current_user` (allows PAT access for sync scripts)

### Key Changes

**New file: `backend/src/services/skill_converter.py`**

Conversion function with client-specific behavior per [Appendix A.1](#a1-platform-constraints-summary):

```python
from dataclasses import dataclass
from typing import Literal

import yaml

ClientType = Literal["claude-code", "claude-desktop", "codex"]

# Client-specific constraints (from Appendix A.1)
CLIENT_CONSTRAINTS = {
    "claude-code": {"name_max": 64, "desc_max": 1024, "desc_single_line": False},
    "claude-desktop": {"name_max": 64, "desc_max": 1024, "desc_single_line": False},
    "codex": {"name_max": 100, "desc_max": 500, "desc_single_line": True},
}


@dataclass
class SkillExport:
    """Result of converting a prompt to a skill."""
    directory_name: str  # Sanitized name for archive directory (matches frontmatter)
    content: str         # Full SKILL.md content


def prompt_to_skill_md(prompt: Prompt, client: ClientType) -> SkillExport:
    """
    Convert a prompt to SKILL.md format for the specified client.

    The SKILL.md format includes:
    - YAML frontmatter with name and description (required by spec)
    - Template Variables section documenting Jinja2 placeholders (optional)
    - Instructions section with the raw Jinja2 template content

    Client-specific behavior:
    - claude-code/claude-desktop: name truncated to 64 chars, desc to 1024 chars
    - codex: name truncated to 100 chars, desc to 500 chars, newlines collapsed

    Args:
        prompt: The Prompt model instance.
        client: Target client for export.

    Returns:
        SkillExport with directory_name and content.
        The directory_name matches the frontmatter name (required by Agent Skills spec).
    """
    constraints = CLIENT_CONSTRAINTS[client]

    # Truncate name if needed (this becomes both frontmatter name AND directory name)
    name = prompt.name[:constraints["name_max"]]

    # Build description with argument hints
    desc = prompt.description or prompt.title or f"Skill: {prompt.name}"
    if prompt.arguments:
        required = [a for a in prompt.arguments if a.get("required")]
        optional = [a for a in prompt.arguments if not a.get("required")]
        if required:
            desc += f" Requires: {', '.join(a['name'] for a in required)}."
        if optional:
            desc += f" Optional: {', '.join(a['name'] for a in optional)}."

    # Apply client-specific description constraints
    if constraints["desc_single_line"]:
        desc = " ".join(desc.split())  # Collapse all whitespace to single spaces
    desc = desc[:constraints["desc_max"]]

    # Build template variables section
    template_vars_section = ""
    if prompt.arguments:
        template_vars_section = "## Template Variables\n\n"
        template_vars_section += "This skill uses template variables that you should fill in contextually:\n\n"
        for arg in prompt.arguments:
            req = "(required)" if arg.get("required") else "(optional)"
            desc_text = arg.get("description") or "No description"
            template_vars_section += f"- **{{{{ {arg['name']} }}}}** {req}: {desc_text}\n"
        template_vars_section += "\n"

    # Handle missing content gracefully (defensive - shouldn't happen via API)
    body_content = prompt.content or ""

    # Build frontmatter with proper YAML escaping
    # This handles special characters like : # and multi-line descriptions correctly
    frontmatter = yaml.safe_dump(
        {"name": name, "description": desc},
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    ).strip()

    content = f"""---
{frontmatter}
---

{template_vars_section}## Instructions

{body_content}
"""

    return SkillExport(directory_name=name, content=content)
```

**Update: `backend/src/api/routers/prompts.py`**

Add the export endpoint:

```python
from typing import Literal
from services.skill_converter import prompt_to_skill_md, ClientType

@router.get("/export/skills")
async def export_skills(
    client: ClientType = Query(..., description="Target client for export"),
    tags: list[str] = Query(default=[], description="Tags to filter prompts (empty = all prompts)"),
    tag_match: Literal["all", "any"] = Query(default="all", description="Tag matching mode"),
    view: Literal["active", "archived", "deleted"] = Query(default="active", description="View filter"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> StreamingResponse:
    """
    Export prompts as skills for the specified client.

    Returns an archive containing {prompt-name}/SKILL.md for each matching prompt.
    Archive format is determined by client:
    - claude-desktop: zip (for upload via Settings)
    - claude-code, codex: tar.gz (for direct extraction)

    If no tags specified, exports ALL prompts.
    """
    # Collect all matching prompts (handle pagination internally)
    all_prompts = []
    offset = 0
    limit = 100

    while True:
        prompts, total = await prompt_service.search(
            db=db,
            user_id=current_user.id,
            tags=tags if tags else None,  # None = no tag filter
            tag_match=tag_match,
            view=view,
            offset=offset,
            limit=limit,
            include_content=True,  # Need full content for export
        )
        all_prompts.extend(prompts)
        if len(all_prompts) >= total:
            break
        offset += limit

    # Determine archive format based on client
    if client == "claude-desktop":
        archive = create_zip(all_prompts, client)
        return StreamingResponse(
            archive,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=skills.zip"},
        )
    else:
        archive = create_tar_gz(all_prompts, client)
        return StreamingResponse(
            archive,
            media_type="application/gzip",
            headers={"Content-Disposition": "attachment; filename=skills.tar.gz"},
        )


def create_tar_gz(prompts: list[Prompt], client: ClientType) -> io.BytesIO:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for prompt in prompts:
            skill = prompt_to_skill_md(prompt, client)
            content_bytes = skill.content.encode("utf-8")
            # Use skill.directory_name (truncated) to match frontmatter name
            info = tarfile.TarInfo(name=f"{skill.directory_name}/SKILL.md")
            info.size = len(content_bytes)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(content_bytes))
    buffer.seek(0)
    return buffer


def create_zip(prompts: list[Prompt], client: ClientType) -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for prompt in prompts:
            skill = prompt_to_skill_md(prompt, client)
            # Use skill.directory_name (truncated) to match frontmatter name
            zf.writestr(f"{skill.directory_name}/SKILL.md", skill.content)
    buffer.seek(0)
    return buffer
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
7. **No content:** Handles gracefully (empty Instructions section) - defensive test
8. **Jinja2 preserved:** Template syntax ({{ var }}, {% if %}, filters) preserved in output
9. **YAML frontmatter valid:** Output starts with `---\nname: ...\n---`
10. **Name truncation (claude-code):** Name >64 chars truncated to 64
11. **Name truncation (codex):** Name >100 chars truncated to 100
12. **Description truncation (claude-code):** Description >1024 chars truncated
13. **Description truncation (codex):** Description >500 chars truncated
14. **Description single-line (codex):** Multi-line description collapsed to single line
15. **Description multi-line (claude-code):** Multi-line description preserved
16. **YAML escaping - colon:** Description with `:` character produces valid YAML
17. **YAML escaping - hash:** Description with `#` character is not treated as comment
18. **YAML escaping - quotes:** Description with quotes produces valid YAML
19. **Directory name matches frontmatter:** Verify `skill.directory_name == name` in frontmatter
20. **Directory name truncated:** 80-char prompt name → 64-char directory for claude-code

**New file: `backend/tests/api/test_prompts_export.py`**

API endpoint tests:

1. **Basic export (claude-code):** Create prompts, verify tar.gz contains correct SKILL.md files
2. **Basic export (claude-desktop):** Create prompts, verify zip structure
3. **Basic export (codex):** Create prompts, verify tar.gz with Codex-specific formatting
4. **No tags = all prompts:** Verify all prompts exported when tags not specified
5. **Tag filtering:** Create prompts with different tags, verify only matching ones exported
6. **tag_match=any:** Create prompts, verify OR matching works
7. **tag_match=all:** Create prompts with multiple tags, verify AND matching works
8. **View filter:** Create active and archived prompts, verify `view` parameter works
9. **Empty result:** No prompts match → valid empty archive (extractable, no files)
10. **Pagination:** Create >100 prompts, verify all are exported (not just first page)
11. **Response headers (tar.gz):** Verify Content-Type `application/gzip`, Content-Disposition
12. **Response headers (zip):** Verify Content-Type `application/zip`, Content-Disposition
13. **Directory structure:** Verify `{name}/SKILL.md` structure in archive
14. **Auth required:** 401 without authentication
15. **PAT access allowed:** Verify PAT works (not Auth0-only)
16. **Client required:** Verify 422 if client parameter missing
17. **Directory name matches frontmatter:** Extract archive, verify directory name == frontmatter name
18. **Truncated name in directory:** 80-char prompt name → 64-char directory for claude-code
19. **Name collision (last wins):** Two prompts that truncate to same name → second overwrites first in archive
20. **YAML special chars in description:** Description with `:` and `#` → valid parseable YAML in archive

### Dependencies

Milestone 0 (infrastructure changes)

### Risk Factors

- **Prompt names with special chars:** Prompt names should already be valid directory names (lowercase-with-hyphens). Verify no edge cases.
- **Large exports:** Many prompts with large content could create large archives. Current in-memory approach is fine for reasonable sizes (<1000 prompts). If users hit memory issues with very large exports, consider streaming archive generation.
- **Name collision after truncation:** If two prompts truncate to the same name (e.g., both 80-char names share first 64 chars), the second one overwrites the first in the archive. This is rare and the behavior is deterministic (last wins).

---

## Milestone 2: Frontend Instructions

### Goal

Display instructions on the Settings page for syncing skills to each supported client, with a tag dropdown that dynamically updates the command.

### Success Criteria

- Settings page shows instructions for Claude Code, Codex, and Claude Desktop
- Tag dropdown populated with user's existing tags
- Defaults to "skill" or "skills" tag if exists, otherwise "all prompts" (no tag filter)
- Sync command updates dynamically based on selected tags
- User can easily copy commands
- Warning displayed for Anthropic clients about name truncation >64 chars
- Remove `comingSoon: true` from skills integration option

### Key Changes

**Update: `frontend/src/pages/settings/SettingsMCP.tsx`**

1. Remove `comingSoon: true` from the skills integration option
2. Add skills export section with:
   - Tag dropdown (multi-select) populated from user's tags API
   - Default selection logic: "skill" or "skills" if exists, else empty (all prompts)
   - Dynamic command generation based on selected client and tags
   - Warning about name truncation for Claude Code/Desktop

```tsx
// Skills Export section for each client

interface SkillsExportProps {
  client: 'claude-code' | 'claude-desktop' | 'codex';
  apiUrl: string;
  userTags: string[];
}

function SkillsExportInstructions({ client, apiUrl, userTags }: SkillsExportProps) {
  // Default to "skill" or "skills" if exists, otherwise empty array
  const defaultTags = userTags.includes('skill')
    ? ['skill']
    : userTags.includes('skills')
      ? ['skills']
      : [];

  const [selectedTags, setSelectedTags] = useState<string[]>(defaultTags);

  // Build query params with repeated keys for FastAPI list parsing
  // FastAPI expects ?tags=foo&tags=bar, NOT ?tags=foo,bar
  const buildExportUrl = () => {
    const params = new URLSearchParams();
    params.append('client', client);
    selectedTags.forEach(tag => params.append('tags', tag));
    return `${apiUrl}/prompts/export/skills?${params.toString()}`;
  };
  const exportUrl = buildExportUrl();

  return (
    <div>
      {/* Tag selector dropdown */}
      <TagSelector
        availableTags={userTags}
        selectedTags={selectedTags}
        onChange={setSelectedTags}
        placeholder="All prompts (no filter)"
      />

      {/* Warning for Anthropic clients */}
      {(client === 'claude-code' || client === 'claude-desktop') && (
        <Warning>
          Prompt names longer than 64 characters will be truncated for {client}.
        </Warning>
      )}

      {/* Warning for Codex description formatting */}
      {client === 'codex' && (
        <Warning>
          Multi-line descriptions will be collapsed to a single line for Codex compatibility.
        </Warning>
      )}

      {/* Client-specific instructions - see Appendix A.2/A.3 */}
      {client === 'claude-code' && (
        <ClaudeCodeInstructions exportUrl={exportUrl} />
      )}
      {client === 'codex' && (
        <CodexInstructions exportUrl={exportUrl} />
      )}
      {client === 'claude-desktop' && (
        <ClaudeDesktopInstructions exportUrl={exportUrl} />
      )}
    </div>
  );
}

function ClaudeCodeInstructions({ exportUrl }: { exportUrl: string }) {
  return (
    <>
      <h4>Sync Command</h4>
      <CodeBlock copyable>
        {`curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ~/.claude/skills/`}
      </CodeBlock>
      <p>
        After syncing, skills are available as <code>/skill-name</code> slash commands.
        Claude will also auto-invoke them when relevant to your task.
      </p>
      <p>
        <strong>Tip:</strong> Add this command to a cron job or shell alias for regular syncing.
      </p>
    </>
  );
}

function CodexInstructions({ exportUrl }: { exportUrl: string }) {
  return (
    <>
      <h4>Sync Command</h4>
      <CodeBlock copyable>
        {`curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ~/.codex/skills/`}
      </CodeBlock>
      <p>
        After syncing, invoke skills by typing <code>$skill-name</code> in your prompt.
        Codex will also auto-select skills based on your task context.
      </p>
    </>
  );
}

function ClaudeDesktopInstructions({ exportUrl }: { exportUrl: string }) {
  return (
    <>
      <h4>Download Command</h4>
      <CodeBlock copyable>
        {`curl -sH "Authorization: Bearer YOUR_PAT" "${exportUrl}" -o skills.zip`}
      </CodeBlock>
      <h4>Installation Steps</h4>
      <ol>
        <li>Run the download command above (replace YOUR_PAT with your Personal Access Token)</li>
        <li>Open Claude Desktop</li>
        <li>Go to <strong>Settings → Capabilities → Skills</strong></li>
        <li>Click "Upload skill" and select the downloaded <code>skills.zip</code> file</li>
      </ol>
      <p>
        Skills are invoked via natural language (e.g., "use my code review skill").
        Claude will also auto-invoke them when relevant.
      </p>
    </>
  );
}
```

### Testing Strategy

- Manual verification that instructions display correctly for each client
- Verify tag dropdown populates from user's tags
- Verify default tag selection logic (skill > skills > none)
- Verify command updates when tags change
- Verify the API URL is correct for the environment
- Test the actual commands work as documented

### Dependencies

Milestone 1

### Risk Factors

- **Tag API:** Need to fetch user's tags. Use existing tags endpoint or add if needed.
- **UX complexity:** Three different clients with different instructions. Use tabs or accordion for clarity.

---

## Summary of Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/src/services/skill_converter.py` | `prompt_to_skill_md()` conversion function with client-specific behavior |
| `backend/tests/services/test_skill_converter.py` | Unit tests for conversion |
| `backend/tests/api/test_prompts_export.py` | API endpoint tests |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/core/config.py` | Change `max_prompt_name_length` to 100, `max_description_length` to 1000 |
| `backend/src/services/base_entity_service.py` | Add `include_content: bool = False` parameter to `search()` |
| `backend/src/api/routers/prompts.py` | Add `GET /prompts/export/skills` endpoint |
| `frontend/src/pages/settings/SettingsMCP.tsx` | Add skills export instructions with tag dropdown, remove comingSoon |

---

## Notes for Implementation

1. **Config changes:** Changing `max_prompt_name_length` (255→100) and `max_description_length` (2000→1000) may affect existing data. Check for prompts exceeding new limits before migration.

2. **Authentication:** Use `get_current_user` (not `_auth0_only`) to allow PAT access. Sync scripts need to work with PATs. Rate limits apply normally.

3. **Content loading:** Use `include_content=True` when calling `search()` for export. This ensures full content is loaded, not just the 500-char preview.

4. **Pagination:** The endpoint must loop through all pages until all matching prompts are retrieved. Don't rely on a single high-limit query.

5. **Client parameter required:** The `client` parameter is required (no default). This ensures explicit choice of target platform.

6. **Empty tags = all prompts:** When `tags` parameter is empty or not provided, export ALL prompts. Document this clearly in API and Settings UI.

7. **Client-specific truncation:** See [Appendix A.1](#a1-platform-constraints-summary) for exact limits per client.

8. **Jinja2 preserved:** The raw template content goes into the SKILL.md. LLMs understand Jinja2 syntax and can substitute values. No template rendering happens during export.

9. **Archive format by client:** See [Appendix A.1](#a1-platform-constraints-summary).

10. **Frontend tag dropdown:** Fetch user's tags and populate dropdown. Default to "skill" or "skills" if either exists in user's tags, otherwise default to empty (all prompts).

11. **Defensive content handling:** Handle `None` or empty content gracefully in conversion function. This shouldn't happen via normal API (validation prevents it) but is good defensive coding.

12. **Sync behavior (additive):** The sync command extracts skills to the target directory, overwriting files with the same name but NOT deleting existing skills. If a user removes a prompt from their export (e.g., by changing tags), the corresponding skill remains in their local skills directory until manually deleted. This is intentional - users may have manually created skills that shouldn't be deleted.

13. **Name collision after truncation:** If two prompts truncate to the same name for a client, the second one overwrites the first in the archive. This is rare (requires two 65+ char names sharing the first 64 chars) and the behavior is deterministic.

---

# Appendix A: Platform Specifications

This appendix documents the technical specifications for each supported platform, based on official documentation.

## A.1 Platform Constraints Summary

| Platform | Name Max | Desc Max | Desc Format | Archive | Installation |
|----------|----------|----------|-------------|---------|--------------|
| **Claude Code** | 64 chars | 1024 chars | Multi-line OK | tar.gz | `~/.claude/skills/` |
| **Claude Desktop** | 64 chars | 1024 chars | Multi-line OK | zip | Upload via Settings |
| **Codex CLI** | 100 chars | 500 chars | **Single-line only** | tar.gz | `~/.codex/skills/` |

### Name Field Constraints

All platforms follow the [Agent Skills Standard](https://agentskills.io/specification) for `name`:

- **Length:** 1-64 characters (Claude Code/Desktop), 1-100 characters (Codex)
- **Characters:** Lowercase letters (`a-z`), numbers (`0-9`), and hyphens (`-`) only
- **Format rules:**
  - Must NOT start or end with a hyphen
  - Must NOT contain consecutive hyphens (`--`)
  - Must match the parent directory name

**Valid examples:** `code-review`, `pdf-processing`, `data-analysis`

**Invalid examples:** `Code-Review` (uppercase), `-pdf` (starts with hyphen), `pdf--processing` (consecutive hyphens)

### Description Field Constraints

| Platform | Max Length | Format |
|----------|------------|--------|
| Claude Code | 1024 chars | Multi-line allowed |
| Claude Desktop | 1024 chars | Multi-line allowed |
| Codex CLI | 500 chars | **Single-line required** (newlines not allowed) |

The description should:
- Describe what the skill does
- Describe when to use it
- Include keywords that help agents identify relevant tasks

**Good example:**
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
```

**Poor example:**
```yaml
description: Helps with PDFs.
```

---

## A.2 Claude Code Specification

**Source:** [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)

### Directory Structure

```
skill-name/
├── SKILL.md           # Required: instructions + metadata
├── scripts/           # Optional: executable code
├── references/        # Optional: documentation
└── assets/            # Optional: templates, resources
```

### Installation Locations

| Scope | Path | Applies to |
|-------|------|------------|
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects |
| Project | `.claude/skills/<skill-name>/SKILL.md` | This project only |

### SKILL.md Format

```yaml
---
name: skill-name
description: What this skill does and when to use it.
---

Markdown instructions here...
```

### Required Frontmatter Fields

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | No (uses directory name if omitted) | Max 64 chars, lowercase letters/numbers/hyphens only |
| `description` | Recommended | Max 1024 chars, describes what and when |

### Optional Frontmatter Fields (Claude Code Extensions)

| Field | Description |
|-------|-------------|
| `disable-model-invocation` | Set `true` to prevent auto-invocation (manual `/name` only) |
| `user-invocable` | Set `false` to hide from `/` menu (model-only invocation) |
| `allowed-tools` | Space-delimited list of tools Claude can use without permission |
| `model` | Model to use when this skill is active |
| `context` | Set to `fork` to run in isolated subagent context |
| `agent` | Subagent type when `context: fork` (e.g., `Explore`, `Plan`) |
| `argument-hint` | Hint shown during autocomplete, e.g., `[filename] [format]` |
| `hooks` | Hooks scoped to this skill's lifecycle |

### Invocation Methods

1. **Slash command:** `/skill-name` (the `name` field becomes the command)
2. **Auto-invocation:** Claude loads skill automatically when task matches description

### String Substitutions (Runtime Arguments)

Claude Code supports runtime argument injection:

| Syntax | Description |
|--------|-------------|
| `$ARGUMENTS` | All arguments passed when invoking the skill |
| `$ARGUMENTS[N]` | Access specific argument by 0-based index |
| `$0`, `$1`, `$2` | Shorthand for `$ARGUMENTS[0]`, `$ARGUMENTS[1]`, etc. |
| `${CLAUDE_SESSION_ID}` | Current session ID |

**Example:**
```yaml
---
name: fix-issue
description: Fix a GitHub issue
---

Fix GitHub issue $ARGUMENTS following our coding standards.
```

Invocation: `/fix-issue 123` → "Fix GitHub issue 123 following our coding standards."

### Sync Command

```bash
curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "URL" | tar -xzf - -C ~/.claude/skills/
```

---

## A.3 Codex CLI Specification

**Source:** [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)

### Directory Structure

```
skill-name/
├── SKILL.md           # Required
├── scripts/           # Optional: executable code
├── references/        # Optional: documentation
└── assets/            # Optional: templates, resources
```

### Installation Locations (Priority Order)

| Scope | Path |
|-------|------|
| Repo | `$CWD/.codex/skills/` |
| Repo root | `$REPO_ROOT/.codex/skills/` |
| User | `$CODEX_HOME/skills/` (typically `~/.codex/skills/`) |
| Admin | `/etc/codex/skills/` |
| System | Bundled OpenAI skills |

### SKILL.md Format

```yaml
---
name: skill-name
description: Single-line description of what this skill does and when to use it.
---

Markdown instructions here...
```

### Required Frontmatter Fields

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Max 100 chars, **single-line only** |
| `description` | Yes | Max 500 chars, **single-line only** |

### Optional Frontmatter Fields

| Field | Description |
|-------|-------------|
| `metadata.short-description` | Alternative user-facing description |

### Invocation Methods

1. **Explicit:** Type `$skill-name` to mention a skill in your prompt
2. **Implicit:** Codex auto-selects skills matching the task description
3. **Skill selector:** `/skills` command lists available skills

**Note:** Codex uses `$skill-name` syntax, NOT slash commands for skill invocation. The `/skills` command lists skills but doesn't invoke them.

### Validation Behavior

Codex skips skills with:
- Malformed YAML frontmatter
- Fields exceeding length limits
- Symlinked directories with inaccessible targets

### Sync Command

```bash
curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "URL" | tar -xzf - -C ~/.codex/skills/
```

---

## A.4 Claude Desktop Specification

**Source:** [support.claude.com/en/articles/12512180-using-skills-in-claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)

### Archive Format

Skills must be packaged as **ZIP files** with this structure:

```
skill-name/           # The folder (this gets zipped)
└── SKILL.md          # Required at root of folder
```

**Critical:** You must zip THE FOLDER, not the contents. The ZIP should contain a folder which contains SKILL.md.

### Installation

1. Go to **Settings → Capabilities → Skills**
2. Click "Upload skill"
3. Select the `.zip` file

### SKILL.md Format

Same as Agent Skills Standard:

```yaml
---
name: skill-name
description: What this skill does and when to use it.
---

Markdown instructions here...
```

### Constraints

| Field | Constraints |
|-------|-------------|
| `name` | Max 64 chars, lowercase letters/numbers/hyphens only |
| `description` | Max 1024 chars |

### Invocation

- **No slash commands** - Claude Desktop doesn't support `/skill-name` syntax
- Invoke via natural language: "use my code review skill"
- Claude auto-invokes when task matches the skill's description

### Limitations

- No network access - skills cannot fetch from internet or hit APIs
- Skills are private to individual accounts (Team/Enterprise users need admin provisioning)
- No data persistence between sessions

### Download Command

```bash
curl -sH "Authorization: Bearer YOUR_PAT" "URL" -o skills.zip
```

Then upload `skills.zip` via Settings → Capabilities → Skills.

---

## A.4 Jinja2 vs $ARGUMENTS

Our prompts use Jinja2 template syntax (`{{ variable }}`), while Claude Code supports a runtime `$ARGUMENTS` system. These serve different purposes:

| Feature | Jinja2 (`{{ var }}`) | `$ARGUMENTS` |
|---------|---------------------|--------------|
| **Purpose** | Contextual placeholders LLM fills in | Explicit user-provided values at invocation |
| **Source** | LLM infers from context | User types after `/skill-name` |
| **Example** | `{{ code }}` (LLM finds relevant code) | `$0` (user provides explicitly) |

**Why we keep Jinja2:**
1. LLMs understand Jinja2 and can infer what to substitute from context
2. Our prompts use contextual placeholders, not positional arguments
3. Jinja2 is more expressive (filters, defaults, conditionals)
4. The variables are documented in the skill body for both humans and LLMs

**We do NOT convert to `$ARGUMENTS` because:**
1. Our prompts don't have positional arguments
2. `$ARGUMENTS` is for explicit user input at invocation time
3. Converting would lose the contextual semantics

---

## A.5 Agent Skills Standard

The Agent Skills Standard ([agentskills.io](https://agentskills.io)) is the base specification that Claude Code, Claude Desktop, and Codex build upon.

### Official Specification

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | 1-64 chars, lowercase alphanumeric + hyphens, no start/end hyphen, no consecutive hyphens |
| `description` | Yes | 1-1024 chars |
| `license` | No | License name or reference to bundled file |
| `compatibility` | No | 1-500 chars, environment requirements |
| `metadata` | No | Arbitrary key-value mapping |
| `allowed-tools` | No | Space-delimited tool list (experimental) |

### Progressive Disclosure

Skills use progressive disclosure to manage context:

1. **Discovery (~100 tokens):** Only `name` and `description` loaded at startup
2. **Activation (<5000 tokens recommended):** Full SKILL.md body loaded when invoked
3. **Resources (as needed):** Files in `scripts/`, `references/`, `assets/` loaded on demand

**Recommendation:** Keep SKILL.md under 500 lines. Move detailed reference material to separate files.

---

## A.6 Sources

- [Agent Skills Specification](https://agentskills.io/specification) - Official standard
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills) - Anthropic
- [Codex Skills Documentation](https://developers.openai.com/codex/skills) - OpenAI
- [Codex Create Skills](https://developers.openai.com/codex/skills/create-skill) - OpenAI
- [Using Skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude) - Anthropic Support
- [Anthropic Skills Repository](https://github.com/anthropics/skills) - Example skills
