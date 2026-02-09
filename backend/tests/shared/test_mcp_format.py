"""Tests for shared MCP formatting utilities."""

from shared.mcp_format import format_filter_expression


def test__format_filter_expression__single_tag() -> None:
    """Single tag group renders without parentheses."""
    expr = {"groups": [{"tags": ["python"]}], "group_operator": "OR"}
    assert format_filter_expression(expr) == "python"


def test__format_filter_expression__multi_tag_group() -> None:
    """Multiple tags in one group are joined with AND."""
    expr = {"groups": [{"tags": ["work", "project"]}], "group_operator": "OR"}
    assert format_filter_expression(expr) == "(work AND project)"


def test__format_filter_expression__multiple_groups_or() -> None:
    """Multiple groups joined with OR operator."""
    expr = {
        "groups": [{"tags": ["work", "project"]}, {"tags": ["client"]}],
        "group_operator": "OR",
    }
    assert format_filter_expression(expr) == "(work AND project) OR client"


def test__format_filter_expression__empty() -> None:
    """Empty expression returns 'All items'."""
    assert format_filter_expression({}) == "All items"
    assert format_filter_expression({"groups": []}) == "All items"


def test__format_filter_expression__empty_tags_in_group() -> None:
    """Groups with empty tags are skipped."""
    expr = {"groups": [{"tags": []}], "group_operator": "OR"}
    assert format_filter_expression(expr) == "All items"
