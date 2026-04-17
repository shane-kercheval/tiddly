"""
Prompt templates for AI suggestion features.

Each function builds a message list (system + user) for a specific use case.
The system prompt provides instructions; the user message provides context.
"""
import re

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


def build_argument_suggestion_messages(
    prompt_content: str | None,
    existing_arguments: list[ArgumentInput],
    target_arg: ArgumentInput | None,
    suggest_field: str | None = None,
    placeholder_names: list[str] | None = None,
) -> list[dict]:
    """
    Build messages for prompt argument suggestions.

    Args:
        prompt_content: The Jinja2 prompt template text.
        existing_arguments: Current arguments.
        target_arg: The specific argument to suggest for in individual mode,
            or None for "generate all" mode.
        suggest_field: Which field to suggest in individual mode:
            "name" (suggest a name given a description),
            "description" (suggest a description given a name),
            or None for generate-all mode.
        placeholder_names: Deterministically extracted placeholder names
            (for "generate all" mode). The LLM describes these, not invents them.
    """
    required_guideline = (
        "- Mark an argument as required if it appears unconditionally in the template "
        "(e.g. {{ variable }}). Mark it as not required if it is inside a Jinja2 "
        "conditional block (e.g. {% if variable %} ... {% endif %})\n"
    )

    if target_arg is None:
        system = (
            "You are a prompt template assistant. "
            "Generate a description for each of the listed prompt arguments.\n\n"
            "Guidelines:\n"
            "- Keep the argument names exactly as provided — do not rename them\n"
            "- Descriptions should explain what the argument represents and give an example\n"
            + required_guideline
        )
    elif suggest_field == "name":
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

    user_parts = []
    if prompt_content:
        user_parts.append(f"Template:\n{prompt_content}")

    if placeholder_names and target_arg is None:
        names_str = ", ".join(placeholder_names)
        user_parts.append(f"Arguments to describe: {names_str}")

    if existing_arguments:
        args_str = "\n".join(
            f"- {a.name or '?'}: {a.description or '(no description)'}"
            for a in existing_arguments
        )
        user_parts.append(f"Existing arguments:\n{args_str}")

    if target_arg is not None:
        if suggest_field == "name":
            user_parts.append(
                f"Suggest a name for the argument with description: "
                f"\"{target_arg.description}\"",
            )
        else:
            user_parts.append(
                f"Suggest a description for the argument named: "
                f"{target_arg.name}",
            )

    user_msg = "\n\n".join(user_parts) if user_parts else "No context provided."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]
