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
from schemas.content_search import ContentSearchMatch


def search_in_content(
    content: str | None,
    title: str | None,
    description: str | None,
    query: str,
    fields: list[str],
    case_sensitive: bool = False,
    context_lines: int = 2,
) -> list[ContentSearchMatch]:
    """
    Search for a literal string within specified fields of a content item.

    Supports multiline queries - the query can span multiple lines and will be
    found if it exists in the content. Each occurrence is returned as a separate
    match, even if multiple occurrences appear on the same line.

    Args:
        content: The content field value (may be None).
        title: The title field value (may be None).
        description: The description field value (may be None).
        query: The literal string to search for (can be multiline).
        fields: List of fields to search (content, title, description).
        case_sensitive: If True, perform case-sensitive search. Default False.
        context_lines: Number of lines before/after match for content field context.

    Returns:
        List of ContentSearchMatch objects, one per match found.
        Empty list if no matches (not an error - valid answer to "what's here?").
    """
    matches: list[ContentSearchMatch] = []

    # Normalize query once for case-insensitive searches
    search_query = query if case_sensitive else query.lower()

    # Search content field
    if "content" in fields and content is not None:
        matches.extend(
            _search_content_field(content, query, case_sensitive, context_lines),
        )

    # Search title field (return full value as context)
    if "title" in fields and title is not None:
        search_text = title if case_sensitive else title.lower()
        if search_query in search_text:
            matches.append(ContentSearchMatch(field="title", line=None, context=title))

    # Search description field (return full value as context)
    if "description" in fields and description is not None:
        search_text = description if case_sensitive else description.lower()
        if search_query in search_text:
            matches.append(
                ContentSearchMatch(field="description", line=None, context=description),
            )

    return matches


def _search_content_field(
    content: str,
    query: str,
    case_sensitive: bool,
    context_lines: int,
) -> list[ContentSearchMatch]:
    """
    Search within the content field, returning matches with line numbers and context.

    Searches the full content for the query (supporting multiline patterns).
    Returns one match per non-overlapping occurrence, with the starting line number.

    Args:
        content: The content text to search.
        query: The query string to find (can be multiline).
        case_sensitive: Whether the search is case-sensitive.
        context_lines: Number of lines before/after match to include.

    Returns:
        List of ContentSearchMatch objects for content field matches.
    """
    matches: list[ContentSearchMatch] = []

    # Prepare for searching
    search_content = content if case_sensitive else content.lower()
    search_query = query if case_sensitive else query.lower()

    # Pre-compute values used in the loop
    lines = content.split("\n")
    query_newlines = query.count("\n")

    # Track line number incrementally to avoid O(n) scan from start each time
    current_line = 1
    last_pos = 0

    # Find all non-overlapping occurrences in the content
    start_pos = 0
    while True:
        pos = search_content.find(search_query, start_pos)
        if pos == -1:
            break

        # Incremental line counting - only count newlines since last match
        current_line += content[last_pos:pos].count("\n")
        last_pos = pos

        line_idx = current_line - 1  # Convert to 0-indexed
        end_line_idx = line_idx + query_newlines

        # Context window: context_lines before start, context_lines after end
        context_start = max(0, line_idx - context_lines)
        context_end = min(len(lines), end_line_idx + context_lines + 1)
        context = "\n".join(lines[context_start:context_end])

        matches.append(
            ContentSearchMatch(field="content", line=current_line, context=context),
        )

        # Move past this match (non-overlapping)
        start_pos = pos + len(query)

    return matches


def get_match_context(
    content: str,
    match_start_line: int,
    context_lines: int = 2,
) -> str:
    """
    Get context lines around a specific line in content.

    Note: This function is not yet used but is intended for the str_replace
    endpoint to provide context in multiple_matches error responses,
    helping users identify which match to target.

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
