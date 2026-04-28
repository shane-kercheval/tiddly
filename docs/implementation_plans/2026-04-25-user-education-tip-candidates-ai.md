# Tip candidates — ai (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

**All keepers in this category appear to be Pro-tier features.** The Tip schema does not yet support a `minTier` field — see "Follow-ups discovered during review" at the bottom.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Click suggested tag chips to add them | 30 | Borderline obvious, but kept: serves both as user education AND a soft Pro-feature surface for free users (with the tier-badge work pending). |
| 2 | Generate titles and descriptions from the sparkle icon | 20 | Hidden killer; one-click metadata generation. Pro. |
| 3 | Find related items via the linked content input | 25 | Cross-type relationship suggestions. Pro. |
| 4 | Generate prompt arguments from `{{ placeholders }}` | 15 | Strong workflow tip. **Cross-category** with `prompts`. Pro. |
| 5 | Refine one prompt argument field at a time | 25 | Companion to #4. **Cross-category** with `prompts`. Pro. |
| 6 | Bring your own API key for higher AI limits | 20 | The BYOK affordance is the tip; the quota numbers are tier copy. Pro. |
| 7 | Test a BYOK key before relying on it | 35 | Companion to #6. Pro. |
| 8 | Track your daily AI quota | drop | "Look at the meter" — UI surface, not a tip. |
| 9 | Reopening the tag/relationship input reuses cached suggestions | drop | Auto-behavior. |
| 10 | Pick a different model per AI use case | 30 | Real config choice. **Cross-category** with `account`/settings. Pro. |
| 11 | AI doesn't fire without grounding context | drop | Defensive UX, not actionable. |
| S1 | AI tag suggestions match your existing tag style | drop | Internal mechanism; user doesn't act on it. |
| S2 | Connect AI agents directly to your library via MCP | drop | **dup** → `mcp` category owns this; verify their version is at least as good. |
| S3 | Stale suggestions discarded | drop | Internal plumbing. |
| S4 | Daily AI limit resets on rolling 24-hour window | drop | Tier-limitation copy, not a tip. |

## Final keepers (preserved details from the agent file)

All keepers are Pro-tier (verify each at consolidation). Once a `minTier` schema field exists, every keeper here gets `minTier: 'pro'`.

### #4 — Generate prompt arguments from `{{ placeholders }}` — priority 15 — cross-category: prompts

After you've drafted a template using `{{ variable_name }}` syntax, click the sparkle in the Arguments section to scan the template and generate name + description for every placeholder at once.

- Reference: `frontend/src/hooks/useAIArgumentIntegration.ts:64`
- Tags: workflow | new-user
- minTier: pro (verify)

### #2 — Generate titles and descriptions from the sparkle icon — priority 20

Each title and description field has a sparkle icon. Click the title sparkle to generate a title from the description/content; click the description sparkle to generate from content. If both fields are empty, one click generates both.

- Reference: `frontend/src/hooks/useMetadataSuggestions.ts:5`
- Tags: feature | new-user
- minTier: pro (verify)

### #6 — Bring your own API key for higher AI limits — priority 20

In Settings → AI Configuration, paste a Google, OpenAI, or Anthropic key per use case. BYOK keys get a separate, higher daily limit (verify current numbers) and let you pick a specific model. Keys live in browser localStorage only — never on the server.

- Reference: `frontend/src/pages/settings/SettingsAI.tsx:262`
- Tags: feature | power-user
- minTier: pro (verify)

### #3 — Find related items via the linked content input — priority 25

Open the linked content input on any item to get AI-suggested cross-type relationships. The backend searches by title and shared tags first, then asks the LLM to filter for genuinely related candidates across bookmarks, notes, and prompts.

- Reference: `frontend/src/hooks/useRelationshipSuggestions.ts:5`
- Tags: feature | new-user
- minTier: pro (verify)

### #5 — Refine one prompt argument field at a time — priority 25 — cross-category: prompts

Each argument row has its own sparkle. Fill in just the name and click it to suggest a description; fill in just the description to suggest a name. Leave both blank for AI to infer name, description, and the required flag from the template.

- Reference: `frontend/src/hooks/useAIArgumentIntegration.ts:80`
- Tags: workflow | power-user
- minTier: pro (verify)

### #1 — Click suggested tag chips to add them — priority 30

When the tag input opens on a bookmark, note, or prompt, AI-suggested tags appear as muted chips to the right of your existing tags. Click one to promote it; it's removed from suggestions and added to your tag list.

- Reference: `frontend/src/hooks/useTagSuggestions.ts:32`
- Tags: feature | new-user
- minTier: pro (verify)

### #10 — Pick a different model per AI use case — priority 30 — cross-category: account

BYOK lets you map each use case (Suggestions today; Transform, Auto-Complete, Chat coming soon) to a different model from a curated allowlist. Useful for routing cheap calls (tag suggestions) to a smaller model and reserving a larger model for higher-stakes cases.

- Reference: `frontend/src/pages/settings/SettingsAI.tsx:117`
- Tags: workflow | power-user
- minTier: pro (verify)

### #7 — Test a BYOK key before relying on it — priority 35

After pasting a key in Settings → AI Configuration, hit Test. The backend makes a minimal call against your selected model so you catch wrong-key/wrong-provider mistakes before triggering real suggestions.

- Reference: `frontend/src/pages/settings/SettingsAI.tsx:99`
- Tags: feature | power-user
- minTier: pro (verify)

## Cross-category tracking

- `ai:4` ↔ `prompts` — argument generation. Pick canonical home at consolidation.
- `ai:5` ↔ `prompts` — per-field argument refine.
- `ai:10` ↔ `account` — model configuration in Settings.
- `ai:S2` → `mcp` — verify the MCP agent's version of "connect AI agents to library." If theirs is weaker, pull this version.

## Follow-ups discovered during review

These are architectural / system-level changes that surface during candidate review. Roll up to the user-education plan when we close out the review pass.

### Tier flag on the Tip schema

**Problem:** every keeper in this category is Pro-tier, but the schema has no way to express that. A free-tier user on `/docs/tips` will see all the AI tips with no signal they need to upgrade.

**Proposed work:**

1. **Schema (M1 retro):** add `minTier?: 'standard' | 'pro'` to the `Tip` interface. `undefined` = available on all tiers (free implicit baseline). `'pro'` = available only on Pro and above. Aligns with the existing `Tier` constants in `backend/src/core/...` (FREE / STANDARD / PRO).
2. **Validation (M1 retro):** allow optional, no special validation logic beyond accepting the union.
3. **TipCard (M2 retro):** when `minTier` is set, render a tier badge in the badge row ("Pro"). For users known to be on a tier below `minTier`, append a small inline "Upgrade to Pro" CTA pointing at `/pricing`.
4. **Authoring (M5):** every authored tip gets `minTier` evaluated. Tips for tier-gated features declare it; otherwise omit.

**Open questions:**
- Should `minTier` apply to free-tier baseline tips? (e.g. `minTier: 'free'` is meaningful only if we want to display a "Free" badge — likely overkill.)
- Should the upgrade CTA show only when we know the user's current tier is below `minTier`, or always (acknowledging the tip is gated)? Knowing the user's tier requires the auth context on `/docs/tips`, which is a public page today.
