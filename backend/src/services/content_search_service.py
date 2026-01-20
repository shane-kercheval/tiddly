"""
Service for searching within content item fields.

Provides literal string matching with line numbers and context for the content field,
and full-value matching for metadata fields (title, description).

Use cases:
1. Pre-edit validation - Confirm how many matches exist before str_replace
2. Context building - Get surrounding lines to construct a unique old_str
3. Content discovery - Find where text appears without reading entire content
4. General search - Locate information within a specific content item
"""
from dataclasses import dataclass


@dataclass
class SearchMatch:
    """A single match within a field."""

    field: str
    line: int | None  # None for non-content fields
    context: str


def search_in_content(
    content: str | None,
    title: str | None,
    description: str | None,
    query: str,
    fields: list[str],
    case_sensitive: bool = False,
    context_lines: int = 2,
) -> list[SearchMatch]:
    """
    Search for a literal string within specified fields of a content item.

    Args:
        content: The content field value (may be None).
        title: The title field value (may be None).
        description: The description field value (may be None).
        query: The literal string to search for.
        fields: List of fields to search (content, title, description).
        case_sensitive: If True, perform case-sensitive search. Default False.
        context_lines: Number of lines before/after match for content field context.

    Returns:
        List of SearchMatch objects, one per match found.
        Empty list if no matches (not an error - valid answer to "what's here?").
    """
    matches: list[SearchMatch] = []

    # Normalize query for case-insensitive matching
    search_query = query if case_sensitive else query.lower()

    # Search content field
    if "content" in fields and content is not None:
        matches.extend(
            _search_content_field(content, search_query, case_sensitive, context_lines),
        )

    # Search title field (return full value as context)
    if "title" in fields and title is not None:
        search_text = title if case_sensitive else title.lower()
        if search_query in search_text:
            matches.append(SearchMatch(field="title", line=None, context=title))

    # Search description field (return full value as context)
    if "description" in fields and description is not None:
        search_text = description if case_sensitive else description.lower()
        if search_query in search_text:
            matches.append(SearchMatch(field="description", line=None, context=description))

    return matches


def _search_content_field(
    content: str,
    search_query: str,
    case_sensitive: bool,
    context_lines: int,
) -> list[SearchMatch]:
    """
    Search within the content field, returning matches with line numbers and context.

    Args:
        content: The content text to search.
        search_query: The query normalized for searching (lowercase if case-insensitive).
        case_sensitive: Whether the search is case-sensitive.
        context_lines: Number of lines before/after match to include.

    Returns:
        List of SearchMatch objects for content field matches.
    """
    matches: list[SearchMatch] = []
    lines = content.split("\n")

    for line_idx, line in enumerate(lines):
        search_line = line if case_sensitive else line.lower()

        # Check if query appears in this line
        if search_query in search_line:
            # Line numbers are 1-indexed
            line_number = line_idx + 1

            # Extract context lines
            start_idx = max(0, line_idx - context_lines)
            end_idx = min(len(lines), line_idx + context_lines + 1)
            context = "\n".join(lines[start_idx:end_idx])

            matches.append(SearchMatch(field="content", line=line_number, context=context))

    return matches


def get_match_context(
    content: str,
    match_start_line: int,
    context_lines: int = 2,
) -> str:
    """
    Get context lines around a specific line in content.

    Used for error responses (e.g., multiple_matches error) to provide
    consistent context formatting.

    Args:
        content: The full content text.
        match_start_line: The 1-indexed line number where the match starts.
        context_lines: Number of lines before/after to include.

    Returns:
        The context string with surrounding lines.
    """
    lines = content.split("\n")
    line_idx = match_start_line - 1  # Convert to 0-indexed

    start_idx = max(0, line_idx - context_lines)
    end_idx = min(len(lines), line_idx + context_lines + 1)

    return "\n".join(lines[start_idx:end_idx])
