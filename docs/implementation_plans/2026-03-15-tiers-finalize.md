# Finalize Three-Tier Pricing: Free / Standard / Pro

**Tickets:** KAN-86, KAN-87, KAN-94
**Date:** 2026-03-15

## Context

We're transitioning from a single FREE tier to a three-tier pricing model: **Free**, **Standard**, **Pro**. The product is currently in beta — all users should get Pro-tier access during beta, with clear messaging that limits will change at launch.

**Philosophy:** Limit capacity, not features. All features are available on every tier.

**Current state:**
- `tier_limits.py` has FREE and DEV tiers. PRO is commented out. No STANDARD tier exists.
- FREE tier limits in the backend (100/100/100 bookmarks/notes/prompts, 100K chars, 30-day history) don't match what the pricing page shows (50/25/10, 25K chars, 3-day history).
- Pricing page shows a two-tier layout (Free at $0, Pro at $5/mo).
- No PAT quota enforcement exists — `token_service.py:create_token` has no limit check.
- No `max_pats` field exists in `TierLimits`.
- No payment integration (Stripe, etc.) — not in scope for this plan.
- `UserLimitsResponse` schema and frontend `UserLimits` type don't include `max_pats`, `history_retention_days`, `max_history_per_entity`, or `max_relationships_per_entity`.
- No abuse-prevention limit on tags per entity (handled separately as a hardcoded constant, not tier-based).

**Agreed tier structure:**

| | Free | Standard ($2/mo, $1/mo annual) | Pro ($5/mo, $4/mo annual) |
|---|---|---|---|
| Bookmarks | 10 | 250 | Unlimited (1,000,000) |
| Notes | 10 | 100 | Unlimited (1,000,000) |
| Prompts | 5 | 50 | Unlimited (1,000,000) |
| Chars/item | 25,000 | 50,000 | 100,000 |
| PATs | 3 | 10 | 50 |
| History retention | 1 day | 5 days | 15 days |
| Max history/entity | 100 | 100 | 100 |
| Read rate | 60/min, 500/day | 120/min, 2,000/day | 300/min, 10,000/day |
| Write rate | 20/min, 200/day | 60/min, 1,000/day | 200/min, 5,000/day |
| Sensitive rate | 5/min, 25/day | 15/min, 100/day | 30/min, 250/day |
| Tags/entity | 100 (hardcoded constant, not tier-based — abuse prevention) | | |
| Relationships/entity | 50 | 50 | 50 |

**Field length limits (same across all tiers — structural, not pricing levers):**

| Field | Limit | Notes |
|---|---|---|
| `max_title_length` | 200 | Increased from 100. Auto-scraped bookmark titles can easily hit 100 chars. |
| `max_description_length` | 1,000 | Unchanged. |
| `max_tag_name_length` | 50 | Unchanged. |
| `max_url_length` | 2,048 | Unchanged. De facto browser limit. |
| `max_prompt_name_length` | 100 | Unchanged. Identifiers like `code-review`. |
| `max_argument_name_length` | 100 | Unchanged. Variable names. |
| `max_argument_description_length` | 500 | Unchanged. |

**Beta behavior:** All existing users are migrated to `tier="pro"` in the database. New signups also get `tier="pro"` (change both `default` and `server_default` in the User model). The settings page and pricing page clearly communicate that Pro access is free during beta and will revert to Free at launch (date TBD). Users won't lose content but won't be able to create new items if over Free limits after the transition. Users who are over their tier's content length limits can still edit items, but they cannot save edits that keep the content above the limit — they must shorten to comply. This is intentional and why we warn users about the downgrade.

---

## Milestone 1: Database migration — user tier to Pro for beta

**Goal:** Migrate all existing users to `tier="pro"` and change the default for new users to `"pro"` during beta. This milestone is intentionally first — it must be deployed before the new tier limits in Milestone 2, because Milestone 2 dramatically tightens FREE tier rate limits (180→60 reads/min). If any user is still on `tier="free"` when new limits deploy, they'd get much stricter rate limiting.

**Outcome:**
- All existing users have `tier="pro"` in the database
- New user creation defaults to `"pro"` via both Python-side and database-side defaults
- Auth cache invalidated so cached `tier="free"` entries don't persist

### Implementation Outline

**IMPORTANT: Never create Alembic migration files manually.** Use the Makefile command:
```bash
make migration message="migrate users to pro tier for beta"
```
This runs `uv run alembic revision --autogenerate -m "..."`. The autogenerate won't detect data changes, so you'll need to edit the generated migration file to add the data migration SQL.

**Migration file** (after generation, edit the generated file):
- `upgrade()`: Execute `UPDATE users SET tier = 'pro' WHERE tier != 'pro'` (uses `!= 'pro'` instead of `= 'free'` to catch any unexpected tier values like NULL or typos)
- `downgrade()`: Make this a **no-op** (pass). This migration is effectively one-way. When beta ends, a separate migration will handle downgrading non-paying users. A naive `UPDATE users SET tier = 'free' WHERE tier = 'pro'` would clobber any users legitimately assigned Pro later.

**User model** (`backend/src/models/user.py`):
- Read first. The model currently has **both** `default="free"` (Python-side) and `server_default="free"` (database-side) on line 35-38.
- `default="free"` — used by SQLAlchemy when creating `User()` objects in Python application code (this is how your app creates users)
- `server_default="free"` — used in the SQL column definition (`DEFAULT 'free'`), applies to raw SQL inserts and migrations
- **Both must be changed to `"pro"`** for beta. If you only change `server_default`, ORM-created users will still get `tier="free"`.
- Add an inline comment on both defaults: `# BETA: default to "pro" during beta. Revert to "free" when beta ends.`
- When beta ends, a separate migration will revert both defaults and downgrade non-paying users.

**Auth cache** (`backend/src/core/auth_cache.py`):
- Bump `CACHE_SCHEMA_VERSION` from 4 to 5. This invalidates all existing cache entries (they use the version in the key prefix), forcing fresh DB lookups that will return `tier="pro"`. Without this, users could continue hitting Free-tier rate limits for up to 5 minutes after deployment due to stale cached `tier="free"` values.
- Add a comment to the version history: `# v5: All users migrated to Pro for beta`

### Testing Strategy

- Run `make migrate` in the dev environment and verify the migration applies cleanly
- Verify a new user created via the ORM (`User(auth0_id=..., ...)`) gets `tier="pro"` — this confirms both `default` and `server_default` were changed
- Verify existing tests still pass (most run in dev mode which overrides to DEV tier anyway)

---

## Milestone 2: Backend tier definitions and new fields

**Goal:** Update `TierLimits` dataclass and `TIER_LIMITS` dict to define all three tiers (FREE, STANDARD, PRO) with the agreed limits. Add `max_pats` field. Update DEV tier accordingly.

**Outcome:**
- `Tier` enum has FREE, STANDARD, PRO, DEV
- `TierLimits` has `max_pats` field
- All four tiers defined in `TIER_LIMITS` dict with correct values
- `get_tier_safely()` handles "standard" and "pro" strings
- All existing tests updated, new tests added

### Implementation Outline

**`backend/src/core/tier_limits.py`:**
- Add `STANDARD = "standard"` and `PRO = "pro"` to `Tier` enum (uncomment/replace the commented-out PRO)
- Add new field to `TierLimits` dataclass:
  - `max_pats: int` — max Personal Access Tokens a user can create (named `max_pats` to avoid confusion with LLM `max_tokens`)
- Update FREE tier limits to match agreed values (10/10/5 items, 25K chars, 1-day history, etc.)
- Add STANDARD tier entry
- Add PRO tier entry
- Update DEV tier with `max_pats` (1,000,000)
- Field lengths that are the same across tiers (title: 200, description: 1000, tag_name: 50, url: 2048, prompt_name: 100, argument_name: 100, argument_description: 500) — keep identical values in all tiers. These are structural limits, not pricing levers.
- The content length fields (`max_bookmark_content_length`, `max_note_content_length`, `max_prompt_content_length`) should use the same value within a tier: FREE = 25,000, STANDARD = 50,000, PRO = 100,000.
- Add a comment block at the top of the file documenting all locations that must be updated when tier values change:
  ```python
  # SYNC LOCATIONS: When updating tier values, also update:
  # - frontend/src/pages/Pricing.tsx (pricing cards and comparison table)
  # - frontend/src/pages/LandingPage.tsx (FAQ: "How much does Tiddly cost?")
  # - frontend/public/llms.txt (Tier Limits section)
  # - frontend/src/types.ts (UserLimits interface — if adding/removing fields)
  # - backend/src/schemas/user_limits.py (UserLimitsResponse — if adding/removing fields)
  ```

**`backend/src/schemas/user_limits.py` (`UserLimitsResponse`):**
- Add fields: `max_pats`, `history_retention_days`, `max_history_per_entity`, `max_relationships_per_entity`
- These are currently in `TierLimits` but not exposed via the API response. The `get_my_limits` endpoint uses `**asdict(limits)` so adding fields to both the dataclass and schema will automatically include them.
- **Important:** Field names must match exactly between `TierLimits` dataclass and `UserLimitsResponse` Pydantic model. A typo will cause a serialization error on `GET /users/me/limits`. Add an integration test to verify all fields appear.

**`frontend/src/types.ts` (`UserLimits` interface):**
- Add corresponding fields: `max_pats`, `history_retention_days`, `max_history_per_entity`, `max_relationships_per_entity`

### Testing Strategy

**`backend/tests/core/test_tier_limits.py`:**
- Update `TestTierEnum`: test STANDARD and PRO enum values and string construction
- Update `TestTierLimits.test__tier_limits__has_all_fields`: add `max_pats`
- Update `TestGetTierLimits.test__get_tier_limits__returns_free_limits`: assert new FREE values (10/10/5 items, 25K chars, 3 PATs, 1-day history, etc.)
- Add `test__get_tier_limits__returns_standard_limits`: assert all STANDARD values
- Add `test__get_tier_limits__returns_pro_limits`: assert all PRO values
- Update `TestFreeTierDefaults` class assertions to match new FREE values
- Update `TestDevTier.test__dev_tier__all_limits_higher_than_free`: still compares DEV >= FREE for all fields (should still pass with new fields)
- Add: `test__all_tiers_have_entries`: verify every `Tier` member has an entry in `TIER_LIMITS`
- Add: `test__standard_limits_between_free_and_pro`: every STANDARD limit >= FREE and <= PRO
- Add: `test__get_tier_safely__standard_and_pro`: test `get_tier_safely("standard")` and `get_tier_safely("pro")`

**Scan for hardcoded FREE tier values across the entire codebase** — any test or code asserting the old backend values will break. Search for: `max_bookmarks == 100`, `max_bookmarks=100`, `max_notes == 100`, `max_prompts == 100`, `100_000` (old content length), `history_retention_days=30` or `== 30`, `rate_read_per_minute=180` or `== 180`, `max_title_length=100` or `== 100` (now 200), etc. Also run the full test suite after changes and fix any failures.
- Add an integration test: hit `GET /users/me/limits` and verify all new fields (`max_pats`, `history_retention_days`, `max_history_per_entity`, `max_relationships_per_entity`) appear in the response.

---

## Milestone 3: PAT quota enforcement

**Goal:** Enforce `max_pats` when creating PATs. If a user is at their limit, return a 402 error consistent with existing `QuotaExceededError` pattern.

**Outcome:**
- Creating a PAT when at the limit returns 402 with `QUOTA_EXCEEDED` error code
- Existing PATs are not affected — only new creation is blocked
- Frontend token creation UI handles the 402 gracefully

### Implementation Outline

**`backend/src/services/token_service.py`:**
- Add a `count_user_tokens` function:
  ```python
  async def count_user_tokens(db: AsyncSession, user_id: UUID) -> int:
      result = await db.execute(
          select(func.count()).where(ApiToken.user_id == user_id)
      )
      return result.scalar_one()
  ```
- Update `create_token` to accept a `limits: TierLimits` parameter and check quota before creating:
  ```python
  current = await count_user_tokens(db, user_id)
  if current >= limits.max_pats:
      raise QuotaExceededError("token", current, limits.max_pats)
  ```

**`backend/src/api/routers/tokens.py`:**
- Import and inject `get_current_limits` dependency into `create_token` endpoint
- Pass `limits` to `token_service.create_token`
- Note: the existing `QuotaExceededError` handler in `main.py` already returns 402, so no new exception handler needed

**Frontend — PAT quota error handling:**
- The token creation flow is: `CreateTokenModal.tsx` → store (`tokensStore.ts`) → API call → global interceptor (`api.ts`).
- The global 402 interceptor in `api.ts` already catches `QuotaExceededError` and shows a toast. This is the primary error surface.
- **Do not add duplicate error handling** in the modal or store. Check the global handler first — Milestone 8 updates its wording to include a pricing link, which will cover PAT quota errors automatically.
- If the global toast is insufficient for the modal UX (e.g., the modal stays open after the error), the modal should handle the error *instead of* the global handler for this case, not in addition to it.

### Testing Strategy

**`backend/tests/services/test_token_service.py`** (or equivalent — find the existing test file first):
- Test creating tokens up to the limit succeeds
- Test creating one more token after reaching the limit raises `QuotaExceededError`
- Test that deleting a token and then creating one succeeds (quota freed)
- Test with different tier limits (e.g., `max_pats=1` for tight testing)

**Integration test:**
- Hit `POST /tokens/` at the limit and verify 402 response with correct error body
- Verify the response matches `QuotaExceededError` format: `{"detail": "...", "error_code": "QUOTA_EXCEEDED", "resource": "token", "current": N, "limit": N}`

---

## Milestone 4: Tags-per-entity abuse prevention

**Goal:** Add a hardcoded limit on tags per entity to prevent abuse (e.g., someone sending 1M tags in a request, causing massive DB load). This is **not** tier-based — it's a constant (100) that applies universally as a safety guardrail.

**Outcome:**
- Requests with more than 100 tags per entity are rejected with a clear error at the schema validation layer
- All create/update paths are covered automatically (since they all go through `validate_and_normalize_tags`)

### Implementation Outline

**`backend/src/schemas/validators.py`:**

This is the right place because `validate_and_normalize_tags` is already called by every entity schema (bookmark, note, prompt) and by `update_entity_tags` in `tag_service.py`. Adding the check here covers all paths in one place.

Add a constant and check **after dedup** (so duplicates don't inflate the count):

```python
MAX_TAGS_PER_ENTITY = 100

def validate_and_normalize_tags(tags: list[str]) -> list[str]:
    # ... existing dedup/normalize logic ...
    if len(normalized) > MAX_TAGS_PER_ENTITY:
        raise ValueError(
            f"Too many tags ({len(normalized)}). Maximum is {MAX_TAGS_PER_ENTITY} per item."
        )
    return normalized
```

This automatically protects:
- Entity creation (bookmark/note/prompt schemas call `validate_and_normalize_tags` in Pydantic validators)
- Entity updates (same schema validators)
- Direct tag updates via `update_entity_tags()` in `tag_service.py:446` (which calls `get_or_create_tags`, and the tag names come from schemas that already validated)

**Scope decision: filter groups are included.** This cap also applies to content filter group tags because `content_filter.py:FilterGroup` calls `validate_and_normalize_tags`. This is an explicit product decision — filter groups with 100+ AND'd tags are abusive and would never match anything useful. The same abuse-prevention rationale applies to filters as to entities.

**Verify coverage:** Read the tag write paths to confirm all go through `validate_and_normalize_tags`:
- `bookmark_service.py` create/update → schema validation → `validate_and_normalize_tags`
- `note_service.py` create/update → schema validation → `validate_and_normalize_tags`
- `prompt_service.py` create/update → schema validation → `validate_and_normalize_tags`
- `tag_service.py:update_entity_tags()` → receives already-validated tag names from callers
- `content_filter_service.py` → filter groups also go through `validate_and_normalize_tags` via `FilterGroup` schema

If `update_entity_tags` can receive unvalidated input (check callers), add the count check there too as a safety net.

### Testing Strategy

- Test `validate_and_normalize_tags` with exactly 100 tags succeeds
- Test with 101 tags raises `ValueError`
- Test that dedup runs before the count check (e.g., 150 tags with 100 duplicates = 50 unique → passes)
- Test that the error message is clear
- Integration test: POST a bookmark/note with 101 tags and verify 422 response (Pydantic validation error)

---

## Milestone 5: Update settings page — beta messaging and new fields

**Goal:** Update the settings page to clearly communicate beta status and show all tier information including new fields (PATs, history retention).

**Outcome:**
- Settings page shows "Pro (Beta)" as the current plan with a clear explanation
- Beta banner updated with specific messaging about what happens when beta ends
- PAT limit and history retention displayed in the limits table
- Users understand their content is safe but creation limits will change

### Implementation Outline

**`frontend/src/pages/settings/SettingsGeneral.tsx`:**

Read the file first. Then:

- Update the beta warning banner (currently a yellow box around line 108) to be more specific:
  - "During beta, all accounts have Pro-tier access at no charge. When beta ends (date TBD), accounts will move to the Free tier unless upgraded. Your existing content will be preserved — you just won't be able to create new items if you're over Free tier limits. See pricing for details." (link "pricing" to `/pricing`)
- Add PAT limit row to the limits table: show `limits.max_pats` as "Personal Access Tokens" under a new "API & Tokens" section header
- Add history retention row: show `limits.history_retention_days` as "Version history retention" with "X day(s)" format
- Show current plan as "Pro (Beta)" when `limits.tier === "pro"` — append "(Beta)" indicator next to the tier name

### Testing Strategy

- Visual verification: settings page renders correctly with all new fields
- Verify the limits table shows PAT limit and history retention
- Verify beta banner text is clear and links to pricing page
- Verify "Pro (Beta)" displays correctly

---

## Milestone 6: Update pricing page for three tiers + beta banner

**Goal:** Redesign the pricing page from two tiers to three tiers with a prominent "free during beta" banner.

**Outcome:**
- Three pricing cards: Free ($0), Standard ($2/mo), Pro ($5/mo)
- Monthly/annual toggle works for both Standard and Pro
- "Free during beta" banner at the top
- Feature comparison table updated for three tiers
- CTA buttons appropriate for beta (no payment flow yet)

### Implementation Outline

**`frontend/src/pages/Pricing.tsx`:**

Read the file first. Key changes:

- Add a beta banner at the top (after the hero, before the cards):
  - "Currently in beta — all accounts have Pro access at no charge. When beta ends, accounts will default to the Free tier unless upgraded. Your content is always preserved."
- Change from two-card to three-card layout (`lg:grid-cols-3`):
  - **Free**: $0 — 10 bookmarks, 10 notes, 5 prompts, 25K chars, 3 PATs, 1-day history
  - **Standard**: $2/mo ($1/mo annual) — 250 bookmarks, 100 notes, 50 prompts, 50K chars, 10 PATs, 5-day history
  - **Pro**: $5/mo ($4/mo annual) — Unlimited content, 100K chars, 50 PATs, 15-day history, highlighted as "most popular" or similar
- Update `comparisonData` array to include a `standard` column (currently only `free` and `pro`)
  - Add PATs row: 3 / 10 / 50
  - Update history retention: 1 day / 5 days / 15 days
  - Update all item counts and content limits
- Update `ComparisonSection` component to render three columns
- CTA buttons:
  - If not authenticated: "Get Started" (signup) on all cards
  - If authenticated: "Current Plan (Beta)" on Pro card (since everyone is Pro during beta), "Open App" on others
  - Standard and Pro upgrade buttons should not link to payment — they go to signup or show the app
- Update monthly/annual toggle to show both Standard and Pro prices:
  - Standard: $2/mo or $1/mo annual (save 50%)
  - Pro: $5/mo or $4/mo annual (save 20%)

### Testing Strategy

- Visual verification: three cards render correctly, toggle updates both Standard and Pro prices
- Verify all numbers match the agreed tier structure exactly
- Verify CTA buttons behave correctly for authenticated vs. unauthenticated users
- Verify beta banner is prominent and clear
- Verify comparison table has three columns with correct data

---

## Milestone 7: Update landing page, llms.txt, and FAQs

**Goal:** Update all public-facing content to reflect the three-tier structure and beta status. Verify FAQ accuracy per KAN-87.

**Outcome:**
- Landing page FAQ "How much does Tiddly cost?" updated for three tiers + beta
- Landing page final CTA updated
- `llms.txt` tier limits section updated
- Pricing page FAQs verified against actual product behavior

### Implementation Outline

**`frontend/src/pages/LandingPage.tsx`:**
- Update the "How much does Tiddly cost?" FAQ (around line 339):
  - Mention three tiers: Free ($0), Standard ($2/mo), Pro ($5/mo)
  - Add beta note: "During beta, all accounts have Pro access at no charge."
  - Link to pricing page for full details
- Update final CTA section text (around line 376): consider adding beta mention

**`frontend/public/llms.txt`:**
- Update the "Tier Limits" section (starts around line 281) to list all three tiers:
  - Free tier with correct limits (10/10/5 items, 25K chars, 3 PATs, 1-day history)
  - Standard tier with limits (250/100/50, 50K chars, 10 PATs, 5-day history)
  - Pro tier with limits (unlimited, 100K chars, 50 PATs, 15-day history)
  - Add rate limit details for all tiers
- Update the "Platform" pricing line (around line 272) to mention three tiers
- Add a note about beta status: "Currently in beta — all accounts have Pro access at no charge."

**Pricing page FAQ verification (KAN-87):**

Read each FAQ in `Pricing.tsx` and verify against actual behavior:

1. **"What happens if I hit a limit?"** — Backend returns 402 with `QuotaExceededError`. The error message includes "upgrade" but doesn't include a URL link to the pricing page. The FAQ says "with a link to upgrade" — either update the FAQ to say "with an option to upgrade" or add a link to `/pricing` in the frontend error toast. Decide which approach.

2. **"Can I downgrade from Pro to Free?"** — Accurate: data is preserved, limits re-apply, nothing is deleted. The quota check includes all rows (active + archived + deleted), so users over limits can't create new items. Verify this is the intended behavior and update wording if needed.

3. **"Do you offer refunds?"** — No payment system exists. Update to: "When paid plans launch, we'll offer a 30-day refund policy." Or remove entirely during beta.

4. **"Can I try Pro before committing?"** — Update to mention beta: "During beta, everyone has Pro access at no charge. After beta, the Free tier gives you full access to every feature — upgrade when you need more capacity."

5. **"What about AI features?"** — Accurate as-is. No changes needed.

6. **"Is there a self-hosted option?"** — Verify the GitHub link (`https://github.com/shane-kercheval/tiddly`) works. Self-hosted runs in dev mode by default which uses DEV tier (unlimited). Accurate.

### Testing Strategy

- Verify all text changes are accurate against the agreed tier structure
- Verify the GitHub repo link resolves
- Verify `llms.txt` numbers match `tier_limits.py` values exactly
- Search the entire codebase for remaining references to old pricing/limits that need updating:
  - Old pricing page Free values: `"50 bookmarks"`, `"25 notes"`, `"10 prompts"` (note: "10 bookmarks" and "10 notes" are the NEW Free values, don't change those)
  - Old backend Free values: `max_bookmarks=100` or `== 100` (in test assertions), `100_000` (old content length), `history_retention_days=30`, `rate_read_per_minute=180`
  - Old Pro pricing: `"$4/month billed annually"` or `"$4/mo"` without Standard context
  - Old PAT limits: `"25 API tokens"` or `"25 PATs"`
  - Old history values in tier context: `"30-day version history"`, `"3-day version history"`
  - Any mention of only two tiers (Free/Pro) without Standard

---

## Milestone 8: Improve limit error UX across clients

**Goal:** When users hit quota or rate limits, show clear, actionable messages that explain what happened and how to resolve it — including upgrade path for Free/Standard users on both 402 (quota) and 429 (rate limit) errors.

**Outcome:**
- Frontend 402 toasts include "Manage your plan" link to `/pricing`
- Frontend 429 toasts include "Manage your plan" link to `/pricing` for Free/Standard users — lets them know higher rate limits are available
- Chrome extension 402 links to `/pricing` instead of `/app/bookmarks`
- CLI already handles both well — no changes needed

### Current State

| Client | 402 (Quota) | 429 (Rate limit) |
|---|---|---|
| **Frontend** | Toast: "You've reached the limit of {limit} {resource}. Delete some existing items to create new ones." No upgrade link. | Toast: "Too many requests. Please wait {N} seconds." No context. |
| **Chrome ext** | Error + "Manage bookmarks" link to `/app/bookmarks` | "Rate limited — try again in {N}s" |
| **CLI** | "Quota exceeded: {resource} ({current}/{limit}). Upgrade at https://tiddly.me/pricing" (already good) | Auto-retries, then wait message (already good) |

### Implementation Outline

**Frontend (`frontend/src/services/api.ts`):**

Read the file first, specifically the response interceptor (around lines 112-175).

- **402 handler:** The interceptor already extracts `resource` and `limit` from the response. Update the toast to:
  - Include a clickable "Manage your plan" link to `/pricing` (react-hot-toast supports JSX/custom content — check how the existing toasts work)
  - Use neutral wording that works for all tiers: "You've reached the limit of {limit} {resource}. Delete existing items to free space. [Manage your plan](/pricing)"
  - "Manage your plan" is accurate for all tiers — Free/Standard users can see upgrade options, Pro users can see their plan. Avoids telling Pro users to "upgrade."

- **429 handler:** Update toast to include a pricing link for Free/Standard users:
  - "Too many requests. Please wait {N} seconds. [Higher limits available](/pricing)"
  - This isn't just an upsell — it informs users that they have options. Rate limits are tier-based and users should know higher limits exist.
  - For Pro users, the pricing link is harmless (they can see their plan). Keeping the same message for all tiers avoids needing tier-awareness in the interceptor.

**Chrome extension (`chrome-extension/popup-core.js`):**

Read the `handleSaveError()` function (around lines 541-601).

- **402 handler:** Change the link from `https://tiddly.me/app/bookmarks` ("Manage bookmarks") to `https://tiddly.me/pricing` ("See plans").
- Update the message to mention upgrading: "Bookmark limit reached. Delete existing bookmarks or see plans."

**Backend:** No changes needed. The neutral wording works without knowing the user's tier.

### Testing Strategy

- **Frontend API tests** (`frontend/src/services/api.test.ts`): update existing 402 test to verify the new toast message includes pricing link. Add test for 429 toast including pricing link.
- **Chrome extension:** manual test — trigger a 402 and verify the link goes to `/pricing`
- **Visual verification:** trigger quota exceeded in dev mode (set low limits) and verify the toast is clear and actionable

---

## Milestone 9: Deployment and verification

**Goal:** Safely deploy all changes to production, verify the migration ran correctly, and confirm all users are on the Pro tier.

**Outcome:**
- All changes deployed to production
- Database migration applied successfully
- All existing users verified to be on `tier="pro"`
- Pricing page, settings page, and landing page rendering correctly in production

### Deployment Steps

1. **Backup the Railway database** before deploying. Use Railway's manual snapshot feature or `pg_dump`. This is the safety net if anything goes wrong.

2. **Deploy to main.** The Alembic migration runs before the app starts (`make migrate`), so all users will be on Pro before the new code with tighter FREE limits begins serving requests. Note: if this work is ever split across multiple PRs, the migration PR must deploy first.

3. **Verify the migration and cache invalidation:**
   ```sql
   -- Check that no users are still on 'free' tier
   SELECT tier, COUNT(*) FROM users GROUP BY tier;
   -- Expected: all users on 'pro' (or 'dev' if any dev users exist)

   -- Check for any unexpected tier values
   SELECT DISTINCT tier FROM users;
   ```

4. **Verify the API** (this also confirms cache invalidation — if `tier` returns `"pro"`, stale cache entries are gone):
   - Hit `GET /users/me/limits` with a real account and verify:
     - `tier` is `"pro"`
     - `max_pats` field is present with correct Pro value (50)
     - `history_retention_days` is 15
     - All rate limits match Pro tier values
   - Create a new test account (signup) and verify it gets `tier="pro"`

5. **Verify frontend:**
   - Pricing page shows three tiers with beta banner
   - Settings page shows "Pro (Beta)" with correct limits
   - Landing page FAQ reflects three tiers and beta status

6. **Verify llms.txt:**
   - `https://tiddly.me/llms.txt` shows updated tier information

### Rollback Plan

If something goes wrong:
- The database backup from step 1 can be restored
- The migration's `downgrade()` is a no-op by design — to revert user tiers, run: `UPDATE users SET tier = 'free' WHERE tier = 'pro'` manually
- Code can be reverted via git revert on main

---

## Out of Scope

- **Stripe / payment integration** — deferred until beta ends and LLC is formed
- **Actual upgrade/downgrade flow** — no UI to change tiers (admin-only for now)
- **AI features pricing** — mentioned in FAQ as "may be priced separately"
- **Tier-based filter/collection limits** — `llms.txt` currently mentions "10 filters, 10 sidebar collections" for Free but these aren't enforced in `TierLimits`. Adding enforcement as a tier-based field is deferred to a separate ticket. (The `llms.txt` text itself is updated in Milestone 7.)
