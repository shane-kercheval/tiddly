"""Shared formatting utilities for MCP servers."""

from typing import Any


def format_filter_expression(expr: dict[str, Any]) -> str:
    """
    Convert filter expression to human-readable rule string.

    Example: {"groups": [{"tags": ["work", "project"]}, {"tags": ["client"]}],
             "group_operator": "OR"}
    Returns: "(work AND project) OR client"
    """
    groups = expr.get("groups", [])
    group_operator = expr.get("group_operator", "OR")
    parts = []
    for group in groups:
        tags = group.get("tags", [])
        if len(tags) == 1:
            parts.append(tags[0])
        elif len(tags) > 1:
            parts.append(f"({' AND '.join(tags)})")
    return f" {group_operator} ".join(parts) if parts else "All items"
