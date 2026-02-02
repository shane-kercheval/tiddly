# Implementation Plan: Tier-Based Rate Limits

**Date:** 2026-02-01

## Overview

Make API rate limits vary by user tier. Currently, rate limits are hardcoded and only vary by auth type (PAT vs Auth0) and operation type (read/write/sensitive). This plan adds tier-awareness so free users get different limits than future paid tiers.

## Important: Review Before Implementing

Before implementing any milestone, review:
- Existing rate limiting: `core/rate_limit_config.py` (policy), `core/rate_limiter.py` (enforcement)
- Tier system: `core/tier_limits.py` (TierLimits dataclass, get_tier_limits)
- Auth flow: `core/auth.py` (`_apply_rate_limit`, `check_rate_limit` call)
- Existing tests: `tests/core/test_rate_limiter.py`

## Current State

**Rate limits are defined in `rate_limit_config.py`:**
```python
RATE_LIMITS: dict[tuple[AuthType, OperationType], RateLimitConfig] = {
    (AuthType.PAT, OperationType.READ): RateLimitConfig(requests_per_minute=240, requests_per_day=4000),
    (AuthType.PAT, OperationType.WRITE): RateLimitConfig(requests_per_minute=120, requests_per_day=4000),
    (AuthType.AUTH0, OperationType.READ): RateLimitConfig(requests_per_minute=180, requests_per_day=4000),
    (AuthType.AUTH0, OperationType.WRITE): RateLimitConfig(requests_per_minute=120, requests_per_day=4000),
    (AuthType.AUTH0, OperationType.SENSITIVE): RateLimitConfig(requests_per_minute=30, requests_per_day=250),
}
```

**Enforcement flow:**
1. `auth.py:_apply_rate_limit()` extracts `auth_type` from request state, determines `operation_type`
2. Calls `check_rate_limit(user.id, auth_type, operation_type)`
3. `rate_limiter.py` looks up config from `RATE_LIMITS` dict
4. Enforces via Redis (sliding window for per-minute, fixed window for per-day)

**Key observation:** The user object (with `tier` field) is available in `_apply_rate_limit()` but not passed to `check_rate_limit()`.

## Target State

Rate limits defined in `TierLimits` dataclass alongside other tier-specific limits:

```python
@dataclass(frozen=True)
class TierLimits:
    # ... existing fields ...

    # Rate limits
    rate_read_per_minute: int
    rate_read_per_day: int
    rate_write_per_minute: int
    rate_write_per_day: int
    rate_sensitive_per_minute: int
    rate_sensitive_per_day: int

TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(
        # ... existing limits ...
        rate_read_per_minute=180,
        rate_read_per_day=4000,
        rate_write_per_minute=120,
        rate_write_per_day=4000,
        rate_sensitive_per_minute=30,
        rate_sensitive_per_day=250,
    ),
}
```

---

## Milestones

### Milestone 1: Add Rate Limit Fields to TierLimits

**Goal:** Extend `TierLimits` dataclass with rate limit fields and update the free tier definition.

**Success Criteria:**
- `TierLimits` includes 6 new rate limit fields
- Free tier values match current hardcoded values (no behavior change)
- Existing tests pass

**Key Changes:**

1. **Update `backend/src/core/tier_limits.py`:**

```python
@dataclass(frozen=True)
class TierLimits:
    # ... existing fields ...

    # Rate limits (requests per time window)
    rate_read_per_minute: int
    rate_read_per_day: int
    rate_write_per_minute: int
    rate_write_per_day: int
    rate_sensitive_per_minute: int
    rate_sensitive_per_day: int

TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(
        # ... existing limits unchanged ...

        # Rate limits - match current RATE_LIMITS for Auth0 users
        # (PAT users will use same limits as Auth0 in tier-based system)
        rate_read_per_minute=180,
        rate_read_per_day=4000,
        rate_write_per_minute=120,
        rate_write_per_day=4000,
        rate_sensitive_per_minute=30,
        rate_sensitive_per_day=250,
    ),
}
```

**Design Decision: Collapse PAT vs Auth0 distinction**

Currently, PAT and Auth0 have different rate limits. With tier-based limits, we have two options:

- **Option A (Recommended):** Single set of rate limits per tier - simpler, PAT users get same limits as Auth0
- **Option B:** Keep auth type distinction - 12 fields per tier (6 for PAT, 6 for Auth0) - more complex

Recommendation: Option A. The original PAT/Auth0 distinction was about trust level (PATs can be automated, Auth0 is likely interactive). With tier-based billing, the tier itself represents the trust/value level. PAT abuse is better addressed by having PAT-specific endpoints blocked entirely (already done via `_auth0_only` dependencies) rather than rate limits.

**Testing Strategy:**
- Verify `TierLimits` includes all rate limit fields
- Verify free tier has expected values
- Verify existing `get_tier_limits()` returns complete object
- Run existing tests to ensure no regressions

**Dependencies:** None

**Risk Factors:**
- Must update any code that instantiates `TierLimits` directly (tests, fixtures)

---

### Milestone 2: Update Rate Limiter to Accept Tier

**Goal:** Modify `check_rate_limit()` to accept tier and look up limits from `TierLimits` instead of hardcoded `RATE_LIMITS` dict.

**Success Criteria:**
- `check_rate_limit()` accepts `tier: Tier` parameter
- Limits are retrieved from `TierLimits` dataclass
- Auth type still affects Redis key (for separate tracking)
- Behavior unchanged for free tier users

**Key Changes:**

1. **Update `backend/src/core/rate_limiter.py`:**

```python
from core.tier_limits import Tier, get_tier_limits

async def check_rate_limit(
    user_id: int,
    auth_type: AuthType,
    operation_type: OperationType,
    tier: Tier,  # NEW parameter
) -> RateLimitResult:
    """
    Check if request is allowed and return full rate limit info.

    Limits are tier-based, not auth-type-based. Auth type is still used
    for Redis key separation (PAT vs Auth0 tracked separately).
    """
    limits = get_tier_limits(tier)

    # Get rate limit config based on operation type
    if operation_type == OperationType.READ:
        config = RateLimitConfig(limits.rate_read_per_minute, limits.rate_read_per_day)
    elif operation_type == OperationType.WRITE:
        config = RateLimitConfig(limits.rate_write_per_minute, limits.rate_write_per_day)
    else:  # SENSITIVE
        config = RateLimitConfig(limits.rate_sensitive_per_minute, limits.rate_sensitive_per_day)

    # ... rest of enforcement logic unchanged ...
```

2. **Update Redis key structure (optional but recommended):**

Current: `rate:{user_id}:{auth_type}:{operation_type}:min`

Option A: Keep as-is - PAT and Auth0 requests counted separately
Option B: Remove auth_type - `rate:{user_id}:{operation_type}:min` - unified counting

Recommendation: Option A (keep auth_type in key). This maintains backward compatibility and allows future flexibility if we want different tracking per auth type.

**Testing Strategy:**
- Test `check_rate_limit()` with tier parameter
- Test that free tier gets expected limits
- Test that rate limiting still works (integration test with Redis)
- Mock `get_tier_limits()` to test with custom limits

**Dependencies:** Milestone 1

**Risk Factors:**
- Signature change requires updating all callers

---

### Milestone 3: Update Auth Layer to Pass Tier

**Goal:** Update `_apply_rate_limit()` in `auth.py` to extract tier from user and pass to `check_rate_limit()`.

**Success Criteria:**
- `_apply_rate_limit()` extracts tier from user object
- Passes tier to `check_rate_limit()`
- Works with both `User` ORM and `CachedUser` objects (tier is on both)

**Key Changes:**

1. **Update `backend/src/core/auth.py`:**

```python
from core.tier_limits import Tier, get_tier_safely

async def _apply_rate_limit(
    user: User | CachedUser,
    request: Request,
    settings: Settings,
) -> None:
    """Apply rate limiting for the current request."""
    if settings.dev_mode:
        return

    auth_type = getattr(request.state, "auth_type", AuthType.AUTH0)
    operation_type = get_operation_type(request.method, request.url.path)
    tier = get_tier_safely(user.tier)  # Convert string to enum safely

    result = await check_rate_limit(user.id, auth_type, operation_type, tier)

    # ... rest unchanged ...
```

**Testing Strategy:**
- Test rate limiting with different tiers (mock `get_tier_limits`)
- Test that invalid tier string defaults to FREE (via `get_tier_safely`)
- Integration test: full auth flow with rate limiting

**Dependencies:** Milestone 2

**Risk Factors:** None - straightforward change

---

### Milestone 4: Clean Up Legacy Rate Limit Config

**Goal:** Remove or deprecate the hardcoded `RATE_LIMITS` dict since limits now come from `TierLimits`.

**Success Criteria:**
- `RATE_LIMITS` dict removed from `rate_limit_config.py`
- No code references `RATE_LIMITS` dict
- Tests updated to use tier-based mocking instead

**Key Changes:**

1. **Update `backend/src/core/rate_limit_config.py`:**
   - Remove `RATE_LIMITS` dict
   - Keep `AuthType`, `OperationType`, `RateLimitConfig`, `RateLimitResult`, `RateLimitExceededError`
   - Keep `SENSITIVE_ENDPOINTS` and `get_operation_type()`

2. **Update tests:**
   - Tests that monkeypatch `RATE_LIMITS` should instead mock `get_tier_limits()`
   - Use `low_limits` fixture pattern from tier limits tests

**Testing Strategy:**
- Grep for `RATE_LIMITS` references - ensure none remain
- Run full test suite
- Verify rate limiting still works end-to-end

**Dependencies:** Milestone 3

**Risk Factors:**
- Tests may rely on monkeypatching `RATE_LIMITS` - need to update mocking strategy

---

### Milestone 5: Update API Schema and Frontend Types

**Goal:** Add rate limit fields to API schema and frontend types so they're exposed via `/users/me/limits`.

**Context:** The endpoint already uses `**asdict(limits)` to spread all `TierLimits` fields into the response. Once Milestone 1 adds rate limit fields to `TierLimits`, they're automatically included in the response. This milestone just updates the schema and frontend types to match.

**Success Criteria:**
- `UserLimitsResponse` schema includes rate limit fields
- Frontend `UserLimits` type includes rate limit fields
- API returns rate limits in response

**Key Changes:**

1. **Update `backend/src/schemas/user_limits.py`:**

```python
class UserLimitsResponse(BaseModel):
    # ... existing fields ...

    # Rate limits
    rate_read_per_minute: int
    rate_read_per_day: int
    rate_write_per_minute: int
    rate_write_per_day: int
    rate_sensitive_per_minute: int
    rate_sensitive_per_day: int
```

2. **Update `frontend/src/types.ts`:** Add rate limit fields to `UserLimits`

3. **Update Settings page (optional):** Display rate limits in the limits table

**Testing Strategy:**
- Test API endpoint returns rate limit fields
- Test frontend types compile without errors

**Dependencies:** Milestone 1 (TierLimits fields must exist)

**Risk Factors:** None - additive change

**Note:** This milestone can be done in parallel with Milestones 2-4 since it only depends on Milestone 1.

---

## Summary of Changes by File

### Backend

| File | Changes |
|------|---------|
| `core/tier_limits.py` | Add 6 rate limit fields to `TierLimits`, update `TIER_LIMITS` |
| `core/rate_limiter.py` | Add `tier` parameter to `check_rate_limit()`, look up limits from `TierLimits` |
| `core/auth.py` | Extract tier from user, pass to `check_rate_limit()` |
| `core/rate_limit_config.py` | Remove `RATE_LIMITS` dict (keep enums, types, sensitive endpoints) |
| `schemas/user_limits.py` | Add rate limit fields (Milestone 5) |
| `api/routers/users.py` | Include rate limits in response (Milestone 5) |

### Frontend

| File | Changes |
|------|---------|
| `types.ts` | Add rate limit fields to `UserLimits` (Milestone 5) |
| `pages/settings/SettingsGeneral.tsx` | Display rate limits (Milestone 5, optional) |

### Tests

| File | Changes |
|------|---------|
| `tests/core/test_tier_limits.py` | Test rate limit fields |
| `tests/core/test_rate_limiter.py` | Update to mock `get_tier_limits()` instead of `RATE_LIMITS` |
| Integration tests | Verify rate limiting with tier parameter |

---

## Future Considerations

### Different Limits for PAT vs Auth0 per Tier

If we later need PAT-specific limits (e.g., lower limits for automated access), we could:

1. Add separate fields: `rate_pat_read_per_minute`, `rate_auth0_read_per_minute`, etc.
2. Or: Keep single set of limits but apply a multiplier for PAT access

Current recommendation: Don't add this complexity until there's a clear need.

### Rate Limit Headers

Current rate limit headers (`X-RateLimit-*`) will automatically reflect the tier-based limits since they're derived from `RateLimitResult`.
