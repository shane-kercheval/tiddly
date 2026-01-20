"""Tests for content search service."""

from services.content_search_service import (
    get_match_context,
    search_in_content,
)


class TestSearchInContent:
    """Tests for search_in_content function."""

    def test__search_in_content__single_match_in_content(self) -> None:
        """Test finding a single match in content field."""
        content = "line 1\nline 2 with target\nline 3"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="target",
            fields=["content"],
            case_sensitive=False,
            context_lines=1,
        )
        assert len(matches) == 1
        assert matches[0].field == "content"
        assert matches[0].line == 2
        assert "line 1" in matches[0].context
        assert "line 2 with target" in matches[0].context
        assert "line 3" in matches[0].context

    def test__search_in_content__multiple_matches_across_lines(self) -> None:
        """Test finding multiple matches across different lines."""
        content = "foo bar\nbar baz\nqux bar"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="bar",
            fields=["content"],
            case_sensitive=False,
            context_lines=0,
        )
        assert len(matches) == 3
        assert matches[0].line == 1
        assert matches[1].line == 2
        assert matches[2].line == 3

    def test__search_in_content__multiple_occurrences_same_line(self) -> None:
        """Test that multiple occurrences on the same line are counted separately."""
        content = "foo bar foo baz foo"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="foo",
            fields=["content"],
            case_sensitive=False,
            context_lines=0,
        )
        # Should find 3 matches, all on line 1
        assert len(matches) == 3
        assert all(m.line == 1 for m in matches)

    def test__search_in_content__no_matches_returns_empty_list(self) -> None:
        """Test that no matches returns empty list (not error)."""
        content = "line 1\nline 2\nline 3"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="nonexistent",
            fields=["content"],
        )
        assert matches == []

    def test__search_in_content__case_insensitive_default(self) -> None:
        """Test that search is case-insensitive by default."""
        content = "Hello World"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="WORLD",
            fields=["content"],
            case_sensitive=False,
        )
        assert len(matches) == 1
        assert matches[0].line == 1

    def test__search_in_content__case_sensitive(self) -> None:
        """Test case-sensitive search."""
        content = "Hello World"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="WORLD",
            fields=["content"],
            case_sensitive=True,
        )
        assert matches == []

        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="World",
            fields=["content"],
            case_sensitive=True,
        )
        assert len(matches) == 1

    def test__search_in_content__title_field(self) -> None:
        """Test searching in title field."""
        matches = search_in_content(
            content=None,
            title="My Important Title",
            description=None,
            query="important",
            fields=["title"],
        )
        assert len(matches) == 1
        assert matches[0].field == "title"
        assert matches[0].line is None
        assert matches[0].context == "My Important Title"

    def test__search_in_content__description_field(self) -> None:
        """Test searching in description field."""
        matches = search_in_content(
            content=None,
            title=None,
            description="A detailed description of the item",
            query="detailed",
            fields=["description"],
        )
        assert len(matches) == 1
        assert matches[0].field == "description"
        assert matches[0].line is None
        assert matches[0].context == "A detailed description of the item"

    def test__search_in_content__multiple_fields(self) -> None:
        """Test searching across multiple fields."""
        matches = search_in_content(
            content="The content has keyword here",
            title="Title with keyword",
            description="Description also has keyword",
            query="keyword",
            fields=["content", "title", "description"],
        )
        assert len(matches) == 3
        fields = {m.field for m in matches}
        assert fields == {"content", "title", "description"}

    def test__search_in_content__none_content_skipped(self) -> None:
        """Test that None content is gracefully handled."""
        matches = search_in_content(
            content=None,
            title=None,
            description=None,
            query="anything",
            fields=["content", "title", "description"],
        )
        assert matches == []

    def test__search_in_content__context_lines_truncation_at_start(self) -> None:
        """Test context lines are truncated at the start of content."""
        content = "match here\nline 2\nline 3"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="match",
            fields=["content"],
            context_lines=5,  # Request more context than available
        )
        assert len(matches) == 1
        assert matches[0].line == 1
        # Context should include available lines, not error
        assert "match here" in matches[0].context

    def test__search_in_content__context_lines_truncation_at_end(self) -> None:
        """Test context lines are truncated at the end of content."""
        content = "line 1\nline 2\nmatch here"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="match",
            fields=["content"],
            context_lines=5,
        )
        assert len(matches) == 1
        assert matches[0].line == 3
        assert "match here" in matches[0].context

    def test__search_in_content__context_lines_zero(self) -> None:
        """Test with zero context lines (only matching line)."""
        content = "line 1\nline 2 match\nline 3"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="match",
            fields=["content"],
            context_lines=0,
        )
        assert len(matches) == 1
        assert matches[0].context == "line 2 match"

    def test__search_in_content__empty_content(self) -> None:
        """Test searching in empty content."""
        matches = search_in_content(
            content="",
            title=None,
            description=None,
            query="anything",
            fields=["content"],
        )
        assert matches == []

    def test__search_in_content__special_characters_in_query(self) -> None:
        """Test that special characters in query are matched literally."""
        content = "def function(self, arg):\nreturn self.value"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="(self,",
            fields=["content"],
        )
        assert len(matches) == 1
        assert matches[0].line == 1

    def test__search_in_content__line_numbers_are_1_indexed(self) -> None:
        """Test that line numbers are 1-indexed (not 0-indexed)."""
        content = "first line\nsecond line\nthird line"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="first",
            fields=["content"],
            context_lines=0,
        )
        assert len(matches) == 1
        assert matches[0].line == 1

        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="third",
            fields=["content"],
            context_lines=0,
        )
        assert len(matches) == 1
        assert matches[0].line == 3

    def test__search_in_content__trailing_newline_line_count(self) -> None:
        """Test line counting with trailing newline matches editor convention."""
        # "hello\n" should be 2 lines (line 1: "hello", line 2: "")
        content = "hello\n"
        lines = content.split("\n")
        assert len(lines) == 2

        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="hello",
            fields=["content"],
            context_lines=0,
        )
        assert len(matches) == 1
        assert matches[0].line == 1

    def test__search_in_content__multiline_query(self) -> None:
        """Test searching for a multiline pattern."""
        content = "line one\nline two\nline three"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="one\nline two",  # Spans two lines
            fields=["content"],
            context_lines=1,
        )
        # Should find the multiline pattern
        assert len(matches) == 1
        assert matches[0].line == 1  # Starts on line 1
        # Context should include lines around the multiline match
        assert "line one" in matches[0].context
        assert "line two" in matches[0].context
        assert "line three" in matches[0].context

    def test__search_in_content__multiline_query_not_found(self) -> None:
        """Test that a multiline pattern that doesn't exist returns no matches."""
        content = "line one\nline two\nline three"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="one\nline three",  # These lines aren't adjacent
            fields=["content"],
        )
        assert matches == []

    def test__search_in_content__match_at_line_boundary(self) -> None:
        """Test matching text that starts/ends at line boundaries."""
        content = "prefix target suffix\ntarget"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="target",
            fields=["content"],
            context_lines=0,
        )
        assert len(matches) == 2
        assert matches[0].line == 1
        assert matches[1].line == 2

    def test__search_in_content__overlapping_context_adjacent_matches(self) -> None:
        """Test context extraction when matches are adjacent (overlapping windows)."""
        content = "line 1\nmatch A\nline 3\nmatch B\nline 5"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="match",
            fields=["content"],
            context_lines=2,
        )
        assert len(matches) == 2
        # Match A (line 2) context should be lines 1-4 (2 before=line 1, 2 after=lines 3-4)
        # Note: "line 1" is the only line before, so context starts at line 1
        assert "line 1" in matches[0].context
        assert "match A" in matches[0].context
        assert "line 3" in matches[0].context
        assert "match B" in matches[0].context
        # Match B (line 4) context should be lines 2-5
        assert "match A" in matches[1].context
        assert "line 3" in matches[1].context
        assert "match B" in matches[1].context
        assert "line 5" in matches[1].context

    def test__search_in_content__non_overlapping_matches(self) -> None:
        """
        Test that matches are non-overlapping (important for str_replace use case).

        Searching for "aa" in "aaaa" returns 2 non-overlapping matches, not 3
        overlapping ones. This aligns with how str_replace would work: replacing
        "aa" with "bb" in "aaaa" produces "bbbb", which has 2 logical replacements.
        """
        content = "aaaa"
        matches = search_in_content(
            content=content,
            title=None,
            description=None,
            query="aa",
            fields=["content"],
            context_lines=0,
        )
        # Non-overlapping: positions 0 and 2, not 0, 1, and 2
        assert len(matches) == 2
        assert all(m.line == 1 for m in matches)


class TestGetMatchContext:
    """Tests for get_match_context function."""

    def test__get_match_context__basic(self) -> None:
        """Test basic context extraction."""
        content = "line 1\nline 2\nline 3\nline 4\nline 5"
        context = get_match_context(content, match_start_line=3, context_lines=1)
        assert context == "line 2\nline 3\nline 4"

    def test__get_match_context__start_of_content(self) -> None:
        """Test context at start of content."""
        content = "line 1\nline 2\nline 3"
        context = get_match_context(content, match_start_line=1, context_lines=2)
        assert context == "line 1\nline 2\nline 3"

    def test__get_match_context__end_of_content(self) -> None:
        """Test context at end of content."""
        content = "line 1\nline 2\nline 3"
        context = get_match_context(content, match_start_line=3, context_lines=2)
        assert context == "line 1\nline 2\nline 3"

    def test__get_match_context__zero_context_lines(self) -> None:
        """Test with zero context lines."""
        content = "line 1\nline 2\nline 3"
        context = get_match_context(content, match_start_line=2, context_lines=0)
        assert context == "line 2"
