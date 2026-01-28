"""
Shared validation functions for Pydantic schemas.

This module contains validators used across multiple entity schemas (bookmarks, notes, prompts).
Entity-specific content validators remain in their respective schema modules.
"""
import re

from core.config import get_settings

# Tag format: lowercase alphanumeric with hyphens (e.g., 'machine-learning', 'web-dev')
# Note: This pattern is intentionally duplicated in the frontend (frontend/src/utils.ts)
# for immediate UX feedback. Backend validation ensures security. Keep both in sync.
TAG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# Prompt name format: lowercase alphanumeric with hyphens (e.g., 'code-review', 'explain-code')
# Must start and end with alphanumeric, hyphens only between segments
PROMPT_NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# Argument name format: valid Python/Jinja2 identifier
# Must start with lowercase letter, can contain lowercase letters, numbers, and underscores
ARGUMENT_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def normalize_preview(value: str | None) -> str | None:
    """Collapse newlines, tabs, and runs of whitespace in a content preview."""
    if value is None:
        return None
    return re.sub(r"\s+", " ", value).strip()


def validate_and_normalize_tag(tag: str) -> str:
    """
    Normalize and validate a single tag.

    Args:
        tag: The tag string to validate.

    Returns:
        The normalized tag (lowercase, trimmed).

    Raises:
        ValueError: If tag is empty or has invalid format.
    """
    normalized = tag.lower().strip()
    if not normalized:
        raise ValueError("Tag name cannot be empty")
    if not TAG_PATTERN.match(normalized):
        raise ValueError(
            f"Invalid tag format: '{normalized}'. "
            "Use lowercase letters, numbers, and hyphens only (e.g., 'machine-learning').",
        )
    return normalized


def validate_and_normalize_tags(tags: list[str]) -> list[str]:
    """
    Normalize and validate a list of tags.

    Args:
        tags: List of tag strings to validate.

    Returns:
        List of normalized tags (lowercase, trimmed), with empty strings filtered out
        and duplicates removed (preserving first occurrence order).

    Raises:
        ValueError: If any tag has invalid format.
    """
    normalized = []
    seen: set[str] = set()
    for tag in tags:
        trimmed = tag.lower().strip()
        if not trimmed:
            continue  # Skip empty tags silently
        validated = validate_and_normalize_tag(trimmed)
        if validated not in seen:
            seen.add(validated)
            normalized.append(validated)
    return normalized


def validate_title_length(title: str | None) -> str | None:
    """Validate that title doesn't exceed maximum length."""
    settings = get_settings()
    if title is not None and len(title) > settings.max_title_length:
        raise ValueError(
            f"Title exceeds maximum length of {settings.max_title_length:,} characters "
            f"(got {len(title):,} characters).",
        )
    return title


def validate_description_length(description: str | None) -> str | None:
    """Validate that description doesn't exceed maximum length."""
    settings = get_settings()
    if description is not None and len(description) > settings.max_description_length:
        max_len = settings.max_description_length
        raise ValueError(
            f"Description exceeds maximum length of {max_len:,} characters "
            f"(got {len(description):,} characters).",
        )
    return description


def validate_prompt_name(name: str) -> str:
    """
    Validate prompt name format.

    Args:
        name: The prompt name to validate.

    Returns:
        The validated name (trimmed).

    Raises:
        ValueError: If name is empty, too long, or has invalid format.
    """
    settings = get_settings()
    trimmed = name.strip()
    if not trimmed:
        raise ValueError("Prompt name cannot be empty")
    if len(trimmed) > settings.max_prompt_name_length:
        raise ValueError(
            f"Prompt name exceeds maximum length of {settings.max_prompt_name_length} characters "
            f"(got {len(trimmed)} characters).",
        )
    if not PROMPT_NAME_PATTERN.match(trimmed):
        raise ValueError(
            f"Invalid prompt name format: '{trimmed}'. "
            "Use lowercase letters, numbers, and hyphens only (e.g., 'code-review'). "
            "Must start and end with a letter or number.",
        )
    return trimmed


def validate_argument_name(name: str) -> str:
    """
    Validate argument name format.

    Args:
        name: The argument name to validate.

    Returns:
        The validated name (trimmed).

    Raises:
        ValueError: If name is empty, too long, or has invalid format.
    """
    settings = get_settings()
    trimmed = name.strip()
    if not trimmed:
        raise ValueError("Argument name cannot be empty")
    if len(trimmed) > settings.max_argument_name_length:
        max_len = settings.max_argument_name_length
        raise ValueError(
            f"Argument name exceeds maximum length of {max_len} characters "
            f"(got {len(trimmed)} characters).",
        )
    if not ARGUMENT_NAME_PATTERN.match(trimmed):
        raise ValueError(
            f"Invalid argument name format: '{trimmed}'. "
            "Must start with a lowercase letter and contain only lowercase letters, "
            "numbers, and underscores (e.g., 'code_to_review').",
        )
    return trimmed


def check_duplicate_argument_names(arguments: list | None) -> None:
    """
    Check for duplicate argument names in a list of arguments.

    Args:
        arguments: List of argument objects with 'name' attribute, or None.

    Raises:
        ValueError: If duplicate argument names are found.
    """
    if not arguments:
        return
    names = [arg.name for arg in arguments]
    duplicates = [name for name in names if names.count(name) > 1]
    if duplicates:
        unique_duplicates = sorted(set(duplicates))
        raise ValueError(
            f"Duplicate argument name(s): {', '.join(unique_duplicates)}. "
            "Each argument must have a unique name.",
        )
