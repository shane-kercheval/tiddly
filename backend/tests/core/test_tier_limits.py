"""Tests for tier-based usage limits."""
import dataclasses

import pytest

from core.tier_limits import TIER_LIMITS, Tier, TierLimits, get_tier_limits, get_tier_safely


class TestTierEnum:
    """Tests for the Tier enum."""

    def test__tier_free__has_expected_value(self) -> None:
        assert Tier.FREE == "free"
        assert Tier.FREE.value == "free"

    def test__tier_standard__has_expected_value(self) -> None:
        assert Tier.STANDARD == "standard"
        assert Tier.STANDARD.value == "standard"

    def test__tier_pro__has_expected_value(self) -> None:
        assert Tier.PRO == "pro"
        assert Tier.PRO.value == "pro"

    def test__tier_from_string__valid_values(self) -> None:
        assert Tier("free") == Tier.FREE
        assert Tier("standard") == Tier.STANDARD
        assert Tier("pro") == Tier.PRO
        assert Tier("dev") == Tier.DEV

    def test__tier_from_string__invalid_value_raises(self) -> None:
        with pytest.raises(ValueError, match="'invalid' is not a valid Tier"):
            Tier("invalid")


class TestTierLimits:
    """Tests for the TierLimits dataclass."""

    def test__tier_limits__is_frozen(self) -> None:
        limits = TIER_LIMITS[Tier.FREE]
        with pytest.raises(AttributeError):
            limits.max_bookmarks = 999  # type: ignore[misc]

    def test__tier_limits__has_all_fields(self) -> None:
        limits = TIER_LIMITS[Tier.FREE]

        # Item counts
        assert hasattr(limits, "max_bookmarks")
        assert hasattr(limits, "max_notes")
        assert hasattr(limits, "max_prompts")

        # PATs
        assert hasattr(limits, "max_pats")

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

        # Relationships and history
        assert hasattr(limits, "max_relationships_per_entity")
        assert hasattr(limits, "history_retention_days")
        assert hasattr(limits, "max_history_per_entity")

    def test__all_tiers_have_entries(self) -> None:
        """Every Tier enum member should have an entry in TIER_LIMITS."""
        for tier in Tier:
            assert tier in TIER_LIMITS, f"Missing TIER_LIMITS entry for {tier}"


class TestGetTierLimits:
    """Tests for the get_tier_limits function."""

    def test__get_tier_limits__returns_tier_limits_instance(self) -> None:
        """get_tier_limits returns a TierLimits for every tier."""
        for tier in Tier:
            limits = get_tier_limits(tier)
            assert isinstance(limits, TierLimits)

    def test__get_tier_limits__same_as_tier_limits_dict(self) -> None:
        limits = get_tier_limits(Tier.FREE)
        assert limits is TIER_LIMITS[Tier.FREE]


class TestFreeTierDefaults:
    """Tests for FREE tier default values."""

    def test__free_tier__rate_limits_are_reasonable(self) -> None:
        limits = get_tier_limits(Tier.FREE)

        # Sensitive should be strictest
        assert limits.rate_sensitive_per_minute < limits.rate_write_per_minute
        assert limits.rate_sensitive_per_day < limits.rate_write_per_day

    def test__free_tier__content_lengths_are_uniform(self) -> None:
        """All content types should have the same length limit within FREE tier."""
        limits = get_tier_limits(Tier.FREE)
        assert limits.max_bookmark_content_length == limits.max_note_content_length
        assert limits.max_note_content_length == limits.max_prompt_content_length


class TestTierOrdering:
    """Tests that tier limits follow FREE <= STANDARD <= PRO."""

    def test__standard_limits_between_free_and_pro(self) -> None:
        """Every STANDARD limit should be >= FREE and <= PRO."""
        free = get_tier_limits(Tier.FREE)
        standard = get_tier_limits(Tier.STANDARD)
        pro = get_tier_limits(Tier.PRO)
        for field in dataclasses.fields(TierLimits):
            free_val = getattr(free, field.name)
            std_val = getattr(standard, field.name)
            pro_val = getattr(pro, field.name)
            assert free_val <= std_val <= pro_val, (
                f"{field.name}: FREE={free_val}, STANDARD={std_val}, PRO={pro_val}"
            )

    def test__field_lengths_same_across_tiers(self) -> None:
        """Structural field lengths should be identical across all production tiers."""
        free = get_tier_limits(Tier.FREE)
        standard = get_tier_limits(Tier.STANDARD)
        pro = get_tier_limits(Tier.PRO)
        structural_fields = [
            "max_title_length", "max_description_length", "max_tag_name_length",
            "max_url_length", "max_prompt_name_length",
            "max_argument_name_length", "max_argument_description_length",
        ]
        for field in structural_fields:
            assert getattr(free, field) == getattr(standard, field) == getattr(pro, field), (
                f"{field} should be the same across tiers"
            )


class TestDevTier:
    """Tests for the DEV tier."""

    def test__tier_dev__has_expected_value(self) -> None:
        assert Tier.DEV == "dev"
        assert Tier.DEV.value == "dev"

    def test__get_tier_limits__dev_is_effectively_unlimited(self) -> None:
        """DEV tier should have effectively unlimited values (>= 1_000_000 for counts)."""
        limits = get_tier_limits(Tier.DEV)
        assert isinstance(limits, TierLimits)
        assert limits.max_bookmarks >= 1_000_000
        assert limits.max_notes >= 1_000_000
        assert limits.max_prompts >= 1_000_000
        assert limits.max_pats >= 1_000_000

    def test__dev_tier__all_limits_higher_than_free(self) -> None:
        """Every DEV tier limit should be >= the corresponding FREE tier limit."""
        dev_limits = get_tier_limits(Tier.DEV)
        free_limits = get_tier_limits(Tier.FREE)
        for field in dataclasses.fields(TierLimits):
            dev_val = getattr(dev_limits, field.name)
            free_val = getattr(free_limits, field.name)
            assert dev_val >= free_val, (
                f"DEV {field.name}={dev_val} < FREE {field.name}={free_val}"
            )


class TestGetTierSafely:
    """Tests for the get_tier_safely function."""

    def test__get_tier_safely__free(self) -> None:
        assert get_tier_safely("free") == Tier.FREE

    def test__get_tier_safely__standard(self) -> None:
        assert get_tier_safely("standard") == Tier.STANDARD

    def test__get_tier_safely__pro(self) -> None:
        assert get_tier_safely("pro") == Tier.PRO

    def test__get_tier_safely__dev(self) -> None:
        assert get_tier_safely("dev") == Tier.DEV

    def test__get_tier_safely__unknown_defaults_to_free(self) -> None:
        assert get_tier_safely("unknown") == Tier.FREE
        assert get_tier_safely("") == Tier.FREE
