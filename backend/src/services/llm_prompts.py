"""
Prompt templates for AI suggestion features.

Each function builds a message list (system + user) for a specific use case.
The system prompt provides instructions; the user message provides context.
"""
import re
from typing import Literal

from schemas.ai import (
    CONTENT_SNIPPET_LLM_WINDOW_CHARS,
    ArgumentInput,
    RelationshipCandidateContext,
    TagVocabularyEntry,
)


def build_tag_suggestion_messages(
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    content_type: str,
    tag_vocabulary: list[TagVocabularyEntry],
) -> list[dict]:
    """
    Build messages for tag suggestion.

    Args:
        title: Item title.
        url: Item URL (bookmarks only).
        description: Item description.
        content_snippet: Item content.
        content_type: Entity type ("bookmark", "note", "prompt").
        tag_vocabulary: User's existing tags sorted by frequency, up to 100
            entries with usage counts.
    """
    # NOTE: Eval configs pass these parameters directly — update eval YAML configs
    # if you change the parameter contract.
    system = (
        f"You are a tagging assistant. Suggest relevant tags for the given {content_type}.\n\n"
        "Guidelines:\n"
        "- Reuse tags from the user's existing vocabulary when relevant. If the "
        "vocabulary contains the user's preferred form of a common term (e.g., "
        "'ml' instead of 'machine-learning'), use their form rather than "
        "substituting the canonical name\n"
        "- Use lowercase hyphenated format (e.g. machine-learning, web-dev)\n"
        "- Suggest 3-7 tags unless fewer are appropriate\n"
        "- A tag is relevant if it directly describes a topic in the item's "
        "title, description, or content, OR is a closely related concept that "
        "is present in the vocabulary. A tag from the vocabulary with no topical "
        "connection to the item is not relevant, even if it is frequently used\n"
        "- Avoid broad category tags unless the item actually discusses that "
        "category. A tag is not relevant just because the item's topic is "
        "commonly associated with that category. For example, a tutorial about "
        "pandas DataFrames warrants 'python' (directly used) but not "
        "'machine-learning' (commonly associated but not discussed)\n"
    )

    if tag_vocabulary:
        vocab_str = ", ".join(
            f"{entry.name} ({entry.count})" for entry in tag_vocabulary[:100]
        )
        system += f"\nUser's existing tags (most used first): {vocab_str}\n"

    user_parts = []
    if title:
        user_parts.append(f"Title: {title}")
    if url:
        user_parts.append(f"URL: {url}")
    if description:
        user_parts.append(f"Description: {description}")
    if content_snippet:
        user_parts.append(f"Content snippet: {content_snippet[:CONTENT_SNIPPET_LLM_WINDOW_CHARS]}")

    user_msg = "\n".join(user_parts) if user_parts else "No context provided."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Suggest tags for this {content_type}:\n\n{user_msg}"},
    ]


def build_metadata_suggestion_messages(
    fields: list[str],
    url: str | None,
    title: str | None,
    description: str | None,
    content_snippet: str | None,
) -> list[dict]:
    """
    Build messages for title/description suggestion.

    Args:
        fields: Which fields to generate — ["title"], ["description"],
            or ["title", "description"].
        url: Item URL.
        title: Existing title (used as context, not regenerated unless requested).
        description: Existing description (used as context).
        content_snippet: Item content.
    """
    generate_title = "title" in fields
    generate_desc = "description" in fields

    system = "You are a content summarization assistant.\n\nGuidelines:\n"
    if generate_title:
        system += "- Title: short and descriptive, under 100 characters\n"
    if generate_desc:
        system += "- Description: 1-2 sentences summarizing the content\n"

    user_parts = []
    if title and not generate_title:
        user_parts.append(f"Title: {title}")
    elif title and generate_title:
        user_parts.append(f"Current title (to improve): {title}")
    if description and not generate_desc:
        user_parts.append(f"Description: {description}")
    elif description and generate_desc:
        user_parts.append(f"Current description (to improve): {description}")
    if url:
        user_parts.append(f"URL: {url}")
    if content_snippet:
        user_parts.append(f"Content snippet: {content_snippet[:CONTENT_SNIPPET_LLM_WINDOW_CHARS]}")

    user_msg = "\n".join(user_parts) if user_parts else "No context provided."

    if generate_title and generate_desc:
        task = "Generate a title and description"
    elif generate_title:
        task = "Generate a title"
    else:
        task = "Generate a description"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"{task}:\n\n{user_msg}"},
    ]


def build_relationship_suggestion_messages(
    source_title: str | None,
    source_url: str | None,
    source_description: str | None,
    source_content_snippet: str | None,
    candidates: list[RelationshipCandidateContext],
) -> list[dict]:
    """
    Build messages for relationship suggestion.

    Args:
        source_title: The item we're finding relationships for.
        source_url: Source item URL.
        source_description: Source item description.
        source_content_snippet: Source item content.
        candidates: Candidate items with full context for prompt building.
    """
    # NOTE: Eval configs pass these parameters directly — update eval YAML configs
    # if you change the parameter contract.
    system = (
        "You are a content relationship assistant. "
        "Given a source item and a list of candidates, identify which candidates "
        "are meaningfully related to the source item.\n\n"
        "Guidelines:\n"
        "- Only select candidates that have a genuine topical or conceptual relationship\n"
        "- Return the entity_id, entity_type, and title of each related candidate\n"
        "- Return an empty list if no candidates are meaningfully related\n"
    )

    source_parts = []
    if source_title:
        source_parts.append(f"Title: {source_title}")
    if source_url:
        source_parts.append(f"URL: {source_url}")
    if source_description:
        source_parts.append(f"Description: {source_description}")
    if source_content_snippet:
        snippet = source_content_snippet[:CONTENT_SNIPPET_LLM_WINDOW_CHARS]
        source_parts.append(f"Content snippet: {snippet}")

    source_str = "\n".join(source_parts) if source_parts else "No context provided."

    candidate_lines = []
    for i, c in enumerate(candidates, 1):
        desc = c.description if c.description else ""
        preview = c.content_preview[:1000] if c.content_preview else ""
        line = f"{i}. [{c.entity_type}] \"{c.title}\" (id: {c.entity_id})"
        if desc:
            line += f" — {desc}"
        if preview:
            line += f"\n   Content snippet: {preview}"
        candidate_lines.append(line)

    candidates_str = "\n".join(candidate_lines) if candidate_lines else "No candidates."

    user_msg = (
        f"Source item:\n{source_str}\n\n"
        f"Candidates:\n{candidates_str}"
    )

    user_content = f"Which candidates are related to the source item?\n\n{user_msg}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]


_JINJA2_PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def extract_template_placeholders(prompt_content: str) -> list[str]:
    """Extract {{ variable }} placeholder names from a Jinja2 template."""
    return list(dict.fromkeys(_JINJA2_PLACEHOLDER_RE.findall(prompt_content)))


_REQUIRED_GUIDELINE = (
    "- Mark an argument as required if it appears unconditionally in the template "
    "(e.g. {{ variable }}). Mark it as not required if it is inside a Jinja2 "
    "conditional block (e.g. {% if variable %} ... {% endif %})\n"
)


def _format_existing_arguments(existing_arguments: list[ArgumentInput]) -> str | None:
    """Render existing arguments as a bullet list for the user message, or None if empty."""
    if not existing_arguments:
        return None
    return "\n".join(
        f"- {a.name or '?'}: {a.description or '(no description)'}"
        for a in existing_arguments
    )


def build_generate_all_arguments_messages(
    prompt_content: str,
    existing_arguments: list[ArgumentInput],
    placeholder_names: list[str],
) -> list[dict]:
    """
    Build messages for the generate-all endpoint — describe every new
    placeholder in the template.
    """
    system = (
        "You are a prompt template assistant. "
        "Generate a description for each of the listed prompt arguments.\n\n"
        "Guidelines:\n"
        "- Return one entry per name listed in 'Arguments to describe', "
        "using that exact name for the `name` field. Do not rename, "
        "abbreviate, split, or combine them — the template already uses "
        "these names as {{ placeholder }} tokens, so renaming breaks the "
        "template\n"
        "- Descriptions should explain what the argument represents and give an example\n"
        + _REQUIRED_GUIDELINE
    )

    user_parts = [f"Template:\n{prompt_content}"]
    user_parts.append(f"Arguments to describe: {', '.join(placeholder_names)}")
    existing_str = _format_existing_arguments(existing_arguments)
    if existing_str is not None:
        user_parts.append(f"Existing arguments:\n{existing_str}")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]


def build_refine_single_field_messages(
    target_field: Literal["name", "description"],
    target_arg: ArgumentInput,
    existing_arguments: list[ArgumentInput],
    prompt_content: str | None,
) -> list[dict]:
    """
    Build messages for the single-field refine case — suggest either the
    `name` (given a description) or the `description` (given a name) of
    a specific argument row.
    """
    if target_field == "name":
        system = (
            "You are a prompt template assistant. "
            "Suggest a name for the specified prompt argument based on its description.\n\n"
            "Guidelines:\n"
            "- Use lowercase_with_underscores for argument names\n"
            "- The name should clearly reflect what the argument represents\n"
            "- If the description clearly maps to an existing placeholder in the "
            "template (e.g. {{ variable_name }}), use that placeholder's name\n"
        )
    else:
        system = (
            "You are a prompt template assistant. "
            "Suggest a description for the specified prompt argument.\n\n"
            "Guidelines:\n"
            "- The description should explain what the argument represents and give an example\n"
        )

    user_parts: list[str] = []
    if prompt_content:
        user_parts.append(f"Template:\n{prompt_content}")
    existing_str = _format_existing_arguments(existing_arguments)
    if existing_str is not None:
        user_parts.append(f"Existing arguments:\n{existing_str}")

    # Only reference the opposite field when it's actually populated.
    # Schema grounding allows single-field refine with only template
    # context — in that case, the Template/Existing blocks above are the
    # grounding signal and we must not emit literal "None" into the prompt.
    if target_field == "name" and target_arg.description:
        user_parts.append(
            f"Suggest a name for the argument with description: "
            f"\"{target_arg.description}\"",
        )
    elif target_field == "description" and target_arg.name:
        user_parts.append(
            f"Suggest a description for the argument named: "
            f"{target_arg.name}",
        )

    user_msg = "\n\n".join(user_parts) if user_parts else "No context provided."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]


def build_refine_both_fields_messages(
    target_index: int,
    existing_arguments: list[ArgumentInput],
    prompt_content: str,
    unclaimed_placeholder_names: list[str],
) -> list[dict]:
    """
    Build messages for the two-field refine case — regenerate both `name`
    and `description` for the row at `target_index` from the template.

    Args:
        target_index: Index of the row being refined. Surfaced to the LLM
            so it knows which row it is regenerating relative to the
            existing-arguments listing.
        existing_arguments: The full arguments list (used for context).
        prompt_content: The Jinja2 template (guaranteed non-empty by the
            schema `model_validator`).
        unclaimed_placeholder_names: Placeholder names from the template
            that are not yet claimed by any other row. The service
            pre-filters so the LLM never sees claimed names; this list is
            guaranteed non-empty when this builder is called.
    """
    system = (
        "You are a prompt template assistant. "
        "Regenerate the name, description, and required flag for one "
        "specific prompt argument row.\n\n"
        "Guidelines:\n"
        "- Pick exactly one of the listed unclaimed placeholder names for the `name` field\n"
        "- Use lowercase_with_underscores for the name (the placeholder already follows this)\n"
        "- Descriptions should explain what the argument represents and give an example\n"
        + _REQUIRED_GUIDELINE
    )

    user_parts = [f"Template:\n{prompt_content}"]
    user_parts.append(
        f"Unclaimed placeholder names (pick one for `name`): "
        f"{', '.join(unclaimed_placeholder_names)}",
    )
    existing_str = _format_existing_arguments(existing_arguments)
    if existing_str is not None:
        user_parts.append(f"Existing arguments:\n{existing_str}")
    user_parts.append(
        f"Regenerate the argument at index {target_index} "
        f"(row number {target_index + 1} in the existing arguments list above).",
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]
