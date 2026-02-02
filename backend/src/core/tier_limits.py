"""Tier-based usage limits for content management."""
import logging
from dataclasses import dataclass
from enum import StrEnum

logger = logging.getLogger(__name__)


class Tier(StrEnum):
    """User subscription tiers."""

    FREE = "free"
    # PRO = "pro"  # future


@dataclass(frozen=True)
class TierLimits:
    """Usage limits for a subscription tier."""

    # Item counts
    max_bookmarks: int
    max_notes: int
    max_prompts: int

    # Field lengths (common)
    max_title_length: int
    max_description_length: int
    max_tag_name_length: int

    # Field lengths (content - per entity type)
    max_bookmark_content_length: int
    max_note_content_length: int
    max_prompt_content_length: int

    # Field lengths (entity-specific)
    max_url_length: int  # bookmarks only
    max_prompt_name_length: int  # prompts only
    max_argument_name_length: int  # prompt arguments
    max_argument_description_length: int  # prompt arguments


TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(
        max_bookmarks=100,
        max_notes=100,
        max_prompts=100,
        max_title_length=100,
        max_description_length=1000,
        max_tag_name_length=50,
        max_bookmark_content_length=100_000,
        max_note_content_length=100_000,
        max_prompt_content_length=100_000,
        max_url_length=2048,
        max_prompt_name_length=100,
        max_argument_name_length=100,
        max_argument_description_length=500,
    ),
}


def get_tier_safely(tier_value: str) -> Tier:
    """
    Safely convert a string to a Tier enum, defaulting to FREE on unknown values.

    This prevents 500 errors from bad data or future tier values that don't
    exist yet in this version of the code.

    Args:
        tier_value: The tier string from the database or user object.

    Returns:
        The corresponding Tier enum, or Tier.FREE if unknown.
    """
    try:
        return Tier(tier_value)
    except ValueError:
        logger.warning(
            "Unknown tier value '%s', defaulting to FREE tier",
            tier_value,
        )
        return Tier.FREE


def get_tier_limits(tier: Tier) -> TierLimits:
    """
    Get limits for a tier.

    Args:
        tier: The user's subscription tier.

    Returns:
        TierLimits for the specified tier.

    Raises:
        KeyError: If tier is not found in TIER_LIMITS.
    """
    return TIER_LIMITS[tier]
