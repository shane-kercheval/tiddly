"""
Tier-based usage limits for content management.

SOURCE OF TRUTH: tier *values* live in `frontend/src/content/data/tiers.json`, the
single cross-stack source read here (backend enforcement) and by `Pricing.tsx`
(display). To change a tier value (e.g. bump a limit), edit that file — not this module.

When changing the *shape* (adding/removing a limit field), update in lockstep:
- `TierLimits` below + `frontend/src/content/data/tiers.json` (every product tier)
- frontend/src/types.ts (UserLimits interface)
- backend/src/schemas/user_limits.py (UserLimitsResponse)

Known still-hardcoded copies of tier values, deferred (see the content-as-markdown
plan): frontend/src/pages/LandingPage.tsx (cost FAQ) → M4; frontend/public/llms.txt
(Tier Limits section) → KAN-152. Rewire each to read tiers.json when its work runs.
"""
import json
import logging
import os
from dataclasses import dataclass, fields
from enum import StrEnum
from pathlib import Path

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

    # AI rate limits (platform key)
    rate_ai_per_minute: int
    rate_ai_per_day: int
    # AI rate limits (BYOK — user provides their own key)
    rate_ai_byok_per_minute: int
    rate_ai_byok_per_day: int

    # Relationship limits
    max_relationships_per_entity: int  # Max links per content item

    # History retention limits
    history_retention_days: int  # How long to keep history records
    max_history_per_entity: int  # Max versions per entity


# DEV tier: resolved at runtime when settings.dev_mode=true. Not persisted to the
# database, not a product tier, and intentionally NOT in tiers.json (which must
# not leak it into the served public file). Effectively unlimited for local
# development, evals, and performance testing.
_DEV_LIMITS = TierLimits(
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
    rate_ai_per_minute=1_000_000,
    rate_ai_per_day=1_000_000,
    rate_ai_byok_per_minute=1_000_000,
    rate_ai_byok_per_day=1_000_000,
    max_relationships_per_entity=1_000_000,
    history_retention_days=1_000,
    max_history_per_entity=1_000_000,
)

# Canonical tier values live in the frontend's cross-stack data file. The path
# resolves identically in local/CI (repo-relative) and in the Docker image
# (Dockerfile.api COPYs the file to the same repo-relative path). Override with
# TIERS_JSON_PATH if ever needed.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_TIERS_JSON_PATH = Path(
    os.environ.get("TIERS_JSON_PATH")
    or _REPO_ROOT / "frontend" / "src" / "content" / "data" / "tiers.json",
)

# Display-only / non-enforcement keys present in tiers.json that are not TierLimits fields.
_NON_LIMIT_KEYS = {"unlimited_items"}


def _build_tier_limits(entry: dict, tier_name: str) -> TierLimits:
    """Construct TierLimits for one product tier from its tiers.json entry, fail-fast."""
    limit_fields = {f.name for f in fields(TierLimits)}
    unknown = set(entry) - limit_fields - _NON_LIMIT_KEYS
    if unknown:
        raise RuntimeError(f"tiers.json tier '{tier_name}' has unknown fields: {sorted(unknown)}")
    missing = limit_fields - entry.keys()
    if missing:
        raise RuntimeError(f"tiers.json tier '{tier_name}' is missing fields: {sorted(missing)}")
    for field_name in limit_fields:
        value = entry[field_name]
        # All TierLimits fields are ints; reject bool (an int subclass) and other types.
        if not isinstance(value, int) or isinstance(value, bool):
            raise RuntimeError(
                f"tiers.json tier '{tier_name}' field '{field_name}' must be an integer, "
                f"got {type(value).__name__}.",
            )
    return TierLimits(**{name: entry[name] for name in limit_fields})


def _load_product_tier_limits() -> dict[Tier, TierLimits]:
    """Load free/standard/pro from tiers.json. Fail-fast at startup if absent/malformed."""
    try:
        raw = json.loads(_TIERS_JSON_PATH.read_text())
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"tiers.json not found at {_TIERS_JSON_PATH}; backend tier enforcement requires it "
            "(Dockerfile.api must COPY frontend/src/content/data/tiers.json).",
        ) from exc
    return {
        tier: _build_tier_limits(raw.get(tier.value) or {}, tier.value)
        for tier in (Tier.FREE, Tier.STANDARD, Tier.PRO)
    }


TIER_LIMITS: dict[Tier, TierLimits] = {**_load_product_tier_limits(), Tier.DEV: _DEV_LIMITS}


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
