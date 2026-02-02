"""Tests for tier-based usage limits."""
import pytest

from core.tier_limits import TIER_LIMITS, Tier, TierLimits, get_tier_limits


class TestTierEnum:
    """Tests for the Tier enum."""

    def test__tier_free__has_expected_value(self) -> None:
        """Tier.FREE should have value 'free'."""
        assert Tier.FREE == "free"
        assert Tier.FREE.value == "free"

    def test__tier_from_string__valid_value(self) -> None:
        """Tier can be constructed from valid string."""
        tier = Tier("free")
        assert tier == Tier.FREE

    def test__tier_from_string__invalid_value_raises(self) -> None:
        """Tier construction from invalid string raises ValueError."""
        with pytest.raises(ValueError, match="'invalid' is not a valid Tier"):
            Tier("invalid")


class TestTierLimits:
    """Tests for the TierLimits dataclass."""

    def test__tier_limits__is_frozen(self) -> None:
        """TierLimits dataclass should be immutable (frozen)."""
        limits = TIER_LIMITS[Tier.FREE]
        with pytest.raises(AttributeError):
            limits.max_bookmarks = 999  # type: ignore[misc]

    def test__tier_limits__has_all_fields(self) -> None:
        """TierLimits should have all expected fields."""
        limits = TIER_LIMITS[Tier.FREE]

        # Item counts
        assert hasattr(limits, "max_bookmarks")
        assert hasattr(limits, "max_notes")
        assert hasattr(limits, "max_prompts")

        # Field lengths (common)
        assert hasattr(limits, "max_title_length")
        assert hasattr(limits, "max_description_length")
        assert hasattr(limits, "max_tag_name_length")

        # Field lengths (content)
        assert hasattr(limits, "max_bookmark_content_length")
        assert hasattr(limits, "max_note_content_length")
        assert hasattr(limits, "max_prompt_content_length")

        # Field lengths (entity-specific)
        assert hasattr(limits, "max_url_length")
        assert hasattr(limits, "max_prompt_name_length")
        assert hasattr(limits, "max_argument_name_length")
        assert hasattr(limits, "max_argument_description_length")

        # Rate limits
        assert hasattr(limits, "rate_read_per_minute")
        assert hasattr(limits, "rate_read_per_day")
        assert hasattr(limits, "rate_write_per_minute")
        assert hasattr(limits, "rate_write_per_day")
        assert hasattr(limits, "rate_sensitive_per_minute")
        assert hasattr(limits, "rate_sensitive_per_day")


class TestGetTierLimits:
    """Tests for the get_tier_limits function."""

    def test__get_tier_limits__returns_free_limits(self) -> None:
        """get_tier_limits should return limits for FREE tier."""
        limits = get_tier_limits(Tier.FREE)

        assert isinstance(limits, TierLimits)
        assert limits.max_bookmarks == 100
        assert limits.max_notes == 100
        assert limits.max_prompts == 100
        assert limits.max_title_length == 100
        assert limits.max_description_length == 1000
        assert limits.max_tag_name_length == 50
        assert limits.max_bookmark_content_length == 100_000
        assert limits.max_note_content_length == 100_000
        assert limits.max_prompt_content_length == 100_000
        assert limits.max_url_length == 2048
        assert limits.max_prompt_name_length == 100
        assert limits.max_argument_name_length == 100
        assert limits.max_argument_description_length == 500
        # Rate limits
        assert limits.rate_read_per_minute == 180
        assert limits.rate_read_per_day == 4000
        assert limits.rate_write_per_minute == 120
        assert limits.rate_write_per_day == 4000
        assert limits.rate_sensitive_per_minute == 30
        assert limits.rate_sensitive_per_day == 250

    def test__get_tier_limits__same_as_tier_limits_dict(self) -> None:
        """get_tier_limits should return same object as TIER_LIMITS dict."""
        limits = get_tier_limits(Tier.FREE)
        assert limits is TIER_LIMITS[Tier.FREE]


class TestFreeTierDefaults:
    """Tests for FREE tier default values."""

    def test__free_tier__item_limits_are_reasonable(self) -> None:
        """FREE tier should have reasonable item limits."""
        limits = get_tier_limits(Tier.FREE)

        # Each content type should allow 100 items
        assert limits.max_bookmarks == 100
        assert limits.max_notes == 100
        assert limits.max_prompts == 100

    def test__free_tier__field_lengths_are_reasonable(self) -> None:
        """FREE tier should have reasonable field length limits."""
        limits = get_tier_limits(Tier.FREE)

        # Titles and descriptions
        assert limits.max_title_length == 100
        assert limits.max_description_length == 1000

        # Content lengths - all 100K
        assert limits.max_bookmark_content_length == 100_000
        assert limits.max_note_content_length == 100_000
        assert limits.max_prompt_content_length == 100_000

        # URL and tag limits
        assert limits.max_url_length == 2048
        assert limits.max_tag_name_length == 50

        # Prompt-specific
        assert limits.max_prompt_name_length == 100
        assert limits.max_argument_name_length == 100
        assert limits.max_argument_description_length == 500

    def test__free_tier__rate_limits_are_reasonable(self) -> None:
        """FREE tier should have reasonable rate limits."""
        limits = get_tier_limits(Tier.FREE)

        # Per-minute limits (allow ~3 requests/second for READ)
        assert limits.rate_read_per_minute == 180
        assert limits.rate_write_per_minute == 120
        assert limits.rate_sensitive_per_minute == 30

        # Per-day limits
        assert limits.rate_read_per_day == 4000
        assert limits.rate_write_per_day == 4000
        assert limits.rate_sensitive_per_day == 250

        # Sensitive should be strictest
        assert limits.rate_sensitive_per_minute < limits.rate_write_per_minute
        assert limits.rate_sensitive_per_day < limits.rate_write_per_day
