"""
Tier-based usage limits for content management.

SYNC LOCATIONS: When updating tier values, also update:
- frontend/src/pages/Pricing.tsx (pricing cards and comparison table)
- frontend/src/pages/LandingPage.tsx (FAQ: "How much does Tiddly cost?")
- frontend/public/llms.txt (Tier Limits section)
- frontend/src/types.ts (UserLimits interface — if adding/removing fields)
- backend/src/schemas/user_limits.py (UserLimitsResponse — if adding/removing fields)
"""
import logging
from dataclasses import dataclass
from enum import StrEnum

logger = logging.getLogger(__name__)


class Tier(StrEnum):
    """User subscription tiers."""

    FREE = "free"
    STANDARD = "standard"
    PRO = "pro"
    DEV = "dev"


@dataclass(frozen=True)
class TierLimits:
    """Usage limits for a subscription tier."""

    # Item counts
    max_bookmarks: int
    max_notes: int
    max_prompts: int

    # Personal Access Tokens
    max_pats: int  # named max_pats to avoid confusion with LLM max_tokens

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

    # Rate limits (requests per time window)
    rate_read_per_minute: int
    rate_read_per_day: int
    rate_write_per_minute: int
    rate_write_per_day: int
    rate_sensitive_per_minute: int
    rate_sensitive_per_day: int

    # Relationship limits
    max_relationships_per_entity: int  # Max links per content item

    # History retention limits
    history_retention_days: int  # How long to keep history records
    max_history_per_entity: int  # Max versions per entity


# Field lengths are structural limits, not pricing levers — same across all tiers.
_FIELD_LENGTHS = {
    "max_title_length": 200,
    "max_description_length": 1000,
    "max_tag_name_length": 50,
    "max_url_length": 2048,
    "max_prompt_name_length": 100,
    "max_argument_name_length": 100,
    "max_argument_description_length": 500,
}

TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(
        max_bookmarks=10,
        max_notes=10,
        max_prompts=5,
        max_pats=3,
        **_FIELD_LENGTHS,
        max_bookmark_content_length=25_000,
        max_note_content_length=25_000,
        max_prompt_content_length=25_000,
        rate_read_per_minute=60,
        rate_read_per_day=500,
        rate_write_per_minute=20,
        rate_write_per_day=200,
        rate_sensitive_per_minute=5,
        rate_sensitive_per_day=25,
        max_relationships_per_entity=50,
        history_retention_days=1,
        max_history_per_entity=100,
    ),
    Tier.STANDARD: TierLimits(
        max_bookmarks=250,
        max_notes=100,
        max_prompts=50,
        max_pats=10,
        **_FIELD_LENGTHS,
        max_bookmark_content_length=50_000,
        max_note_content_length=50_000,
        max_prompt_content_length=50_000,
        rate_read_per_minute=120,
        rate_read_per_day=2_000,
        rate_write_per_minute=60,
        rate_write_per_day=1_000,
        rate_sensitive_per_minute=15,
        rate_sensitive_per_day=100,
        max_relationships_per_entity=50,
        history_retention_days=5,
        max_history_per_entity=100,
    ),
    Tier.PRO: TierLimits(
        max_bookmarks=10_000,
        max_notes=10_000,
        max_prompts=10_000,
        max_pats=50,
        **_FIELD_LENGTHS,
        max_bookmark_content_length=100_000,
        max_note_content_length=100_000,
        max_prompt_content_length=100_000,
        rate_read_per_minute=300,
        rate_read_per_day=10_000,
        rate_write_per_minute=200,
        rate_write_per_day=5_000,
        rate_sensitive_per_minute=30,
        rate_sensitive_per_day=250,
        max_relationships_per_entity=50,
        history_retention_days=15,
        max_history_per_entity=100,
    ),
    # DEV tier: resolved at runtime when settings.dev_mode=true.
    # Not persisted to the database. Effectively unlimited for local
    # development, evals, and performance testing.
    Tier.DEV: TierLimits(
        max_bookmarks=1_000_000,
        max_notes=1_000_000,
        max_prompts=1_000_000,
        max_pats=1_000_000,
        max_title_length=1_000_000,
        max_description_length=1_000_000,
        max_tag_name_length=1_000_000,
        max_bookmark_content_length=1_000_000,
        max_note_content_length=1_000_000,
        max_prompt_content_length=1_000_000,
        max_url_length=1_000_000,
        max_prompt_name_length=1_000_000,
        max_argument_name_length=1_000_000,
        max_argument_description_length=1_000_000,
        rate_read_per_minute=1_000_000,
        rate_read_per_day=1_000_000,
        rate_write_per_minute=1_000_000,
        rate_write_per_day=1_000_000,
        rate_sensitive_per_minute=1_000_000,
        rate_sensitive_per_day=1_000_000,
        max_relationships_per_entity=1_000_000,
        history_retention_days=1_000,
        max_history_per_entity=1_000_000,
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
