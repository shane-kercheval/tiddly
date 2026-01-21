"""Tests for content edit service (str_replace functionality)."""

import pytest

from services.content_edit_service import (
    MultipleMatchesError,
    NoMatchError,
    StrReplaceResult,
    str_replace,
    _find_all_matches,
    _get_line_number,
    _normalize_whitespace,
    _map_normalized_to_original,
    _adjust_for_crlf,
)


class TestStrReplace:
    """Tests for str_replace function."""

    def test__str_replace__single_exact_match(self) -> None:
        """Test successful replacement with single exact match."""
        content = "Hello world"
        result = str_replace(content, "world", "universe")
        assert result.new_content == "Hello universe"
        assert result.match_type == "exact"
        assert result.line == 1

    def test__str_replace__single_match_multiline(self) -> None:
        """Test replacement in multiline content."""
        content = "line 1\nline 2 target\nline 3"
        result = str_replace(content, "target", "replaced")
        assert result.new_content == "line 1\nline 2 replaced\nline 3"
        assert result.match_type == "exact"
        assert result.line == 2

    def test__str_replace__multiline_old_str(self) -> None:
        """Test replacement with multiline old_str."""
        content = "line 1\nline 2\nline 3\nline 4"
        result = str_replace(content, "line 2\nline 3", "replaced")
        assert result.new_content == "line 1\nreplaced\nline 4"
        assert result.match_type == "exact"
        assert result.line == 2

    def test__str_replace__no_match_raises_error(self) -> None:
        """Test that no match raises NoMatchError."""
        content = "Hello world"
        with pytest.raises(NoMatchError):
            str_replace(content, "nonexistent", "replaced")

    def test__str_replace__multiple_exact_matches_raises_error(self) -> None:
        """Test that multiple matches raises MultipleMatchesError."""
        content = "foo bar foo baz foo"
        with pytest.raises(MultipleMatchesError) as exc_info:
            str_replace(content, "foo", "replaced")
        assert len(exc_info.value.matches) == 3
        # All matches on line 1
        assert all(line == 1 for line, _ in exc_info.value.matches)

    def test__str_replace__multiple_matches_has_context(self) -> None:
        """Test that MultipleMatchesError includes context for each match."""
        content = "line 1\nfoo here\nline 3\nfoo again\nline 5"
        with pytest.raises(MultipleMatchesError) as exc_info:
            str_replace(content, "foo", "replaced", context_lines=1)
        assert len(exc_info.value.matches) == 2
        # First match on line 2
        assert exc_info.value.matches[0][0] == 2
        assert "foo here" in exc_info.value.matches[0][1]
        # Second match on line 4
        assert exc_info.value.matches[1][0] == 4
        assert "foo again" in exc_info.value.matches[1][1]

    def test__str_replace__empty_new_str_deletes(self) -> None:
        """Test that empty new_str performs deletion."""
        content = "Hello world"
        result = str_replace(content, " world", "")
        assert result.new_content == "Hello"
        assert result.match_type == "exact"

    def test__str_replace__preserves_surrounding_content(self) -> None:
        """Test that content before and after match is preserved."""
        content = "prefix TARGET suffix"
        result = str_replace(content, "TARGET", "REPLACED")
        assert result.new_content == "prefix REPLACED suffix"

    def test__str_replace__at_start_of_content(self) -> None:
        """Test replacement at the very start of content."""
        content = "target at start"
        result = str_replace(content, "target", "replaced")
        assert result.new_content == "replaced at start"
        assert result.line == 1

    def test__str_replace__at_end_of_content(self) -> None:
        """Test replacement at the very end of content."""
        content = "content at target"
        result = str_replace(content, "target", "replaced")
        assert result.new_content == "content at replaced"
        assert result.line == 1

    def test__str_replace__entire_content(self) -> None:
        """Test replacing the entire content."""
        content = "replace me entirely"
        result = str_replace(content, "replace me entirely", "new content")
        assert result.new_content == "new content"
        assert result.match_type == "exact"


class TestStrReplaceWhitespaceNormalized:
    """Tests for whitespace-normalized matching in str_replace."""

    def test__str_replace__whitespace_normalized_trailing_spaces(self) -> None:
        """Test matching with trailing whitespace differences."""
        content = "line 1  \nline 2\nline 3"  # Line 1 has trailing spaces
        result = str_replace(content, "line 1\nline 2", "replaced")
        assert result.match_type == "whitespace_normalized"
        # The replacement should happen at the original positions
        assert "replaced\nline 3" in result.new_content

    def test__str_replace__whitespace_normalized_crlf(self) -> None:
        """Test matching with CRLF line endings in content."""
        content = "line 1\r\nline 2\r\nline 3"
        result = str_replace(content, "line 1\nline 2", "replaced")
        assert result.match_type == "whitespace_normalized"
        assert "replaced" in result.new_content
        # Line 3 should still be there
        assert "line 3" in result.new_content

    def test__str_replace__whitespace_normalized_both_crlf_and_trailing(self) -> None:
        """Test with both CRLF and trailing whitespace."""
        content = "line 1  \r\nline 2\r\nline 3"
        result = str_replace(content, "line 1\nline 2", "replaced")
        assert result.match_type == "whitespace_normalized"

    def test__str_replace__exact_preferred_over_normalized(self) -> None:
        """Test that exact match is preferred when both would work."""
        content = "hello world"
        result = str_replace(content, "hello", "hi")
        assert result.match_type == "exact"

    def test__str_replace__normalized_only_when_exact_fails(self) -> None:
        """Test that normalized matching is fallback, not primary."""
        content = "hello  "  # Trailing spaces
        # Exact match for "hello  " would work
        result = str_replace(content, "hello  ", "hi")
        assert result.match_type == "exact"

        # "hello" is an exact substring of "hello  ", so it matches exactly
        result = str_replace(content, "hello", "hi")
        assert result.match_type == "exact"
        assert result.new_content == "hi  "  # Trailing spaces preserved

    def test__str_replace__normalized_needed_for_multiline_trailing(self) -> None:
        """Test that normalized matching is used for multiline trailing whitespace."""
        # old_str has no trailing whitespace, but content does on line 1
        content = "line 1  \nline 2"
        result = str_replace(content, "line 1\nline 2", "replaced")
        assert result.match_type == "whitespace_normalized"

    def test__str_replace__normalized_no_match(self) -> None:
        """Test that NoMatchError is raised when neither exact nor normalized matches."""
        content = "hello world"
        with pytest.raises(NoMatchError):
            str_replace(content, "goodbye", "hi")

    def test__str_replace__normalized_multiple_matches(self) -> None:
        """Test MultipleMatchesError with normalized matching."""
        content = "foo  \nbar\nfoo  \nbaz"  # Both "foo" have trailing spaces
        with pytest.raises(MultipleMatchesError) as exc_info:
            str_replace(content, "foo", "replaced")
        assert len(exc_info.value.matches) == 2


class TestStrReplaceNewStrVerbatim:
    """Tests that new_str is used exactly as provided (no normalization)."""

    def test__str_replace__new_str_with_crlf_preserved(self) -> None:
        """Test that CRLF in new_str is preserved."""
        content = "old content"
        result = str_replace(content, "old content", "new\r\ncontent")
        assert result.new_content == "new\r\ncontent"

    def test__str_replace__new_str_with_trailing_spaces_preserved(self) -> None:
        """Test that trailing spaces in new_str are preserved."""
        content = "old"
        result = str_replace(content, "old", "new  ")
        assert result.new_content == "new  "

    def test__str_replace__new_str_empty_string(self) -> None:
        """Test that empty string new_str deletes content."""
        content = "hello world"
        result = str_replace(content, "hello ", "")
        assert result.new_content == "world"


class TestFindAllMatches:
    """Tests for _find_all_matches helper function."""

    def test__find_all_matches__single_match(self) -> None:
        """Test finding a single match."""
        matches = _find_all_matches("hello world", "world")
        assert matches == [(6, 11)]

    def test__find_all_matches__multiple_matches(self) -> None:
        """Test finding multiple non-overlapping matches."""
        matches = _find_all_matches("foo bar foo baz foo", "foo")
        assert matches == [(0, 3), (8, 11), (16, 19)]

    def test__find_all_matches__no_match(self) -> None:
        """Test when pattern is not found."""
        matches = _find_all_matches("hello world", "xyz")
        assert matches == []

    def test__find_all_matches__non_overlapping(self) -> None:
        """Test that matches are non-overlapping."""
        matches = _find_all_matches("aaaa", "aa")
        # Should find 2 matches at positions 0 and 2, not 3 overlapping
        assert matches == [(0, 2), (2, 4)]

    def test__find_all_matches__empty_content(self) -> None:
        """Test with empty content."""
        matches = _find_all_matches("", "pattern")
        assert matches == []


class TestGetLineNumber:
    """Tests for _get_line_number helper function."""

    def test__get_line_number__first_line(self) -> None:
        """Test position on first line."""
        content = "hello world"
        assert _get_line_number(content, 0) == 1
        assert _get_line_number(content, 5) == 1

    def test__get_line_number__second_line(self) -> None:
        """Test position on second line."""
        content = "line 1\nline 2"
        assert _get_line_number(content, 7) == 2  # Start of line 2

    def test__get_line_number__multiple_lines(self) -> None:
        """Test positions across multiple lines."""
        content = "line 1\nline 2\nline 3"
        assert _get_line_number(content, 0) == 1
        assert _get_line_number(content, 7) == 2
        assert _get_line_number(content, 14) == 3


class TestNormalizeWhitespace:
    """Tests for _normalize_whitespace helper function."""

    def test__normalize_whitespace__crlf_to_lf(self) -> None:
        """Test CRLF is converted to LF."""
        text = "line 1\r\nline 2"
        normalized = _normalize_whitespace(text)
        assert normalized == "line 1\nline 2"
        assert "\r" not in normalized

    def test__normalize_whitespace__trailing_spaces_stripped(self) -> None:
        """Test trailing spaces are stripped from each line."""
        text = "line 1  \nline 2\t\nline 3"
        normalized = _normalize_whitespace(text)
        assert normalized == "line 1\nline 2\nline 3"

    def test__normalize_whitespace__preserves_indentation(self) -> None:
        """Test that leading whitespace (indentation) is preserved."""
        text = "  indented line  \n    more indented  "
        normalized = _normalize_whitespace(text)
        assert normalized == "  indented line\n    more indented"

    def test__normalize_whitespace__empty_string(self) -> None:
        """Test normalizing empty string."""
        assert _normalize_whitespace("") == ""

    def test__normalize_whitespace__only_whitespace(self) -> None:
        """Test normalizing string with only whitespace."""
        text = "   \n   "
        normalized = _normalize_whitespace(text)
        assert normalized == "\n"


class TestMapNormalizedToOriginal:
    """Tests for _map_normalized_to_original helper function."""

    def test__map_normalized_to_original__no_changes(self) -> None:
        """Test mapping when content is already normalized."""
        original = "hello world"
        normalized = _normalize_whitespace(original)
        # Position 6 ("w" in "world") should map to same position
        assert _map_normalized_to_original(original, normalized, 6) == 6

    def test__map_normalized_to_original__trailing_spaces(self) -> None:
        """Test mapping with trailing spaces stripped."""
        original = "hello  \nworld"  # "hello" has trailing spaces
        normalized = _normalize_whitespace(original)  # "hello\nworld"
        # Position 6 in normalized is "w", which is at position 8 in original
        assert _map_normalized_to_original(original, normalized, 6) == 8

    def test__map_normalized_to_original__crlf(self) -> None:
        """Test mapping with CRLF line endings."""
        original = "hello\r\nworld"
        normalized = _normalize_whitespace(original)  # "hello\nworld"
        # Position 6 in normalized is "w", which is at position 7 in original
        assert _map_normalized_to_original(original, normalized, 6) == 7

    def test__map_normalized_to_original__multiple_crlf(self) -> None:
        """Test mapping with multiple CRLF line endings."""
        original = "line 1\r\nline 2\r\nline 3"
        normalized = _normalize_whitespace(original)
        # "line 3" starts at position 14 in normalized
        # In original: "line 1\r\n" (8) + "line 2\r\n" (8) = position 16
        assert _map_normalized_to_original(original, normalized, 14) == 16


class TestAdjustForCrlf:
    """Tests for _adjust_for_crlf helper function."""

    def test__adjust_for_crlf__no_crlf(self) -> None:
        """Test with no CRLF in content."""
        original = "hello\nworld"
        # Position 6 maps to position 6
        assert _adjust_for_crlf(original, 6) == 6

    def test__adjust_for_crlf__single_crlf(self) -> None:
        """Test with single CRLF."""
        original = "hello\r\nworld"
        # Position 6 (after "hello\n" in normalized) maps to position 7 in original
        assert _adjust_for_crlf(original, 6) == 7

    def test__adjust_for_crlf__multiple_crlf(self) -> None:
        """Test with multiple CRLF sequences."""
        original = "a\r\nb\r\nc"
        # Positions: a=0, \r=1, \n=2, b=3, \r=4, \n=5, c=6
        # Normalized positions: a=0, \n=1, b=2, \n=3, c=4
        # Normalized pos 4 (c) maps to original pos 6
        assert _adjust_for_crlf(original, 4) == 6


class TestStrReplaceLineNumber:
    """Tests for line number accuracy in str_replace results."""

    def test__str_replace__line_number_first_line(self) -> None:
        """Test line number when match is on first line."""
        content = "target on first line\nline 2\nline 3"
        result = str_replace(content, "target", "replaced")
        assert result.line == 1

    def test__str_replace__line_number_middle_line(self) -> None:
        """Test line number when match is on middle line."""
        content = "line 1\ntarget on second\nline 3"
        result = str_replace(content, "target", "replaced")
        assert result.line == 2

    def test__str_replace__line_number_last_line(self) -> None:
        """Test line number when match is on last line."""
        content = "line 1\nline 2\ntarget on third"
        result = str_replace(content, "target", "replaced")
        assert result.line == 3

    def test__str_replace__line_number_with_trailing_newline(self) -> None:
        """Test line number with trailing newline."""
        content = "line 1\nline 2 target\n"
        result = str_replace(content, "target", "replaced")
        assert result.line == 2


class TestStrReplaceResult:
    """Tests for StrReplaceResult dataclass."""

    def test__str_replace_result__fields(self) -> None:
        """Test that StrReplaceResult has expected fields."""
        result = StrReplaceResult(
            new_content="new content",
            match_type="exact",
            line=5,
        )
        assert result.new_content == "new content"
        assert result.match_type == "exact"
        assert result.line == 5
