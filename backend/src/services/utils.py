"""Shared utility functions for service layer."""


def escape_ilike(value: str) -> str:
    r"""
    Escape special ILIKE characters for safe use in LIKE/ILIKE patterns.

    PostgreSQL LIKE/ILIKE treats these characters specially:
    - % matches any sequence of characters
    - _ matches any single character
    - \\ is the escape character

    This function escapes them so they match literally.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
