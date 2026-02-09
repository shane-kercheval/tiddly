r"""
Utilities for line-based content operations.

Line counting convention matches editor behavior (VS Code, Sublime):

- Lines are 1-indexed
- Line count = len(content.split('\n'))
- "hello" = 1 line
- "hello\n" = 2 lines
- "hello\nworld" = 2 lines
- "hello\nworld\n" = 3 lines
- "" (empty string) = 1 line (splits to [''])
"""
from typing import Protocol

from fastapi import HTTPException

from schemas.content_metadata import ContentMetadata


class HasContentMetadata(Protocol):
    """Protocol for response objects that support partial content reads."""

    content: str | None
    content_metadata: ContentMetadata | None


def count_lines(content: str) -> int:
    r"""
    Count the number of lines in content.

    Uses simple split semantics: len(content.split('\n'))

    Args:
        content: The text content to count lines in.

    Returns:
        Number of lines (minimum 1 for empty string).
    """
    return len(content.split("\n"))


def extract_lines(content: str, start_line: int, end_line: int) -> str:
    """
    Extract a range of lines from content.

    Args:
        content: The text content to extract from.
        start_line: First line to include (1-indexed).
        end_line: Last line to include (1-indexed, inclusive).

    Returns:
        The extracted lines joined with newlines.

    Raises:
        ValueError: If start_line < 1 or start_line > end_line.

    Note:
        Caller is responsible for validating that start_line <= total_lines.
        This function does not validate against total line count.
    """
    if start_line < 1:
        raise ValueError("start_line must be >= 1")
    if start_line > end_line:
        raise ValueError("start_line must be <= end_line")

    lines = content.split("\n")
    # Convert to 0-indexed, end_line is inclusive so we use end_line (not end_line - 1)
    selected = lines[start_line - 1 : end_line]
    return "\n".join(selected)


def build_content_metadata(
    content: str,
    start_line: int | None,
    end_line: int | None,
) -> tuple[str, ContentMetadata]:
    """
    Process content for partial read and build metadata.

    Handles parameter defaults and returns both the (possibly truncated)
    content and its metadata.

    Args:
        content: The full text content.
        start_line: Requested start line (1-indexed), or None for default (1).
        end_line: Requested end line (1-indexed), or None for default (total_lines).

    Returns:
        Tuple of (processed_content, metadata).

    Raises:
        ValueError: If start_line > total_lines or start_line > end_line.
    """
    total_lines = count_lines(content)

    # Determine if this is a partial read request
    is_partial = start_line is not None or end_line is not None

    # Apply defaults
    actual_start = start_line if start_line is not None else 1
    actual_end = end_line if end_line is not None else total_lines

    # Validate start_line
    if actual_start > total_lines:
        raise ValueError(
            f"start_line ({actual_start}) exceeds total lines ({total_lines})",
        )

    # Validate start <= end
    if actual_start > actual_end:
        raise ValueError(
            f"start_line ({actual_start}) must be <= end_line ({actual_end})",
        )

    # Clamp end_line to total_lines (no error)
    actual_end = min(actual_end, total_lines)

    # Extract content
    result_content = extract_lines(content, actual_start, actual_end)

    metadata = ContentMetadata(
        total_lines=total_lines,
        start_line=actual_start,
        end_line=actual_end,
        is_partial=is_partial,
    )

    return result_content, metadata


def apply_partial_read(
    response: HasContentMetadata,
    start_line: int | None,
    end_line: int | None,
) -> None:
    """
    Apply partial read processing to a response object, mutating it in place.

    This is a router-level helper that handles the common pattern of:
    1. Processing content with build_content_metadata if content exists
    2. Raising HTTPException if line params provided but content is null

    Args:
        response: A response object with content and content_metadata fields.
        start_line: Requested start line (1-indexed), or None.
        end_line: Requested end line (1-indexed), or None.

    Raises:
        HTTPException: 400 if content is null but line params provided,
                       or if line range is invalid.
    """
    if response.content is not None:
        try:
            processed_content, metadata = build_content_metadata(
                response.content, start_line, end_line,
            )
            response.content = processed_content
            response.content_metadata = metadata
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif start_line is not None or end_line is not None:
        raise HTTPException(
            status_code=400,
            detail="Content is empty; cannot retrieve lines",
        )
