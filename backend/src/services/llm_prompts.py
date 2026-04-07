"""
Prompt templates for AI suggestion features.

Each function builds a message list (system + user) for a specific use case.
The system prompt provides instructions; the user message provides context.
"""
import re


def build_tag_suggestion_messages(
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    tag_vocabulary: list[str],
    few_shot_examples: list[dict],
) -> list[dict]:
    """
    Build messages for tag suggestion.

    Args:
        title: Item title.
        url: Item URL (bookmarks only).
        description: Item description.
        content_snippet: First ~2500 chars of content.
        tag_vocabulary: User's existing tags sorted by frequency.
        few_shot_examples: Recent items with tags for style reference.
            Each dict has keys: title, description, tags (list[str]).
    """
    system = (
        "You are a tagging assistant. Suggest relevant tags for the given item.\n\n"
        "Guidelines:\n"
        "- Prefer reusing tags from the user's existing vocabulary below\n"
        "- Use lowercase hyphenated format (e.g. machine-learning, web-dev)\n"
        "- Be consistent with the user's tagging style shown in the examples\n"
        "- Suggest 3-7 tags unless fewer are appropriate\n"
        "- The examples are for style reference only — do not simply copy their tags\n"
    )

    if tag_vocabulary:
        vocab_str = ", ".join(tag_vocabulary[:50])
        system += f"\nUser's existing tags (most used first): {vocab_str}\n"

    if few_shot_examples:
        system += "\nRecent items for style reference:\n"
        for ex in few_shot_examples[:5]:
            tags_str = ", ".join(ex.get("tags", []))
            system += f"- \"{ex.get('title', '')}\" → {tags_str}\n"

    user_parts = []
    if title:
        user_parts.append(f"Title: {title}")
    if url:
        user_parts.append(f"URL: {url}")
    if description:
        user_parts.append(f"Description: {description}")
    if content_snippet:
        user_parts.append(f"Content: {content_snippet}")

    user_msg = "\n".join(user_parts) if user_parts else "No context provided."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Suggest tags for this item:\n\n{user_msg}"},
    ]


def build_metadata_suggestion_messages(
    url: str | None,
    title: str | None,
    content_snippet: str | None,
) -> list[dict]:
    """Build messages for title/description suggestion."""
    system = (
        "You are a content summarization assistant. "
        "Generate a concise title and description for the given item.\n\n"
        "Guidelines:\n"
        "- Title: short and descriptive, under 100 characters\n"
        "- Description: 1-2 sentences summarizing the content\n"
    )

    user_parts = []
    if title:
        user_parts.append(f"Current title: {title}")
    if url:
        user_parts.append(f"URL: {url}")
    if content_snippet:
        user_parts.append(f"Content: {content_snippet}")

    user_msg = "\n".join(user_parts) if user_parts else "No context provided."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Generate a title and description:\n\n{user_msg}"},
    ]


def build_relationship_suggestion_messages(
    source_title: str | None,
    source_url: str | None,
    source_description: str | None,
    source_content_snippet: str | None,
    candidates: list[dict],
) -> list[dict]:
    """
    Build messages for relationship suggestion.

    Args:
        source_title: The item we're finding relationships for.
        source_url: Source item URL.
        source_description: Source item description.
        source_content_snippet: Source item content.
        candidates: List of candidate items, each with keys:
            entity_id, entity_type, title, description, content_preview.
    """
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
        source_parts.append(f"Content: {source_content_snippet[:500]}")

    source_str = "\n".join(source_parts) if source_parts else "No context provided."

    candidate_lines = []
    for i, c in enumerate(candidates, 1):
        desc = (c.get("description") or "")[:200]
        preview = (c.get("content_preview") or "")[:200]
        line = f"{i}. [{c['entity_type']}] \"{c['title']}\" (id: {c['entity_id']})"
        if desc:
            line += f" — {desc}"
        if preview:
            line += f"\n   Content: {preview}"
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
    existing_arguments: list[dict],
    target: str | None,
    placeholder_names: list[str] | None = None,
) -> list[dict]:
    """
    Build messages for prompt argument suggestions.

    Args:
        prompt_content: The Jinja2 prompt template text.
        existing_arguments: Current arguments with name/description.
        target: Argument name to suggest for, or None for "generate all."
        placeholder_names: Deterministically extracted placeholder names
            (for "generate all" mode). The LLM describes these, not invents them.
    """
    if target is None:
        system = (
            "You are a prompt template assistant. "
            "Generate a description for each of the listed prompt arguments.\n\n"
            "Guidelines:\n"
            "- Keep the argument names exactly as provided — do not rename them\n"
            "- Descriptions should explain what the argument represents and give an example\n"
        )
    else:
        system = (
            "You are a prompt template assistant. "
            "Suggest a name and/or description for the specified prompt argument.\n\n"
            "Guidelines:\n"
            "- Use lowercase_with_underscores for argument names\n"
            "- Descriptions should explain what the argument represents and give an example\n"
        )

    user_parts = []
    if prompt_content:
        user_parts.append(f"Template:\n{prompt_content}")

    if placeholder_names and target is None:
        names_str = ", ".join(placeholder_names)
        user_parts.append(f"Arguments to describe: {names_str}")

    if existing_arguments:
        args_str = "\n".join(
            f"- {a.get('name', '?')}: {a.get('description', '(no description)')}"
            for a in existing_arguments
        )
        user_parts.append(f"Existing arguments:\n{args_str}")

    if target is not None:
        target_arg = next(
            (a for a in existing_arguments if a.get("name") == target),
            None,
        )
        if target_arg:
            user_parts.append(
                f"Suggest for argument: name={target_arg.get('name', '?')}, "
                f"description={target_arg.get('description', '(none)')}",
            )
        else:
            user_parts.append(f"Suggest for argument named: {target}")

    user_msg = "\n\n".join(user_parts) if user_parts else "No context provided."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]
