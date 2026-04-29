# User Education (Tips & Empty States) — Implementation Plan

**Ticket:** [KAN-121](https://tiddly.atlassian.net/browse/KAN-121)

## Summary

Build a comprehensive user-education system: a tips data model + corpus, a browsable `/docs/tips` page, command-palette integration, and substantially improved empty states for both new users and filtered views. Also fix a pre-existing UX bug where saved-filter routes show the wrong empty state.

This is shipping as a **single PR with multiple commits**. The milestone structure exists for logical sequencing and review boundaries, not separate PRs.

## Dependency notes

- **M0 and M6** deliver standalone value (filter empty states) and depend only on `AllContent.tsx` — neither needs the tips corpus to exist. They can be implemented immediately in sequence.
- **M1 → M2 → M3** is the tips infrastructure path (data model → renderer → docs page).
- **M4 → M5** is an editorial pipeline producing the authored corpus. M5 is the only milestone that produces tip *content*; the others produce code or process artifacts.
- **M7, M8, M9** depend on M5 having authored tips to surface (specifically: M7 needs starter tips, M8/M9 need the corpus).
- **M10** is the cross-cutting file-sync pass that runs last.

## Maintenance & ownership

When a feature is renamed, removed, or substantially changed, the changing PR is responsible for updating any tips that reference it. Run `grep -r '<feature-name>' frontend/src/data/tips/` as part of feature-rename PRs. The M5 corpus-level test that validates `relatedDocs` paths against actual routes will catch broken-route staleness automatically; semantic staleness (text that's still technically valid but no longer matches product behavior) is human-review only. There is no telemetry on tip impressions in v1, so corpus curation is gut-feel — keep the corpus small and deliberate rather than large and uncurated.

## Locked decisions (from design discussion)

| Topic | Decision |
|---|---|
| Storage format | TS modules per category, markdown body strings (no MDX) |
| Audience field | `'beginner' \| 'power' \| 'all'` |
| Media support | Optional, discriminated union: `image` / `video` / `component` (component variant is data-only in v1; renderer registry stays empty) |
| Command palette UX | Flat append after Settings; visual `Tip:` prefix + lightbulb icon; no section header; tips appear last so non-tip commands always rank above |
| Filter empty-state level | Level 3 (echo + actionable: "No bookmarks tagged X yet — add the X tag to a bookmark to see it here") |
| New-user empty state | CTAs + 2-3 type-relevant starter tips embedded |
| Push surfaces (TotD, banners, toasts) | Deferred — not in v1 |
| Server-synced dismissal/seen-state | Deferred — not in v1 |
| Sourcing process | Three phases: free-form agent discovery → human review → schema-strict agent authoring |

## Out of scope (deferred follow-ups)

- Tip of the Day / push surfaces
- Server-synced tip-seen state
- Level 4 filter empty state ("you have N near-matches" suggestions)
- Custom Motion-component tip animations (schema supports them; registry stays empty)
- First-run onboarding tour

## Follow-ups discovered during M4 review

These are architectural / system-level changes that surfaced while reviewing the per-category candidate files. They aren't blocking M5 (authoring can proceed and we'll flag tips that need them), but they should be addressed before the corresponding tips actually ship to users. Each item links back to the candidate file where it was discovered.

### 1. Tier flag on the `Tip` schema

**Discovered in:** `docs/implementation_plans/2026-04-25-user-education-tip-candidates-ai.md` — every keeper in the `ai` category is a Pro-tier feature, but the schema has no way to express that. A free-tier user landing on `/docs/tips` will see all the AI tips with no signal they need to upgrade.

**Why this matters:** Tips and Tricks doubles as a soft conversion surface for free-tier users when a tip is for a higher-tier feature — but only if the page can express tier-gating clearly and offer an upgrade path inline. Without it, AI tips read as universally available, which is misleading.

**Proposed work:**

- **Schema (M1 retro):** add `minTier?: 'standard' | 'pro'` to the `Tip` interface. `undefined` = available on all tiers (free implicit baseline). `'pro'` = available only on Pro and above. Aligns with the existing `Tier` constants (`FREE` / `STANDARD` / `PRO`).
- **TipCard (M2 retro):** when `minTier` is set, render a tier badge ("Pro") in the badge row. For users known to be on a tier below `minTier`, append a small inline "Upgrade to Pro" CTA pointing at `/pricing`.
- **Authoring (M5):** every authored tip gets `minTier` evaluated. Tips for tier-gated features declare it; otherwise omit.

**Open questions:**

- Should `minTier: 'free'` be a meaningful value (i.e., a "Free" badge)? Likely overkill — leave `undefined` as the implicit "all tiers" signal.
- Should the upgrade CTA show only when the user's current tier is below `minTier`, or always? Knowing the user's tier requires the auth context on `/docs/tips`, which is a public page today.

### 2. MCP-consumability of tips

**Discovered in:** `docs/implementation_plans/2026-04-25-user-education-tip-candidates-bookmarks.md` (item D1 — "have Claude write a search-optimized summary back into your bookmark"). Substantially narrowed during the `mcp` category review.

**Why this matters:** Some tips describe workflows the *agent* would execute on the user's behalf, not the user's own keyboard/UI actions. Initial framing was that surfacing those via MCP would turn the tips corpus into a small library of "things Claude can do for you with this product."

**Narrowed conclusion (after `mcp` category review):** The candidate agent-instruction tips that surfaced from the `mcp` category review (use `get_context` first, prefer `edit_content`, optimistic-locking semantics, tag replacement vs append, etc.) are *already* in the MCP server's `instructions.md` and per-tool descriptions in `tools.yaml`. The agent receives all of this at session start. So:

- Adding those tips to `/docs/tips` is wasted effort — users don't read agent-instruction prose.
- Surfacing them via a `list_tips` MCP tool would duplicate what the agent already has, while bloating its context budget and degrading performance.

The actually-useful universe of MCP-visible tips is therefore much smaller than expected — limited to:

1. **Tips that aren't in the MCP server's existing instructions/descriptions.** Anything the agent already knows is dead weight to publish again.
2. **Cross-tool workflows that span multiple features and that no individual tool description captures.** E.g., the bookmarks `D1` tip ("ask Claude to fetch the URL, summarize, save back via update_item") combines `get_item` + URL fetch + `update_item` — no single tool description describes the full flow.
3. **Tiddly-content-model nuances** (e.g., interactions between archived state and search visibility) that aren't tied to one tool.

**Decision implication:**

- A dedicated `mcpVisible?: boolean` field + new `list_tips` MCP tool is **probably overkill for v1.** The candidate set is small, and the schema/tool work is non-trivial.
- A lighter approach: when an authored tip is genuinely a cross-tool agent-workflow (like `bookmarks:D1`), append a one-paragraph version of it to `backend/src/mcp_server/instructions.md` directly. No schema changes, no new tools — just hand-curate the agent-facing instruction set.
- Revisit if the tips corpus grows past v1 and accumulates a meaningful number of agent-cross-tool workflows.

### 3. Verify tips that claim API/Jinja behavior via unit tests

**Discovered in:** `docs/implementation_plans/2026-04-25-user-education-tip-candidates-prompts.md` — multiple tips claim Jinja2 features working through the API → template-renderer pipeline (`| default()` filter, `{% for %}` over list-typed arguments, `{# #}` comments, `{%- if %}` whitespace control).

**Why this matters:** vanilla Jinja2 has rich features, but Tiddly's prompt rendering goes through the API → backend template renderer → optional MCP path. A tip that describes vanilla-Jinja behavior may not actually work end-to-end if:

- The argument schema doesn't express the type the tip implies (e.g. lists vs strings).
- The renderer is configured with restricted filters/extensions.
- The API serializes argument values in a way that strips structure before the renderer sees them.

We risk authoring tips that "work in our heads" but break for users.

**Action (M5 prerequisite):** before authoring any tip that depends on a specific Jinja feature working through the API, write a unit test that exercises the full pipeline. Suggested location: `backend/tests/services/test_template_renderer.py` for renderer-level claims, `backend/tests/api/test_prompts.py` for API-end claims, and an MCP-path test if the tip implies MCP-side behavior.

**Tips currently flagged as needing verification:**

- `prompts:2` — `{%- if %}` whitespace stripping
- `prompts:6` — Jinja filters (`| default`, `| upper`, `| join`) through the API render path
- `prompts:10` — `{# #}` comments stripped on render
- `prompts:13` — `{% for %}` loop over a list-typed argument (highest-risk: argument schema may not currently express list types)

**General principle to fold into M5:** the authoring agent should not write a tip claiming API-or-template behavior unless a unit test exists that confirms the behavior. If verification reveals the claim doesn't hold, the tip is dropped or reframed.

## Validated assumptions

The following were verified by reading code before drafting this plan. The agent should re-verify any specific detail before depending on it:

- `frontend/src/components/ui/EmptyState.tsx` accepts only `icon/title/description/action(s)` — no children/extra slot today. **Will need to be extended** in M7.
- `frontend/src/pages/docs/components/InfoCallout.tsx` already has a `tip` variant.
- `frontend/src/components/CommandPalette.tsx` uses a flat `commands: CommandItem[]` array with substring `cmd.label.toLowerCase().includes(query)` filtering — no relevance ranking, no sections. Tips will append cleanly.
- `react-markdown` and `remark-gfm` are in `frontend/package.json` but **not yet used** in `frontend/src/`. M2 will introduce the first usage.
- `motion/react` (Motion, formerly Framer Motion) is installed and used by the landing-page animations in `frontend/src/components/AnimationCarousel.tsx` and its three slide components.
- `ContentFilter.filter_expression` is `{ groups: { tags: string[]; operator: 'AND' }[]; group_operator: 'OR' }` plus `content_types: ContentType[]`. Filters are tag-only DNF expressions — no date or text predicates.
- Saved-filter route `/app/content/filters/:filterId` renders `AllContent.tsx`. The `currentFilterId` and `currentFilter` are available in the component scope.

## Documentation the agent should read before starting

- `CLAUDE.md` and `AGENTS.md` (root) — esp. the "Files to Keep in Sync" section
- `frontend/src/pages/docs/DocsKnownIssues.tsx`, `DocsShortcuts.tsx`, `DocsFAQ.tsx` — pattern reference for new docs pages
- `frontend/src/components/DocsLayout.tsx` — sidebar registration pattern
- `frontend/src/components/CommandPalette.tsx` — read in full before M8
- `frontend/src/pages/AllContent.tsx` lines 700–830 — empty-state branches before M0/M6/M7
- `frontend/src/types.ts` — `ContentFilter`, `FilterExpression`, `FilterGroup` definitions
- React Router v7 docs (https://reactrouter.com/) for the routing additions
- `react-markdown` docs (https://github.com/remarkjs/react-markdown) for the markdown body renderer

## Agent behavior

- **Complete each milestone fully** — code + tests + docs — before moving on. Stop and wait for human review between milestones.
- **Ask clarifying questions** rather than making assumptions. Several milestones below explicitly call out open questions that must be resolved before implementation.
- **Validate assumptions** by reading the code first. Several "validated assumptions" above were originally wrong; treat the list as a starting point, not gospel.
- **No backwards compatibility required.** Breaking changes are acceptable. Remove legacy code that conflicts with cleaner design.
- **Don't over-engineer.** If a milestone says "simple substring match," don't add a fuzzy-search library. If it says "static array," don't introduce caching.
- **Test meaningfully.** Test core behavior, edge cases, and error conditions. Skip trivial render-snapshot tests that just assert "the component returns JSX."
- **Tests must use type hints / TypeScript types** consistently with the rest of the codebase.
- **Never skip or weaken tests to make them pass.** Investigate failures.

---

# Milestone 0 — Fix existing saved-filter empty-state bug

**This is a pre-existing product bug, independent of the rest of this plan.** It can ship as its own PR if desired, but is included here as it directly precedes the empty-state work in later milestones.

## Goal & Outcome

Fix `AllContent.tsx` so that the empty state on a saved-filter route (`/app/content/filters/:filterId`) is filter-aware, not a misleading new-user prompt.

After this milestone:
- A user on a saved-filter route with zero matches and no transient filters layered on top sees a generic-but-correct "No items match this filter" message — **not** the "No bookmarks yet / New Bookmark" CTA, which is wrong because creating a bookmark doesn't necessarily make it match the filter.
- The fix is intentionally minimal here. M6 will replace the generic copy with descriptive Level 3 copy via `describeFilter()`.

## Implementation Outline

1. In `AllContent.tsx` empty-state rendering (currently lines 740-823), add **two new branches** before the existing fall-through "No bookmarks yet" branch:
   - **Filter-not-found branch** (handles deleted or invalid filter IDs): condition `currentFilterId !== undefined && filtersHasFetched && currentFilter === undefined && items.length === 0`. Output: `EmptyState` with title "Filter not found", description "This filter may have been deleted.", and a CTA back to All Content (e.g., navigate to `/app/content`). Without this, a stale URL pointing at a deleted filter shows the misleading "no items match" copy.
   - **Saved-filter empty branch**: condition `currentFilterId !== undefined && currentFilter !== undefined && !hasFilters && items.length === 0`. Output: `EmptyState` with a generic but correct title (e.g., "No items match this filter") and description ("This filter has no matches yet."). **No** "create new" CTA — the filter context makes that misleading.
   - Use a neutral icon (e.g., `SearchIcon` or `AdjustmentsIcon`).
2. Verify the existing `archived` and `deleted` view branches still take precedence and aren't affected.

The condition tightening (`currentFilter !== undefined`) is critical — without it, the filter-not-found case falls through to the saved-filter-empty branch and shows confidently misleading copy.

## Testing Strategy

Tests live alongside `AllContent.test.tsx` (or create one if absent — verify whether AllContent has a test file).

- New-user empty state on `/app/content` with no items still shows the appropriate type-aware copy (`'No content yet'` for the default multi-type route per `AllContent.tsx:795`; `'No <type>s yet'` only when scoped to a single content type) with create CTAs (regression guard). Match the existing test patterns in `AllContent.test.tsx:351`.
- New: saved-filter empty state (filter exists, no transient filters) shows the new filter-aware copy and **does not** show a create-content button.
- New: **filter-not-found state** — saved-filter route with a non-existent filter ID after `filtersHasFetched` becomes true shows "Filter not found" copy with a link back to All Content. **Update the existing test at `AllContent.test.tsx:1194-1204`** which currently asserts "No content yet" for filter ID 999.
- Saved-filter route with transient filters (search query, tag chip, content type) layered on top still shows the "No content found / Try adjusting" branch (the more specific transient-filter branch should win).
- Archived and deleted views with/without filters unchanged.

---

# Milestone 1 — Tip data model & storage scaffolding

## Goal & Outcome

Define the `Tip` type, set up the storage layout, and seed the corpus with 3-5 gold-standard hand-written tips.

After this milestone:
- The `Tip` interface and supporting types live in `frontend/src/data/tips/types.ts`.
- A flat `allTips: Tip[]` is exported from `frontend/src/data/tips/index.ts`, along with helpers for filtering by category, area, audience, and starter status.
- A single `frontend/src/data/tips/tips.ts` holds the array. Splitting into per-category files is **deferred** until the corpus exceeds ~100 tips (it won't in v1 — see M5).
- 3-5 well-written seed tips that future authoring agents will pattern-match on.
- No UI yet — pure data + helpers.

## Implementation Outline

1. Create `frontend/src/data/tips/types.ts` with:

```ts
export type TipCategory =
  | 'editor' | 'search' | 'filters' | 'tags'
  | 'cli' | 'extension' | 'mcp' | 'prompts'
  | 'bookmarks' | 'notes' | 'ai'
  | 'shortcuts' | 'account'

export type TipAudience = 'beginner' | 'power' | 'all'

export type TipMedia =
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'video'; src: string; alt: string; poster?: string }
  | { kind: 'component'; id: string }

export interface RelatedDoc {
  label: string
  path: string
}

export interface Tip {
  id: string                    // stable kebab-case slug, unique across all tips
  title: string                 // ≤ 80 chars (enforced by validation)
  body: string                  // markdown, ≤ 500 chars (enforced by validation)
  /**
   * Categories the tip claims. Non-empty. A tip can belong to multiple
   * categories (e.g. slash commands → ['notes', 'prompts']; paste-URL →
   * ['bookmarks', 'shortcuts']). /docs/tips renders the tip under each section
   * it claims (deliberate duplication for browsability); empty-state pickers
   * dedupe by id.
   */
  categories: TipCategory[]
  audience: TipAudience
  /**
   * Global display priority for /docs/tips and similar ranked surfaces (lower
   * = higher rank). Tips without a priority sort to the bottom (id asc).
   * Independent of `starterPriority`, which only governs empty-state picking.
   */
  priority?: number
  /** Route patterns where this tip is contextually relevant */
  areas?: string[]
  /** Keyboard shortcut tokens, if applicable */
  shortcut?: string[]
  /** Links to deeper docs */
  relatedDocs?: RelatedDoc[]
  /** Optional media (most tips will have none) */
  media?: TipMedia
  /** True for the curated new-user starter set; used in empty states */
  starter?: boolean
  /** Sort priority among starter tips (lower = higher priority). Required when starter=true. Must be unique within EACH category the tip claims. */
  starterPriority?: number
}
```

2. Create `frontend/src/data/tips/tips.ts` exporting `allTips: Tip[]` (the single source of truth in v1).
3. Create `frontend/src/data/tips/index.ts` exporting:
   - `allTips` re-export
   - `getTipsByCategory(cat: TipCategory): Tip[]` — returns tips that claim `cat` in their `categories` array, sorted by `byPriorityThenId` (priority asc, id tiebreaker).
   - `getTipsByArea(routePath: string): Tip[]` — uses a shared `matchPathPrefix` helper (extracted from `frontend/src/routePrefetch.ts`'s `findMatchingRoute`) so the exact-or-longest-prefix algorithm is shared with the prefetch system. The route tables stay separate (the prefetch table lists lazy-loaded chunks; tip `areas` describe contextual relevance).
   - `getStarterTips(category?: TipCategory): Tip[]` — returns tips with `starter: true`, sorted by `starterPriority` ascending; with a category arg, scopes to starters claiming that category in their `categories` array.
   - `pickStarterTipsForContentTypes(types: ContentType[], limit: number = 3): Tip[]` — bridges the `ContentType` taxonomy (`'bookmark' | 'note' | 'prompt'`) used in `AllContent.tsx` to the `TipCategory` taxonomy. Mapping: `bookmark → 'bookmarks'`, `note → 'notes'`, `prompt → 'prompts'`. Iterate `types` in `ALL_CONTENT_TYPES` order (the constant from `frontend/src/types.ts`) so cross-category order is deterministic. Round-robin by ascending `starterPriority` per type, **dedupe by `id`** (load-bearing for multi-category tips — see note below), cap at `limit`.
   - `pickStarterTipsFromCorpus(tips, types, limit)` — pure variant exported for fixture-driven tests.
   - `searchTips(query: string): Tip[]` — substring match on title + body, case-insensitive.
   - `byPriorityThenId(left, right): number` — comparator exported for callers (DocsTips section sort) so tips order consistently across surfaces.
   - **Validate at module load** (via exported `validateTips(tips)` for testability):
     - No two tips share an `id` (throw with the duplicate id).
     - Every tip has `title.length ≤ 80` and `body.length ≤ 500`.
     - `categories` is non-empty.
     - Every tip with `starter: true` has `starterPriority` set; starter priorities are unique within EACH category the tip claims (a multi-category starter must not collide with another starter at the same priority in any of its declared categories).

   **Why dedupe-by-id is load-bearing in `pickStarterTipsForContentTypes`:** with multi-category tips, the same tip can match more than one slice. A tip with `categories: ['notes', 'prompts']` lands in both the `note` and the `prompt` starter pool, so when the user requests both content types the round-robin would otherwise add it twice. The cursor advances even when a candidate is deduped so the algorithm doesn't loop.
4. Populate `tips.ts` with 3-5 hand-written seed tips drawn from the ticket bullets (e.g., `cmd+click` for new tab, `cmd+click` for multi-cursor, `cmd+d` for multi-edit). These are **gold-standard examples** for future authoring agents.

## Open questions (resolved during plan revision — listed for traceability)

- **`areas` matching (RESOLVED):** reuse `findMatchingRoute` from `frontend/src/routePrefetch.ts:58`. It already does longest-prefix matching with `?`/`#` stripping against the same route table. If a tip-specific tweak is needed, factor a shared `matchPathPrefix` helper rather than duplicating logic.
- **Length ceilings (RESOLVED):** title ≤ 80, body ≤ 500. Enforced by validation at module load. May relax during M5 if seed tips need more room — but adjust the ceiling explicitly rather than ship over-long tips.

## Testing Strategy

- `getTipsByCategory` returns tips that claim the requested category in their `categories` array. Multi-category tips appear under each category they claim. Results are sorted by `priority` ascending (id tiebreaker).
- `getTipsByArea('/app/content/filters/abc')` returns tips whose `areas` cover this path via `matchPathPrefix`. Cover: exact match, prefix match, no match, no `areas` field, path with query/hash suffix.
- `getStarterTips()` returns tips with `starter: true`, **sorted by `starterPriority` ascending**. With a category arg, scopes to starters claiming that category. Multi-category starters appear under each of their declared categories.
- `byPriorityThenId` comparator: priority ascending; tips without priority sort to the bottom; ties broken by id.
- `pickStarterTipsForContentTypes`:
  - Single type → returns starter tips of that mapped category, ordered by `starterPriority`, capped at `limit`.
  - Multi-type → 1 per type, cross-type order pinned to `ALL_CONTENT_TYPES`; ties on `starterPriority` within a type broken by tip `id` ascending. **Test pins exact ids and exact order** so reorderings of `tips.ts` don't silently change UI.
  - **Dedupe by id** when a multi-category tip matches more than one requested content type (e.g., a tip with `categories: ['notes', 'prompts']` requested for both `note` and `prompt` content types appears once).
  - Empty starter set for a type → that type contributes zero tips, others fill the limit.
- `searchTips` is case-insensitive, matches title and body, returns `[]` for empty query.
- Duplicate-id validation: a tip array with two same-id tips causes validation to throw with a useful message.
- Length-ceiling validation: tip with title > 80 or body > 500 chars throws with a useful message.
- Empty-categories validation: tip with `categories: []` throws.
- Starter-priority validation: tip with `starter: true` but no `starterPriority` throws; two starter tips colliding on priority within ANY claimed category throws (multi-category starters get checked against each declared category).
- Schema sanity: every seed tip in `tips.ts` has required fields and valid enum values.

---

# Milestone 2 — Tip rendering primitives

## Goal & Outcome

Build the components that render a tip in any context: docs page list item, palette detail view, empty-state inline. All later UI milestones depend on these.

After this milestone:
- A `<TipCard>` (and possibly a smaller `<TipCardCompact>`) renders a `Tip` consistently across surfaces.
- Markdown bodies render via `react-markdown` with `remark-gfm`.
- Image and video media render correctly; the `component` media variant renders a placeholder (or no-op) since the registry is empty in v1.
- Components are storybook-free but visually verified by the agent in the dev server.

## Implementation Outline

1. Create `frontend/src/components/tips/TipCard.tsx`. Variants needed:
   - `variant="full"` — used on `/docs/tips` page; shows title, body, audience badge, category badge, related docs, media if present.
   - `variant="compact"` — used in empty states; smaller, denser, no media (or a tiny thumbnail at most).
   - Decide whether these are one component with a prop or two separate components — agent's call based on shared logic.
2. Create `frontend/src/components/tips/TipBody.tsx`. Lock the markdown config explicitly (no other read-only renderer exists in `frontend/src` to inherit from):

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSanitize]}
  components={{
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
  }}
>
  {body}
</ReactMarkdown>
```

`rehype-sanitize` is already in `frontend/package.json`. The link override matches the existing convention at `BookmarkCard.tsx:126` and `ConsentDialog.tsx:67`. Do **not** enable `rehypeRaw` — tip bodies should never embed raw HTML.
3. Create `frontend/src/components/tips/TipMedia.tsx` — renders `image` (img tag), `video` (`<video autoplay muted loop playsinline>`), or returns `null` for the `component` variant. Lazy-load images/videos with `loading="lazy"` / `preload="metadata"`.
4. **Do not** build the component-variant registry in v1. The schema accepts `kind: 'component'` but the renderer ignores it (renders nothing or a small placeholder for dev).

**Design note**: The same `Tip` shape renders across at least four contexts (full doc card, compact empty-state card, palette result, ambient callout reference). If a context needs context-specific rendering, **solve it in the renderer (props on `TipCard` or a dedicated component), not by adding fields to the `Tip` schema.** The schema stays minimal; visual divergence lives in components.

## Open questions

- Visual design: this plan deliberately doesn't prescribe styling. The agent should look at `InfoCallout.tsx`, `FAQItem.tsx`, and `DocsKnownIssues.tsx` for the visual language and match it. Stop and ask if the existing patterns don't compose cleanly.

## Testing Strategy

- `TipBody` renders markdown correctly: paragraphs, code, links, lists.
- `TipBody` link rendering: `<a>` tags get `target="_blank"` + `rel="noopener noreferrer"`.
- **`TipBody` sanitization**: a body containing `<script>alert(1)</script>` renders no script element; a body with `[click](javascript:alert(1))` renders no `javascript:` link. One-line defense against forgotten config.
- `TipMedia` renders `<img>` for `kind: 'image'`, `<video>` for `kind: 'video'`, returns null for `kind: 'component'`.
- `TipCard` renders all surfaced fields in `full` variant; respects compact variant's omissions; does not crash on tips missing optional fields (`media`, `relatedDocs`, `shortcut`, `areas`).
- `TipCard` correctly shows audience and category badges.

---

# Milestone 3 — `/docs/tips` page

## Goal & Outcome

Add a dedicated, browsable, filterable, searchable Tips page under the docs section, rendered as a flat list ranked by global `priority`.

After this milestone:
- Visiting `/docs/tips` shows the full tip corpus (currently only the M1 seed tips, until M5 is complete) ordered by `priority` ascending (lower = higher rank; id tiebreaker).
- Users can search (substring match on title + body), filter by category (multi-select), and filter by audience (single-select with inclusive matching for `'all'` tips).
- The page appears in the docs sidebar as "Tips" (top-level, between API and FAQ).

## Implementation Outline

1. Create `frontend/src/pages/docs/DocsTips.tsx`:
   - Search input (debounced, ~150-200ms — match existing patterns).
   - Category filter chips using `FilterChip` from `components/ui/`. **Multi-select**: empty selection = no filter; a tip matches if ANY of its `categories` ∈ selected set. Chip ordering: content-type categories first (`bookmarks`, `notes`, `prompts`) in `ALL_CONTENT_TYPES` order, then other present categories alphabetical.
   - Audience filter (single-select: `All` / `Beginner` / `Power user`). **Inclusive matching**: `Beginner` shows `audience: 'beginner'` AND `audience: 'all'` tips because `'all'` semantically means "applies to everyone." Same symmetry for `Power user`.
   - Flat list of surviving tips ordered by `byPriorityThenId` (priority asc, id tiebreaker; tips without a priority sort to the bottom). Each tip renders exactly once regardless of how many categories it claims.
   - Renders matching tips using `<TipCard variant="full" />` from M2. The full-variant container carries `id={\`tip-${tip.id}\`}` (set in M2's `TipCard.tsx`) for deep-linking.
   - Empty result handling: show an `EmptyState` if filters/search match nothing.
2. Add hash-scroll support. There is no existing hash-anchor scroll mechanism in `frontend/src` (verified — no `location.hash` or `scrollIntoView` against hash anywhere; `routePrefetch.ts:60` even strips `#` before matching). Without this, `/docs/tips#tip-<tip-id>` deep-links from M8 (option 3) and M9 ambient callouts will silently land at the top of the page.

   **Deep-link convention (locked in M2):** the DOM id is `tip-<tip-id>` to avoid collisions between tip slugs and unrelated page elements. Deep-link URLs must use the prefixed form `/docs/tips#tip-<tip-id>`. M8 / M9 link generators must match this — never emit `/docs/tips#<tip-id>` (no prefix).

   **Sticky-header offset:** `TipCard` (M2) sets `scroll-mt-20` on the full-variant container so `scrollIntoView({ block: 'start' })` lands the title clear of the public header rather than behind it.
   - Create `frontend/src/hooks/useHashScroll.ts` — small hook that watches `useLocation().hash` and, on change (and on mount), looks up `document.getElementById(hash.slice(1))` and calls `.scrollIntoView({ block: 'start' })`. Silent no-op when no element matches.
   - Use `[location.hash]` only as the effect dep. Tips are imported synchronously and `useEffect` runs after DOM commit, so the target is in place by the time the lookup fires. Adding `tips.length` as a second dep would re-fire on filter/search changes and steal scroll position.
3. Register route in `frontend/src/App.tsx`:
   - Lazy import: `const DocsTips = lazy(() => import('./pages/docs/DocsTips').then(m => ({ default: m.DocsTips })))`
   - Add route entry: `{ path: '/docs/tips', element: <DocsTips /> }` between `/docs/api` and `/docs/faq`.
4. Register sidebar entry in `frontend/src/components/DocsLayout.tsx`: `{ label: 'Tips', path: '/docs/tips' }` as a top-level entry between API and FAQ.
5. Add `/docs/tips` to `frontend/src/routePrefetch.ts` so PrefetchLink/hover prefetches the chunk. (Also unblocks future `relatedDocs` paths pointing at `/docs/tips#tip-…` to resolve via M5's `findMatchingRoute` corpus check.)
6. Update `frontend/public/llms.txt` with a brief blurb describing the page and the deep-link form.

## Open questions

(All resolved during M3 implementation — listed here for traceability.)

- **Sidebar placement:** top-level "Tips" between API and FAQ. Top-level co-locates with discovery-aid pages (FAQ, Known Issues) rather than feature reference docs.
- **Category filter:** multi-select (matches existing `FilterChip` ergonomics).
- **Audience filter inclusive matching:** confirmed — `'all'` tips show under any narrow audience filter.
- **Sectioned vs flat layout:** flat, ranked globally by `priority`. Sections were considered but felt visually heavy at the v1 corpus size; a flat priority-ranked list lets the highest-value tips lead the page regardless of category. Multi-category tips render once.

## Testing Strategy

- Page renders all tips when no filters/search applied.
- Search filters correctly (case-insensitive substring on title + body).
- Category filter chips correctly subset.
- Audience filter correctly subsets.
- Combined filter + search works (intersection).
- Empty state shows when filters yield no results.
- Route navigation works: integration test that navigates to `/docs/tips` renders the page.
- **Hash-scroll**: navigating to `/docs/tips#<existing-tip-id>` calls `scrollIntoView` on the matching tip's container (mock `Element.prototype.scrollIntoView` and assert it was called with the right element). Navigating to `/docs/tips#<unknown-id>` does not throw.

---

# Milestone 4 — Tip sourcing: Phase 1 (free-form agent discovery)

**This is an editorial pipeline milestone, not a code milestone.** It produces an artifact (a discovery brief) used to drive Phase 2 (human review). It does **not** block M0 or M6 — those deliver standalone empty-state value and can be implemented while the corpus is still being scoped.

## Goal & Outcome

Run discovery agents in parallel, each owning a slice of the app, producing a free-form list of candidate tips. The output is consolidated into a single review document.

After this milestone:
- A document at `docs/implementation_plans/2026-04-25-user-education-tip-candidates.md` (working file, not for permanent commit) lists every candidate tip across the app, organized by category, with location reference, suggested title, and one-line description per candidate.
- The list is intentionally messy and exhaustive — deduping, rewording, and trimming happens in Phase 2.

## Implementation Outline

1. The implementing agent **does not run discovery agents itself.** Instead, it produces:
   - A **discovery brief template** (the prompt template passed to each discovery agent).
   - A **surface inventory** mapping each `TipCategory` to a list of files/components/docs the corresponding agent should review.
   - These two artifacts go into `docs/implementation_plans/2026-04-25-user-education-tip-discovery-brief.md`.
2. The brief should require each discovery agent to:
   - Walk only the files in its assigned slice.
   - Propose one tip per non-trivial feature/behavior it finds.
   - Output entries as `{ category, location_ref, suggested_title, one_line_description }`. No body writing, no schema discipline yet.
   - Not fabricate features — every tip must be traceable to actual code or docs.
   - Flag uncertainty rather than guessing.
3. The user (Shane) runs the discovery agents using the brief and consolidates results.

## Testing Strategy

N/A — no code change. Acceptance is "the brief is concrete enough that running it against any one slice produces a usable candidate list."

---

# Milestone 5 — Tip sourcing: Phase 3 (authoring agent)

**Phase 2 (human review and finalization of the candidate list) happens between M4 and M5, outside the implementation plan.**

## Goal & Outcome

Produce the authored tip corpus from the finalized candidate list. After this milestone, the v1 tips dataset is complete and locked.

After this milestone:
- `tips.ts` is populated with authored tips matching the schema.
- `starter: true` + `starterPriority` set on the curated new-user set (target: 8-12 tips total, distributed across content types, with contiguous priorities `1, 2, 3, ...` per category).
- **Total v1 corpus targets ~30-50 tips**, prioritized by frequency-of-use of the underlying feature. Quality over volume — 30 sharp tips beats 200 bland ones. Additional tips can be authored in follow-up batches post-launch.

## Implementation Outline

1. The implementing agent reads the finalized candidate list (output of Phase 2) and produces tip entries conforming to the schema from M1.
2. The candidate list will likely contain more entries than the v1 corpus needs. The authoring agent should **prioritize ruthlessly**: pick the tips with the highest expected value-per-impression. Defer the rest to a follow-up batch — better to ship 30 sharp tips than 100 mediocre ones.
3. Each tip body is hand-quality markdown: terse, no marketing tone, accurate to actual product behavior, includes the relevant shortcut tokens / `relatedDocs` where applicable. Treat the M1 seed tips as the calibration target for tone and density.
4. The agent does **not** generate media files. Tips that warrant media in the future get `media` set later, manually.
5. Run the M1 schema-validation tests — every tip must pass.

**Carry-over from M2 (must address before shipping a media tip):** the `image`/`video` variants of `TipMedia` accept no width/height, so loaded media will cause cumulative layout shift inside scroll-heavy contexts like `/docs/tips`. Before authoring the first media tip, extend `TipMedia` in `frontend/src/data/tips/types.ts` with explicit dimensions (or `aspectRatio`) and update `TipMedia.tsx` to reserve space. The schema currently has a code comment flagging this — keep the change atomic with the first media tip.

## Testing Strategy

- All existing M1 tests pass against the populated dataset.
- New: a corpus-level test that asserts there is **at least one starter tip per major content type** (`bookmark`, `note`, `prompt`).
- New: every tip's `relatedDocs` paths resolve via `findMatchingRoute` from `frontend/src/routePrefetch.ts:58` — the test asserts `findMatchingRoute(tip.relatedDocs[i].path) !== undefined` for every tip. This is also a useful drift-guard for `routePrefetch.ts` itself; if a tip references a route the prefetcher doesn't know about, **add it to the prefetch table first** (same constraint that already applies for any new docs route).
- New: corpus size is within target (≤ 50 v1 tips); test fails with a clear message if exceeded so the cap is visible to future contributors.

---

# Milestone 6 — Filter description utilities & Level 3 filter empty state

## Goal & Outcome

Replace M0's generic filter-empty-state copy with descriptive Level 3 copy where it adds value. Critically: **only generate descriptive copy where the user can't already see what they did**. The search bar already shows their query; the content type chips already show their selection. The high-leverage cases are saved filters (which encode complex tag expressions the user can't see in one place) and transient tag chips (where multiple selections in combination produce non-obvious empty results).

After this milestone:
- `describeSavedFilter()` produces human-readable empty-state copy for saved-filter routes.
- `describeTagChips()` produces human-readable empty-state copy for transient tag-chip filters.
- Search-query-only and content-type-chip-only empty states keep the existing generic "Try adjusting your search or filter" copy — the user already sees what they applied.
- `AllContent.tsx` empty-state branches call the right utility based on which filter dimensions are active, composing two strings if multiple dimensions are present.

## Implementation Outline

1. Create `frontend/src/utils/describeFilter.ts` with **two narrow functions**:

   ```ts
   export function describeSavedFilter(
     filter: ContentFilter,
     effectiveContentTypes: ContentType[],  // post-chip-narrowing, not raw filter.content_types
     view: ViewOption,
   ): { title: string; description: string; suggestion?: string }

   export function describeTagChips(
     tags: string[],
     match: 'all' | 'any',
     contentTypes: ContentType[],
     availableContentTypes: ContentType[],
     view: ViewOption,
     mode: 'standalone' | 'overlay',  // 'overlay' returns a subordinate clause
   ): { title?: string; description: string }
   ```

   `describeSavedFilter` takes the **effective** content type set (what the user is currently viewing after any transient content-type chip narrowing), not the raw `filter.content_types`. This is what makes the noun in copy match the noun the page is actually showing.

2. **Normalizers** (shared between both functions and `AllContent.tsx`):
   - `resolveFilterContentTypes(filter)` — if `filter.content_types.length === 0`, returns the same fallback `AllContent.tsx:169-171` uses (effectively all types). Otherwise returns the array as-is. Use this in **both** places so they can't drift.
   - `describeSavedFilter` treats an unresolvable filter (no non-empty groups) as: `{ title: 'No items match this filter yet', description: '' }`, no suggestion. Defensive — should not occur in practice but the agent has a defined answer.
   - `describeSavedFilter` treats `effectiveContentTypes.length === 0` (no types in scope) by using the generic noun "items" rather than enumerating.

3. Plain-English rendering rules (shared):
   - Within an AND group, tags join with " and " (`tagged python and reading-list`).
   - Multiple OR groups (saved filters only) join with " or " (`tagged (python and reading-list) or (rust and tutorial)`).
   - Use parentheses only when there is more than one group.
   - Content type renders as `bookmarks`, `notes`, `prompts`, or combinations (`bookmarks and notes`). **Always plural** in filter copy.
   - Archived/deleted views compose: `No archived bookmarks tagged X yet`.

4. `describeSavedFilter` may include a `suggestion` field with an actionable hint, but **only when** the filter is single-group, single-tag — that's the only case where the actionable copy reads cleanly. For multi-group, multi-tag, or normalized-fallback cases, omit the suggestion.

5. `describeTagChips` in `'overlay'` mode returns a subordinate clause for composition, e.g., `description: "You're also filtering by tag tutorial."` This avoids the awkward two-sentence concatenation problem ("No bookmarks tagged python yet. No bookmarks tagged tutorial yet."). When composed by the caller, the result reads like: `"No bookmarks tagged python yet. You're also filtering by tag tutorial."` Suggestions are kept separate from the merged description.

6. **Branch reorganization in `AllContent.tsx`** — important. M0 introduces a saved-filter-empty branch behind `!hasFilters`. M6 must reorganize so the saved-filter branch becomes the parent for **all** empty states on a saved-filter route, including the case where transient filters are layered. Two acceptable approaches:
   - Lift the `currentFilterId !== undefined && currentFilter !== undefined` check above the `hasFilters` check.
   - Rename `hasFilters` to `hasTransientFilters` and let the saved-filter branch claim ownership of all empty cases on a saved-filter route.

   If the agent follows M0 literally and then M6 literally without reorganizing, the combined case (saved filter + transient overlay) will still be picked up by the existing transient branch and **the saved-filter description won't show** — exactly the regression M6 is meant to prevent.

7. Update `AllContent.tsx` empty-state branches per the reorganization:
   - **Saved-filter route empty (filter exists)**: call `describeSavedFilter(filter, effectiveContentTypes, view)` for the primary copy. If the user *also* applied transient tag chips, call `describeTagChips(..., 'overlay')` and append. If a transient search query is present, append `" Matching '${query}'."` (or the equivalent — keep simple). If a transient content-type chip is narrowing, the noun in `describeSavedFilter`'s output already reflects it.
   - **Filter-not-found** (M0 branch): unchanged from M0.
   - **Transient empty (no saved filter)**: if `selectedTags.length > 0`, call `describeTagChips(..., 'standalone')`. Otherwise (search-only or content-type-only) keep the existing generic "Try adjusting your search or filter" copy — those dimensions are already visible to the user, regenerating them as prose adds nothing.
   - Suggestion (when present) renders as a separate visual element below the description, not inline.

## Open questions

- Pluralization: confirmed always-plural (`No bookmarks tagged X yet` even when only 1 item would have matched).
- Multi-group suggestion: confirmed omitted (only single-group single-tag filters show suggestions).

## Testing Strategy

`describeSavedFilter` unit tests:
- Single tag, single group, single content type → "No bookmarks tagged X yet" + suggestion.
- Multiple tags in one AND group → "No bookmarks tagged X and Y yet" (no suggestion — multi-tag).
- Multiple OR groups → "No items tagged (X and Y) or (A and B) yet" (no suggestion).
- Multiple content types → "No bookmarks or notes tagged X yet".
- Archived/deleted view modifiers compose correctly.
- **`content_types: []` in saved filter** → noun is "items" (treated as all types via the shared normalizer).
- **`groups: []` (or all groups have empty tags)** → fallback `{ title: 'No items match this filter yet', description: '' }`, no suggestion.
- **Effective content types differ from declared** (transient content-type chip narrowed): noun reflects the **effective** types ("No notes tagged X yet" even when filter declares `['bookmark', 'note']`).

`describeTagChips` unit tests:
- Single chip with `match=all`, `mode='standalone'` → "No bookmarks tagged X yet".
- Multiple chips with `match=all` → "No bookmarks tagged X and Y yet".
- Multiple chips with `match=any` → "No bookmarks tagged X or Y yet".
- Content type subset narrows the noun ("No notes tagged X yet").
- Archived/deleted view modifiers compose.
- **`mode='overlay'`** returns a subordinate clause ("You're also filtering by tag X.") suitable for appending to a saved-filter description.

Integration tests in `AllContent.test.tsx`:
- Saved-filter empty state shows descriptive copy from `describeSavedFilter` (replaces M0's generic copy).
- **Filter-not-found** state (M0) is unchanged by M6 — still shows the not-found copy.
- Saved filter + transient tag chip composes saved-filter description + overlay clause from `describeTagChips`.
- **Saved filter + transient search query** appends a "Matching '<query>'" segment.
- **Saved filter + transient content-type chip narrowing** uses the narrowed noun in `describeSavedFilter`'s output (e.g., filter declares `['bookmark', 'note']`, user chips to notes only → "No notes tagged X yet").
- **Saved filter + search + tag chip** (three-way composition) suppresses suggestion.
- Transient tag-chip-only empty state uses `describeTagChips` in standalone mode.
- Search-query-only empty state still shows the generic "Try adjusting" copy (regression).
- Content-type-chip-only empty state still shows the generic copy (regression).

---

# Milestone 7 — Embed starter tips in new-user empty state

## Goal & Outcome

Augment the new-user (no-data) empty state in `AllContent.tsx` with 2-3 starter tips relevant to the active content type, drawn from the `starter: true` set authored in M5.

After this milestone:
- A user landing on `/app/content` with zero items sees the existing CTAs **plus** 2-3 starter tips contextual to the content type(s) shown.
- Multi-type empty states (when more than one content type is in scope) pick starter tips that span those types.

## Implementation Outline

1. Extend `frontend/src/components/ui/EmptyState.tsx` to accept optional `children?: ReactNode`, rendered below the actions. **Use composition (`children`), not a named `extra` prop** — idiomatic React, ages better.
2. In `AllContent.tsx`'s new-user empty-state branch (currently lines 789-823), pick starter tips using **`pickStarterTipsForContentTypes(availableContentTypes, 3)`** from M1. The helper handles both single-type and multi-type cases with deterministic ordering (no ad-hoc selection logic in the empty-state branch). Render results as `<TipCard variant="compact" />` instances inside the `EmptyState`'s children.

**Carry-over from M2 (visual review):** M2's `TipBody` uses `prose-sm` for both full and compact variants (the original `prose-xs` modifier doesn't exist in `@tailwindcss/typography`). When compact cards land inside the centered `EmptyState`, eyeball whether `prose-sm` reads too heavy next to the `text-sm` compact title. If so, the right fix is explicit `text-xs leading-relaxed` utilities + targeted spacing overrides — not reviving `prose-xs`.

## Open questions

- **Selection determinism:** stable take-first by `starterPriority` (deterministic, no rotation in v1).
- **Multi-type case:** 1 tip per type, up to 3 total.

## Testing Strategy

- `EmptyState` renders `children` content correctly when provided; renders without it when omitted (regression).
- Single-type new-user empty state shows starter tips of that type, ordered by `starterPriority`.
- Multi-type new-user empty state shows up to 3 tips spanning the active types, deduped by id, in `ALL_CONTENT_TYPES` order.
- Selection is **deterministic** — same input produces same tips in same order across renders. (Algorithm-level determinism is tested in M1's `pickStarterTipsForContentTypes` tests; this M7 test asserts the call path produces consistent UI.)
- When no starter tips are available for the active types (e.g., during local dev with an empty corpus), the empty state degrades gracefully — CTAs still render, no tips section.
- Filtered/search empty states (covered in M0/M6) do **not** show starter tips — this is only for the no-data case.

---

# Milestone 8 — Command palette tips integration

## Goal & Outcome

Make tips searchable from the command palette, alongside existing commands, settings, and content.

After this milestone:
- Typing in the command palette returns matching tips inline, after non-tip commands.
- Tip entries are visually differentiated (`Tip:` label prefix + lightbulb icon).
- Selecting a tip opens its detail view.

## Implementation Outline

1. Extend `CommandItem` (defined around `CommandPalette.tsx:83`) with an optional `searchText?: string` field. Update `filteredCommands` derivation at line 397 to OR-match against it:
   ```ts
   commands.filter((cmd) =>
     cmd.label.toLowerCase().includes(lower) ||
     (cmd.searchText?.toLowerCase().includes(lower) ?? false)
   )
   ```
   Non-tip commands omit the field, so existing behavior is unchanged.
2. In `CommandPalette.tsx`, append tip entries to the `commands` array (the `useMemo` at line 308).
   - Each tip becomes a `CommandItem` with `label: 'Tip: ' + tip.title`, `searchText: \`${tip.title}\\n${tip.body}\``, lightbulb icon, and an action that opens the tip detail.
   - Tips are appended **after** all other command groups so they rank below in the filtered list. Verify this is what the existing array order produces; if not, fix ordering.
3. **Suppress tips when query length < 2.** Filter tip entries out of `filteredCommands` when the user hasn't typed a meaningful query. At 30-50 tips this isn't a noise problem yet, but the rule scales naturally if the corpus grows post-launch and avoids confusion on first palette open.
4. Tip detail view: **open question, see below**.

**Carry-over from M2 (extract shared `<Kbd>` primitive):** by M8 we'll have at least three concrete `<kbd>` callers — `DocsShortcuts.tsx` (private `Kbd`, `min-w-[24px]`), `CommandPalette.tsx` (inline `<kbd>`, `min-w-[20px]`), and `TipCard.tsx` (private `Kbd`, `min-w-[24px]`). When this milestone lands, extract a shared `frontend/src/components/ui/Kbd.tsx` informed by the actual usage shapes and migrate all three to it. Same pattern may apply to `<Badge>` if M8 introduces a tip badge in the palette. Don't promote earlier — three concrete callers produce a better abstraction than two.

## Open questions (must resolve before implementing)

- **Tip detail UX in palette context:** three options, with cost ranking shaped by code-level findings:
  1. Open a separate modal layered above the palette (uses existing `Modal.tsx`).
     **Note:** Both `Modal.tsx:83` and `CommandPalette.tsx:293` install **capture-phase** `keydown` listeners on `document` for Escape. Layering a modal above the palette creates a real conflict — pressing Escape on the modal would close the palette too. Workable, but requires either disabling the palette's Escape handler while the tip modal is open, or refactoring one of the listeners to non-capture phase. Adds friction.
  2. Switch the palette to a "tip detail" sub-view. The palette already has a `PaletteView = 'commands' | 'search'` pattern at line 72 — extending to `'tip'` is mechanically straightforward and avoids the Escape conflict entirely. **Lowest implementation cost.**
  3. Navigate to `/docs/tips#<tip-id>` (closes palette, deep-links to the tip). Depends on the M3 hash-scroll work, but works once that lands.

  **Ask the user before implementing.** Given the Escape conflict, option 2 is the lowest-cost choice and option 1 is no longer trivially "free reuse of `Modal.tsx`."
- **Match scope (RESOLVED via implementation outline above):** parallel `searchText` field on `CommandItem`. Tips populate it as `${title}\n${body}`; non-tip commands leave it undefined.
- **Performance:** at the v1 corpus size, substring-filtering on every keystroke is trivially fast. No memoization changes needed unless profiling proves otherwise.

## Testing Strategy

- Empty query: command palette shows non-tip commands; **no tip entries appear**.
- Query length 1: still no tip entries.
- Query length ≥ 2 matching a tip's title: tip appears in results, ranked after non-tip commands.
- Query length ≥ 2 matching only a tip's body (text not in title): tip appears (verifies `searchText` matching).
- Query matching both a tip and a non-tip command: non-tip command ranks first (above the tip).
- Selecting a tip opens the chosen detail UX (per resolved open question).
- Tip entries display the lightbulb icon and `Tip:` prefix.
- Existing palette behavior (search sub-view, navigation commands, settings) is not regressed.
- **`searchText` regression**: a non-tip command with no `searchText` filters identically to today's behavior.

---

# Milestone 9 — Ambient `InfoCallout` placements

## Goal & Outcome

Sprinkle a small number of high-value tips into existing docs and feature pages as `InfoCallout` instances with `variant="tip"`. This is intentionally a light pass — not exhaustive.

After this milestone:
- 5-10 high-value ambient tips appear in places they're most useful (e.g., editor docs, search docs, CLI reference, settings tokens page).

## Implementation Outline

1. Identify candidate placements by reviewing existing docs pages alongside the M5 starter set. Prefer placements that match the surface (don't put a CLI tip on the editor docs).
2. For each placement, add a small `<InfoCallout variant="tip">` near the relevant content. Use a brief one-liner that links to the full tip on `/docs/tips#<id>` for users who want more.
3. Touch only docs/feature pages that already exist — do not create new pages.

## Testing Strategy

No new tests required (these are static JSX additions).

If any existing docs page has tests, run them to confirm no regressions.

---

# Milestone 10 — File-sync, polish, and docs

## Goal & Outcome

Update all the user-facing and project-level files that need to reflect this work.

After this milestone:
- All "Files to Keep in Sync" entries from `AGENTS.md` that apply have been touched.
- The plan file is cross-referenced from anywhere appropriate.

## Implementation Outline

Based on `AGENTS.md` "Files to Keep in Sync":

1. `README.md` — mention tips/education feature in the feature list if applicable.
2. `frontend/public/llms.txt` — include the new `/docs/tips` page (already done in M3, but verify).
3. `frontend/src/pages/FeaturesPage.tsx` and/or `LandingPage.tsx` — if a public-facing mention is warranted (user's call).
4. `frontend/src/pages/changelog/Changelog.tsx` — add an entry for this release.
5. `docs/architecture.md` — add a brief subsection on the tips system if the architecture doc covers similar UI subsystems. Skip if it doesn't.
6. `AGENTS.md` itself — add a brief note about the tips data layout convention if useful (e.g., "Tips data lives in `frontend/src/data/tips/` — TS modules per category, markdown body strings").
7. `.env.example` — N/A (no new env vars).

Defer to the user on whether `FAQContent.tsx`, `DocsAPI.tsx`, etc. need touching — likely not.

## Testing Strategy

N/A — content updates only. Run `make frontend-verify` to confirm nothing breaks.

---

# Open questions to resolve before starting

The agent should confirm these with the user **before** beginning the milestone where each applies:

1. **Component variant for visual design** (M2): match `InfoCallout` / `FAQItem` / `DocsKnownIssues` styles, or different?
2. **Sidebar placement of "Tips & Tricks"** (M3): under Features, or top-level near FAQ?
3. **Tip detail UX in palette** (M8): modal / sub-view / navigate? **Code-level note:** option 2 (sub-view) is now the lowest-cost choice because option 1 (modal) hits a capture-phase Escape conflict between `Modal.tsx` and `CommandPalette.tsx`. Option 3 depends on M3's hash-scroll work. Final call is still UX, not code.

## Resolved during plan revision

The following were originally open and have been resolved in the plan above:

- **`areas` matching algorithm** → reuse `findMatchingRoute` from `routePrefetch.ts:58`.
- **Length ceilings** → title ≤ 80 chars, body ≤ 500 chars; enforced via M1 validation.
- **Multi-group filter suggestion behavior** → suggestion present only for single-group, single-tag filters.
- **Always-plural filter copy** → confirmed always-plural.
- **Starter-tip selection determinism** → stable, sorted by `starterPriority` ascending; cross-category iteration order pinned to `ALL_CONTENT_TYPES`.
- **Multi-type starter-tip selection** → `pickStarterTipsForContentTypes` helper, 1 per type, up to 3, deduped.
- **Empty-query palette behavior** → tips suppressed when query length < 2.
- **Palette search match scope** → optional `searchText` field on `CommandItem`; tips populate it as `${title}\n${body}`.
- **EmptyState extension shape** → `children: ReactNode`, not a named `extra` prop.
- **Markdown rendering config** → `react-markdown` + `remark-gfm` + `rehype-sanitize`, with link override for `target="_blank"`. No `rehypeRaw`.
- **Saved-filter empty content_types** → normalize via shared `resolveFilterContentTypes`; copy uses generic noun "items" when types are unrestricted.
- **Saved-filter empty `groups`** → defensive fallback: generic "No items match this filter yet", no description, no suggestion.
- **Combined-state filter copy** → `describeTagChips` `'overlay'` mode returns subordinate clause; saved-filter description + overlay clause compose without redundancy.

These remain documented inline in the relevant milestones for traceability.
