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
        List of normalized tags (lowercase, trimmed), with empty strings filtered out.

    Raises:
        ValueError: If any tag has invalid format.
    """
    normalized = []
    for tag in tags:
        trimmed = tag.lower().strip()
        if not trimmed:
            continue  # Skip empty tags silently
        normalized.append(validate_and_normalize_tag(trimmed))
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
        The validated name.

    Raises:
        ValueError: If name is empty, too long, or has invalid format.
    """
    settings = get_settings()
    if not name:
        raise ValueError("Argument name cannot be empty")
    if len(name) > settings.max_argument_name_length:
        max_len = settings.max_argument_name_length
        raise ValueError(
            f"Argument name exceeds maximum length of {max_len} characters "
            f"(got {len(name)} characters).",
        )
    if not ARGUMENT_NAME_PATTERN.match(name):
        raise ValueError(
            f"Invalid argument name format: '{name}'. "
            "Must start with a lowercase letter and contain only lowercase letters, "
            "numbers, and underscores (e.g., 'code_to_review').",
        )
    return name
