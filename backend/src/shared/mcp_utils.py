"""Shared utilities for MCP servers."""

from pathlib import Path
from typing import Any

import yaml


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


def load_instructions(directory: Path) -> str:
    """Load instructions.md from the given directory."""
    return (directory / "instructions.md").read_text().strip()


def load_tool_descriptions(directory: Path) -> dict[str, Any]:
    """Load tool descriptions from tools.yaml, stripping YAML block-scalar whitespace."""
    with (directory / "tools.yaml").open() as f:
        data = yaml.safe_load(f)
    for tool in data.values():
        if isinstance(tool.get("description"), str):
            tool["description"] = tool["description"].strip()
        params = tool.get("parameters", {})
        for key in params:
            if isinstance(params[key], str):
                params[key] = params[key].strip()
    return data
