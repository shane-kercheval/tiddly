"""
Service for content editing operations (str_replace).

Provides string replacement with progressive matching:
1. Exact match - character-for-character
2. Whitespace-normalized match - normalized line endings and trailing whitespace

The replacement uses the original content positions, with new_str inserted exactly
as provided (no normalization applied to new_str).
"""
from dataclasses import dataclass
from typing import Literal

from services.content_search_service import get_match_context


class NoMatchError(Exception):
    """Raised when old_str is not found in content."""

    pass


class MultipleMatchesError(Exception):
    """
    Raised when old_str matches multiple locations.

    Attributes:
        matches: List of (line_number, context) tuples for each match.
    """

    def __init__(self, matches: list[tuple[int, str]]) -> None:
        self.matches = matches
        super().__init__(f"Found {len(matches)} matches; expected exactly 1")


@dataclass
class StrReplaceResult:
    """Result of a successful str_replace operation."""

    new_content: str
    match_type: Literal["exact", "whitespace_normalized"]
    line: int  # 1-indexed line where match was found


def str_replace(
    content: str,
    old_str: str,
    new_str: str,
    context_lines: int = 2,
) -> StrReplaceResult:
    r"""
    Replace old_str with new_str in content.

    Requires exactly one match. Uses progressive matching:
    1. Try exact match first
    2. If no exact match, try whitespace-normalized match

    Whitespace normalization:
    - Normalize line endings: \\r\\n → \\n
    - Strip trailing whitespace from each line
    - Applied to BOTH old_str and content for comparison
    - Replacement uses original content positions; new_str is inserted verbatim

    Args:
        content: The content to search and modify.
        old_str: The string to find (must match exactly once).
        new_str: The replacement string (used verbatim).
        context_lines: Lines of context for error messages.

    Returns:
        StrReplaceResult with new_content, match_type, and line number.

    Raises:
        NoMatchError: If old_str is not found (even after normalization).
        MultipleMatchesError: If old_str matches more than one location.
    """
    # Try exact match first
    exact_matches = _find_all_matches(content, old_str)

    if len(exact_matches) == 1:
        # Single exact match - perform replacement
        start, end = exact_matches[0]
        new_content = content[:start] + new_str + content[end:]
        line = _get_line_number(content, start)
        return StrReplaceResult(
            new_content=new_content,
            match_type="exact",
            line=line,
        )

    if len(exact_matches) > 1:
        # Multiple exact matches - return error with locations
        matches_with_context = []
        for start, _ in exact_matches:
            line_num = _get_line_number(content, start)
            context = get_match_context(content, line_num, context_lines)
            matches_with_context.append((line_num, context))
        raise MultipleMatchesError(matches_with_context)

    # No exact matches - try whitespace-normalized matching
    normalized_content = _normalize_whitespace(content)
    normalized_old_str = _normalize_whitespace(old_str)

    # Find matches in normalized content
    normalized_matches = _find_all_matches(normalized_content, normalized_old_str)

    if len(normalized_matches) == 0:
        raise NoMatchError()

    if len(normalized_matches) > 1:
        # Multiple normalized matches - map back to original and return error
        matches_with_context = []
        for norm_start, _ in normalized_matches:
            orig_start = _map_normalized_to_original(content, normalized_content, norm_start)
            line = _get_line_number(content, orig_start)
            matches_with_context.append((line, get_match_context(content, line, context_lines)))
        raise MultipleMatchesError(matches_with_context)

    # Single normalized match - map back and perform replacement
    norm_start, norm_end = normalized_matches[0]
    orig_start = _map_normalized_to_original(content, normalized_content, norm_start)
    orig_end = _map_normalized_to_original(content, normalized_content, norm_end)

    new_content = content[:orig_start] + new_str + content[orig_end:]
    line = _get_line_number(content, orig_start)

    return StrReplaceResult(
        new_content=new_content,
        match_type="whitespace_normalized",
        line=line,
    )


def _find_all_matches(content: str, pattern: str) -> list[tuple[int, int]]:
    """
    Find all non-overlapping occurrences of pattern in content.

    Returns:
        List of (start, end) position tuples.
    """
    matches = []
    start = 0
    while True:
        pos = content.find(pattern, start)
        if pos == -1:
            break
        matches.append((pos, pos + len(pattern)))
        start = pos + len(pattern)  # Non-overlapping
    return matches


def _get_line_number(content: str, position: int) -> int:
    """
    Get 1-indexed line number for a character position.

    Args:
        content: The content string.
        position: Character position (0-indexed).

    Returns:
        Line number (1-indexed).
    """
    return content[:position].count("\n") + 1


def _normalize_whitespace(text: str) -> str:
    r"""
    Normalize whitespace for matching purposes.

    - Normalize line endings: \\r\\n → \\n
    - Strip trailing whitespace from each line

    Args:
        text: The text to normalize.

    Returns:
        Normalized text.
    """
    # First normalize line endings
    text = text.replace("\r\n", "\n")

    # Then strip trailing whitespace from each line
    lines = text.split("\n")
    normalized_lines = [line.rstrip() for line in lines]
    return "\n".join(normalized_lines)


def _map_normalized_to_original(
    original: str,
    normalized: str,
    normalized_pos: int,
) -> int:
    r"""
    Map a position in normalized content back to original content.

    This uses a line-based approach since normalization only affects:
    - Line endings (\\r\\n → \\n)
    - Trailing whitespace per line

    The key insight is that the START of each line is at the same relative
    position within the line (normalization doesn't affect line starts).

    Args:
        original: The original content string.
        normalized: The normalized content string.
        normalized_pos: Position in the normalized string.

    Returns:
        Corresponding position in the original string.
    """
    # Pre-normalize line endings in original for consistent line splitting
    original_crlf_normalized = original.replace("\r\n", "\n")

    # Find which line the normalized position is on
    norm_line_num = normalized[:normalized_pos].count("\n")
    norm_lines = normalized.split("\n")

    # Calculate column offset within the line
    if norm_line_num == 0:
        norm_col = normalized_pos
    else:
        # Position of start of this line in normalized content
        line_start_in_norm = sum(len(norm_lines[i]) + 1 for i in range(norm_line_num))
        norm_col = normalized_pos - line_start_in_norm

    # Now find the corresponding position in original
    orig_lines = original_crlf_normalized.split("\n")

    # Calculate start of the target line in original (crlf-normalized)
    if norm_line_num == 0:
        orig_line_start = 0
    else:
        orig_line_start = sum(len(orig_lines[i]) + 1 for i in range(norm_line_num))

    # The column offset is the same since trailing whitespace doesn't affect line starts
    # But we need to clamp to actual line length if the normalized position is
    # beyond the stripped trailing whitespace
    orig_line_len = len(orig_lines[norm_line_num]) if norm_line_num < len(orig_lines) else 0
    orig_col = min(norm_col, orig_line_len)

    crlf_normalized_pos = orig_line_start + orig_col

    # Now map from crlf-normalized back to original by counting \r characters
    # that were removed before this position
    return _adjust_for_crlf(original, crlf_normalized_pos)


def _adjust_for_crlf(original: str, crlf_normalized_pos: int) -> int:
    r"""
    Adjust position from CRLF-normalized content back to original.

    For each \\r\\n that appears before the position in the original,
    we need to add 1 to account for the removed \\r.

    Args:
        original: The original content (may contain \\r\\n).
        crlf_normalized_pos: Position in CRLF-normalized content.

    Returns:
        Position in the original content.
    """
    # Count how many \r\n sequences are before the target position
    # We scan the original and track position in both original and normalized
    orig_pos = 0
    norm_pos = 0

    while norm_pos < crlf_normalized_pos and orig_pos < len(original):
        if original[orig_pos : orig_pos + 2] == "\r\n":
            # Skip past \r\n in original, but only +1 in normalized (it became \n)
            orig_pos += 2
            norm_pos += 1
        else:
            orig_pos += 1
            norm_pos += 1

    return orig_pos
