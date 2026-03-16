"""Tests for shared schema validators."""
import pytest

from schemas.validators import MAX_TAGS_PER_ENTITY, validate_and_normalize_tags


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
