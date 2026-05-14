"""Tests for shared schema validators."""
import pytest

from schemas.validators import (
    MAX_TAGS_PER_ENTITY,
    PROMPT_NAME_PATTERN,
    slugify_prompt_name,
    validate_and_normalize_tags,
)


class TestValidateAndNormalizeTagsLimit:
    """Tests for the MAX_TAGS_PER_ENTITY abuse-prevention limit."""

    def test__exactly_at_limit__succeeds(self) -> None:
        tags = [f"tag-{i}" for i in range(MAX_TAGS_PER_ENTITY)]
        result = validate_and_normalize_tags(tags)
        assert len(result) == MAX_TAGS_PER_ENTITY

    def test__one_over_limit__raises(self) -> None:
        tags = [f"tag-{i}" for i in range(MAX_TAGS_PER_ENTITY + 1)]
        with pytest.raises(ValueError, match=f"Too many tags \\({MAX_TAGS_PER_ENTITY + 1}\\)"):
            validate_and_normalize_tags(tags)

    def test__dedup_before_count__duplicates_dont_inflate(self) -> None:
        """150 tags with 100 duplicates = 50 unique → passes."""
        unique = [f"tag-{i}" for i in range(50)]
        tags = unique + unique + unique  # 150 total, 50 unique
        result = validate_and_normalize_tags(tags)
        assert len(result) == 50

    def test__dedup_before_count__unique_over_limit_raises(self) -> None:
        """150 unique tags → raises even though dedup runs first."""
        tags = [f"tag-{i}" for i in range(150)]
        with pytest.raises(ValueError, match="Too many tags"):
            validate_and_normalize_tags(tags)

    def test__error_message_includes_count_and_limit(self) -> None:
        tags = [f"tag-{i}" for i in range(MAX_TAGS_PER_ENTITY + 5)]
        with pytest.raises(
            ValueError,
            match=f"Too many tags \\({MAX_TAGS_PER_ENTITY + 5}\\).*Maximum is {MAX_TAGS_PER_ENTITY}",
        ):
            validate_and_normalize_tags(tags)


class TestSlugifyPromptName:
    """Tests for slugify_prompt_name (LLM-name safety net)."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("My Cool Prompt", "my-cool-prompt"),
            ("My_Cool_Prompt", "my-cool-prompt"),
            ("CODE REVIEW", "code-review"),
            ("  leading-and-trailing  ", "leading-and-trailing"),
            ("---multi---hyphen---", "multi-hyphen"),
            ("café-2024", "cafe-2024"),
            ("naïve-approach", "naive-approach"),
            ("foo!@#bar$%^baz", "foo-bar-baz"),
            ("already-valid-slug", "already-valid-slug"),
            ("snake_case_name", "snake-case-name"),
            ("CamelCaseName", "camelcasename"),
            ("123-numeric-start", "123-numeric-start"),
        ],
    )
    def test__valid_inputs__produce_pattern_matching_slug(self, raw: str, expected: str) -> None:
        result = slugify_prompt_name(raw)
        assert result == expected
        assert PROMPT_NAME_PATTERN.match(result), f"slug {result!r} should match pattern"

    @pytest.mark.parametrize(
        "raw",
        ["", "   ", "!@#$%", "----", "🎉🎊✨", "...", "___"],
    )
    def test__no_valid_chars__returns_empty_string(self, raw: str) -> None:
        assert slugify_prompt_name(raw) == ""

    def test__truncation__respects_max_length(self) -> None:
        raw = "a" * 200
        result = slugify_prompt_name(raw, max_length=50)
        assert len(result) == 50
        assert PROMPT_NAME_PATTERN.match(result)

    def test__truncation__strips_trailing_hyphen_after_cut(self) -> None:
        # Truncating "abc-def-ghi" at length 4 yields "abc-", trailing hyphen stripped.
        result = slugify_prompt_name("abc def ghi", max_length=4)
        assert result == "abc"
        assert PROMPT_NAME_PATTERN.match(result)

    def test__default_max_length_is_100(self) -> None:
        raw = "x" * 150
        result = slugify_prompt_name(raw)
        assert len(result) == 100
