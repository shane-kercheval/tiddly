"""Convert prompts to SKILL.md format for AI assistant skills export."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

import yaml

if TYPE_CHECKING:
    from models.prompt import Prompt

ClientType = Literal["claude-code", "claude-desktop", "codex"]

# Client-specific constraints per Agent Skills Standard and platform docs
CLIENT_CONSTRAINTS: dict[str, dict[str, int | bool]] = {
    "claude-code": {"name_max": 64, "desc_max": 1024, "desc_single_line": False},
    "claude-desktop": {"name_max": 64, "desc_max": 1024, "desc_single_line": False},
    "codex": {"name_max": 100, "desc_max": 500, "desc_single_line": True},
}


@dataclass
class SkillExport:
    """Result of converting a prompt to a skill."""

    directory_name: str  # Sanitized name for archive directory (matches frontmatter)
    content: str  # Full SKILL.md content


def prompt_to_skill_md(prompt: "Prompt", client: ClientType) -> SkillExport:
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
    name = prompt.name[: constraints["name_max"]]  # type: ignore[index]

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
    desc = desc[: constraints["desc_max"]]  # type: ignore[index]

    # Build template variables section
    template_vars_section = ""
    if prompt.arguments:
        template_vars_section = "## Template Variables\n\n"
        template_vars_section += (
            "This skill uses template variables that you should fill in contextually:\n\n"
        )
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
