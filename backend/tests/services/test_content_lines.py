"""Tests for content lines service."""

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from schemas.content_metadata import ContentMetadata
from services.content_lines import (
    apply_partial_read,
    build_content_metadata,
    count_lines,
    extract_lines,
)


class TestCountLines:
    """Tests for count_lines function."""

    def test__count_lines__single_line_no_newline(self) -> None:
        """Test single line without trailing newline."""
        assert count_lines("hello") == 1

    def test__count_lines__single_line_with_newline(self) -> None:
        """Test single line with trailing newline counts as 2 lines."""
        assert count_lines("hello\n") == 2

    def test__count_lines__two_lines_no_trailing_newline(self) -> None:
        """Test two lines without trailing newline."""
        assert count_lines("hello\nworld") == 2

    def test__count_lines__two_lines_with_trailing_newline(self) -> None:
        """Test two lines with trailing newline counts as 3 lines."""
        assert count_lines("hello\nworld\n") == 3

    def test__count_lines__empty_string(self) -> None:
        """Test empty string counts as 1 line (splits to [''])."""
        assert count_lines("") == 1

    def test__count_lines__only_newlines(self) -> None:
        """Test content with only newlines."""
        assert count_lines("\n") == 2
        assert count_lines("\n\n") == 3
        assert count_lines("\n\n\n") == 4

    def test__count_lines__multiple_lines(self) -> None:
        """Test multiple lines."""
        assert count_lines("a\nb\nc\nd\ne") == 5


class TestExtractLines:
    """Tests for extract_lines function."""

    def test__extract_lines__single_line_from_multiline(self) -> None:
        """Test extracting a single line."""
        content = "line 1\nline 2\nline 3"
        assert extract_lines(content, 2, 2) == "line 2"

    def test__extract_lines__multiple_lines(self) -> None:
        """Test extracting multiple lines."""
        content = "line 1\nline 2\nline 3\nline 4"
        assert extract_lines(content, 2, 3) == "line 2\nline 3"

    def test__extract_lines__first_line(self) -> None:
        """Test extracting the first line."""
        content = "first\nsecond\nthird"
        assert extract_lines(content, 1, 1) == "first"

    def test__extract_lines__last_line(self) -> None:
        """Test extracting the last line."""
        content = "first\nsecond\nthird"
        assert extract_lines(content, 3, 3) == "third"

    def test__extract_lines__all_lines(self) -> None:
        """Test extracting all lines."""
        content = "first\nsecond\nthird"
        assert extract_lines(content, 1, 3) == "first\nsecond\nthird"

    def test__extract_lines__empty_string(self) -> None:
        """Test extracting from empty string (1 line)."""
        assert extract_lines("", 1, 1) == ""

    def test__extract_lines__with_trailing_newline(self) -> None:
        """Test extracting when content has trailing newline."""
        content = "line 1\nline 2\n"
        assert extract_lines(content, 1, 2) == "line 1\nline 2"
        assert extract_lines(content, 3, 3) == ""  # The empty line after trailing \n

    def test__extract_lines__start_line_less_than_1_raises(self) -> None:
        """Test that start_line < 1 raises ValueError."""
        with pytest.raises(ValueError, match="start_line must be >= 1"):
            extract_lines("hello", 0, 1)

    def test__extract_lines__start_greater_than_end_raises(self) -> None:
        """Test that start_line > end_line raises ValueError."""
        with pytest.raises(ValueError, match="start_line must be <= end_line"):
            extract_lines("hello\nworld", 3, 2)


class TestBuildContentMetadata:
    """Tests for build_content_metadata function."""

    def test__build_content_metadata__full_read_no_params(self) -> None:
        """Test full read when no line params provided."""
        content = "line 1\nline 2\nline 3"
        result_content, metadata = build_content_metadata(content, None, None)

        assert result_content == content
        assert metadata.total_lines == 3
        assert metadata.start_line == 1
        assert metadata.end_line == 3
        assert metadata.is_partial is False

    def test__build_content_metadata__partial_read_with_both_params(self) -> None:
        """Test partial read with both start_line and end_line."""
        content = "line 1\nline 2\nline 3\nline 4\nline 5"
        result_content, metadata = build_content_metadata(content, 2, 4)

        assert result_content == "line 2\nline 3\nline 4"
        assert metadata.total_lines == 5
        assert metadata.start_line == 2
        assert metadata.end_line == 4
        assert metadata.is_partial is True

    def test__build_content_metadata__start_line_only(self) -> None:
        """Test partial read with only start_line (reads to end)."""
        content = "line 1\nline 2\nline 3"
        result_content, metadata = build_content_metadata(content, 2, None)

        assert result_content == "line 2\nline 3"
        assert metadata.total_lines == 3
        assert metadata.start_line == 2
        assert metadata.end_line == 3
        assert metadata.is_partial is True

    def test__build_content_metadata__end_line_only(self) -> None:
        """Test partial read with only end_line (reads from line 1)."""
        content = "line 1\nline 2\nline 3"
        result_content, metadata = build_content_metadata(content, None, 2)

        assert result_content == "line 1\nline 2"
        assert metadata.total_lines == 3
        assert metadata.start_line == 1
        assert metadata.end_line == 2
        assert metadata.is_partial is True

    def test__build_content_metadata__end_line_clamped(self) -> None:
        """Test that end_line > total_lines is clamped (no error)."""
        content = "line 1\nline 2"
        result_content, metadata = build_content_metadata(content, 1, 100)

        assert result_content == "line 1\nline 2"
        assert metadata.total_lines == 2
        assert metadata.start_line == 1
        assert metadata.end_line == 2
        assert metadata.is_partial is True

    def test__build_content_metadata__start_line_exceeds_total_raises(self) -> None:
        """Test that start_line > total_lines raises ValueError."""
        content = "line 1\nline 2"
        with pytest.raises(ValueError, match=r"start_line \(10\) exceeds total lines \(2\)"):
            build_content_metadata(content, 10, 20)

    def test__build_content_metadata__start_greater_than_end_raises(self) -> None:
        """Test that start_line > end_line raises ValueError."""
        content = "line 1\nline 2\nline 3"
        with pytest.raises(ValueError, match=r"start_line \(3\) must be <= end_line \(2\)"):
            build_content_metadata(content, 3, 2)

    def test__build_content_metadata__empty_string(self) -> None:
        """Test with empty string content (1 line)."""
        content = ""
        result_content, metadata = build_content_metadata(content, None, None)

        assert result_content == ""
        assert metadata.total_lines == 1
        assert metadata.start_line == 1
        assert metadata.end_line == 1
        assert metadata.is_partial is False

    def test__build_content_metadata__empty_string_with_start_line(self) -> None:
        """Test empty string with start_line=1 succeeds."""
        content = ""
        result_content, metadata = build_content_metadata(content, 1, 1)

        assert result_content == ""
        assert metadata.total_lines == 1
        assert metadata.start_line == 1
        assert metadata.end_line == 1
        assert metadata.is_partial is True

    def test__build_content_metadata__single_line_content(self) -> None:
        """Test with single line content."""
        content = "single line"
        result_content, metadata = build_content_metadata(content, 1, 1)

        assert result_content == "single line"
        assert metadata.total_lines == 1
        assert metadata.start_line == 1
        assert metadata.end_line == 1
        assert metadata.is_partial is True

    def test__build_content_metadata__trailing_newline(self) -> None:
        """Test content with trailing newline."""
        content = "line 1\n"  # 2 lines: "line 1" and ""
        result_content, metadata = build_content_metadata(content, None, None)

        assert result_content == "line 1\n"
        assert metadata.total_lines == 2
        assert metadata.start_line == 1
        assert metadata.end_line == 2
        assert metadata.is_partial is False

    def test__build_content_metadata__extract_empty_line_after_newline(self) -> None:
        """Test extracting the empty line created by trailing newline."""
        content = "line 1\n"  # 2 lines: "line 1" and ""
        result_content, metadata = build_content_metadata(content, 2, 2)

        assert result_content == ""
        assert metadata.total_lines == 2
        assert metadata.start_line == 2
        assert metadata.end_line == 2
        assert metadata.is_partial is True


class MockResponse(BaseModel):
    """Mock response object for testing apply_partial_read."""

    content: str | None
    content_metadata: ContentMetadata | None = None


class TestApplyPartialRead:
    """Tests for apply_partial_read function."""

    def test__apply_partial_read__with_content_full_read(self) -> None:
        """Test full read when no line params provided."""
        response = MockResponse(content="line 1\nline 2\nline 3")
        apply_partial_read(response, None, None)

        assert response.content == "line 1\nline 2\nline 3"
        assert response.content_metadata is not None
        assert response.content_metadata.total_lines == 3
        assert response.content_metadata.is_partial is False

    def test__apply_partial_read__with_content_partial_read(self) -> None:
        """Test partial read with line params."""
        response = MockResponse(content="line 1\nline 2\nline 3")
        apply_partial_read(response, 2, 2)

        assert response.content == "line 2"
        assert response.content_metadata is not None
        assert response.content_metadata.total_lines == 3
        assert response.content_metadata.start_line == 2
        assert response.content_metadata.end_line == 2
        assert response.content_metadata.is_partial is True

    def test__apply_partial_read__null_content_no_params(self) -> None:
        """Test that null content with no params leaves response unchanged."""
        response = MockResponse(content=None)
        apply_partial_read(response, None, None)

        assert response.content is None
        assert response.content_metadata is None

    def test__apply_partial_read__null_content_with_line_params_raises(self) -> None:
        """Test that null content with line params raises HTTPException."""
        response = MockResponse(content=None)

        with pytest.raises(HTTPException) as exc_info:
            apply_partial_read(response, 1, None)

        assert exc_info.value.status_code == 400
        assert "Content is empty" in exc_info.value.detail

    def test__apply_partial_read__invalid_range_raises(self) -> None:
        """Test that invalid line range raises HTTPException."""
        response = MockResponse(content="line 1\nline 2")

        with pytest.raises(HTTPException) as exc_info:
            apply_partial_read(response, 10, None)

        assert exc_info.value.status_code == 400
        assert "exceeds total lines" in exc_info.value.detail

    def test__apply_partial_read__start_greater_than_end_raises(self) -> None:
        """Test that start > end raises HTTPException."""
        response = MockResponse(content="line 1\nline 2\nline 3")

        with pytest.raises(HTTPException) as exc_info:
            apply_partial_read(response, 3, 2)

        assert exc_info.value.status_code == 400
        assert "must be <=" in exc_info.value.detail
