# Content as Markdown: single-source public content for humans and agents

**Date:** 2026-05-21
**Status:** Planning
**Relationship to other plans:** Independent of and a prerequisite-in-spirit to the agent-empowerment plan (KAN-152), `agent-empowerment.md` in this directory (being renamed to a `2026-05-23-` prefix on the KAN-152 branch so it sorts after this one). That plan hand-authors a family of `llms-*.txt` files; once this refactor lands, much of that family can be *generated* from the content source established here, so KAN-152 will be revisited and simplified afterward. This plan does not depend on KAN-152 and should be executed first.

## Problem

tiddly.me's public content is rendered client-side from React/TSX. A non-JS agent fetching `https://tiddly.me/pricing` or `https://tiddly.me/docs/...` gets a ~590-byte empty shell — the content is invisible to it. Separately, tier limits are **triplicated and unsynchronized**: `backend/src/core/tier_limits.py` (canonical), `frontend/src/pages/Pricing.tsx` (hardcoded marketing copy), and `frontend/src/components/FAQContent.tsx` (hardcoded — and currently *wrong*; the Free-tier numbers drifted, filed as KAN-154). The authenticated app reads live limits from `/users/me/limits`, but the public-facing copy is hand-typed and rots.

Two distinct sub-problems, two mechanisms (see Prior Art for why this shape):

1. **Prose** (docs pages, FAQ, and optionally landing/features marketing) is authored *inside* TSX components. It needs a single content source that renders for humans and is emitted as agent-readable text.
2. **Structured data** (tier limits; later, possibly shortcuts/API endpoint lists) must have one canonical source that every surface derives from, instead of being hand-copied.

## Solution shape (the decisions, made)

- **Prose → MDX content source, rendered for humans, emitted as `.md` for agents.** Author docs as MDX files (a superset of markdown that also allows embedding the few interactive widgets we have). Docs pages become thin renderers. A build step emits a faithful plain-markdown copy of each page into `frontend/public/` at the matching path (Clerk-style `.md` convention) so a plain HTTP fetch returns readable content, plus one concatenated docs file.
- **Structured data → one canonical source (`tier_limits.py`), published for public/agent consumption.** Pricing and FAQ consume it instead of hardcoding; the agent-readable content derives the same numbers. This fixes KAN-154 *at the root*.
- **No SSR / no framework migration.** Agent-readability comes from the generated `.md`/text artifacts, **not** from server-rendering the SPA. Human pages stay client-rendered. SSR/prerender (for SEO or no-JS humans) is explicitly out of scope — a separate concern we are deliberately not solving here. This is the decision that keeps the effort bounded; record the rationale in the build-step code/commit so a future contributor doesn't "helpfully" add SSR thinking it was an oversight.
- **MDX over runtime `react-markdown` for docs.** Docs are static/build-time and some embed components, which MDX compiles cleanly; `react-markdown` stays for *runtime* user content (notes, tips bodies). We are not unifying those two paths.

### Why this shape (prior art — read before implementing)

Clerk is the reference implementation. Read:
- `https://clerk.com/llms.txt` — an index that links to `.md` and `llms-full.txt` representations.
- `https://clerk.com/docs/quickstarts/react.md` — a docs page served as plain markdown via the `.md` convention (note it's written to be consumed by agents).
- MDX: `https://mdxjs.com/docs/` and the bundler integration `https://mdxjs.com/packages/rollup/` (Vite uses Rollup).
- Already-present libs to reuse, not replace: `react-markdown`, `remark-gfm`, `rehype-sanitize` (see `frontend/package.json`).

Clerk can keep its `llms.txt` a thin link-index precisely because every linked page is agent-readable (markdown source + served `.md`). This plan gives tiddly that same property.

## Shared conventions (established in Milestone 1, reused by all later milestones)

Milestone 1 sets these; later milestones must reuse rather than reinvent:

- **Content source location and naming** for MDX docs files (the implementing agent picks the exact directory by convention against the repo).
- **The docs page renderer**: a single shared renderer/layout that compiles MDX, renders code fences with the existing copy affordance (today's `CopyableCodeBlock`), and renders links as router-aware links. Pages stop hand-writing prose JSX and instead render their MDX.
- **The agent-emit build step**: emits one plain-`.md` file per docs route into `frontend/public/` mirroring the route path, plus one concatenated docs file. The emitted markdown must be a faithful representation (no content silently dropped).
- **The component text-fallback contract** (defined when first needed in M2): any component embeddable in docs MDX must provide a static markdown/text representation for the agent emit, so the agent artifact never has an empty hole where a widget was.

## Milestones

---

### Milestone 1 — Markdown content pipeline + prose docs migration

**Goal & Outcome**

Stand up the MDX content pipeline end-to-end and migrate the pure-prose docs pages, proving the pattern before the harder pages.

- Public docs prose lives in MDX files as the single source; the `/docs/*` pages render those files for humans, looking the same as today.
- Each migrated doc is fetchable as plain markdown by a non-JS agent at a stable URL mirroring its route (e.g. `https://tiddly.me/docs/features/search.md`).
- A single concatenated agent-readable docs file is generated (the full prose corpus in one fetch).
- The renderer handles the constructs real docs use: GFM (tables, lists), fenced code blocks with a copy button, and internal links.

**Implementation Outline**

- **Add MDX build support** (Vite/Rollup MDX plugin) and establish the content-source directory. Migrate page *content* out of TSX into MDX; each docs page component becomes a thin renderer of its MDX. Reuse `CopyableCodeBlock` for code fences and the existing router `Link` for links via the MDX component mapping — do not build new equivalents.
- **The agent emit** is a build step that writes a faithful plain-`.md` per route into `frontend/public/` at the mirrored path, plus one concatenated file. For pure-prose pages the emitted `.md` is essentially the source. Confirm tiddly's static hosting serves `frontend/public/*.md` at the matching URL before settling the path scheme (today `frontend/public/llms.txt` is served at `/llms.txt`).
- **Scope this milestone to the pure-prose pages** — the ones with no embedded widgets (from a code scan: `DocsVersioning`, `DocsTagsFilters`, `DocsShortcuts`, `DocsKnownIssues`, `DocsExtensionsChrome`, `DocsExtensionsSafari`, `DocsSearch`, `DocsOverview`, `DocsFeaturesHub`, `DocsAPI`, `DocsAIFeatures` — verify against current code; "interactivity" that is only nav links or code blocks still counts as prose because the renderer handles both). Widget pages are M2.
- **Keep `docsRoutes.tsx` (command-palette index) in sync** — routes/paths must still resolve and searchText stays accurate.
- Do **not** touch tier/pricing numbers here (M3) or the curated top-level `llms.txt` hub (that's KAN-152's; this plan emits the raw per-page `.md` substrate it will later link to).

**Definition of Done**

- Migrated prose pages render for humans identically to before (spot-checked) and each is fetchable as `.md` by plain HTTP.
- Build emits the per-route `.md` mirror + concatenated file; a test asserts every migrated route has a corresponding emitted `.md` and that representative content strings survive into it (guards against silent loss).
- `make frontend-verify` passes; `docsRoutes.tsx` accurate.
- Rationale for "no SSR; agent-readability via emitted `.md`" recorded in the build-step code/commit.

---

### Milestone 2 — Interactive docs pages (MDX components + text-fallback contract)

**Goal & Outcome**

Migrate the docs pages that embed live widgets while keeping their agent-readable output complete.

- Widget-bearing docs pages (AI hub with `AISetupWidget`/`ExamplePrompts`, the tips page, and any others found) are authored as MDX with embedded components and render for humans as today.
- The emitted agent `.md` for those pages contains a meaningful textual representation of each widget — never an empty gap.

**Implementation Outline**

- **Define and apply the component text-fallback contract** (a shared convention, per "Shared conventions"): each component used in docs MDX supplies a static markdown/text fallback consumed by the agent emit. Example: `AISetupWidget` (an interactive CLI-command generator) emits a short textual equivalent — e.g. how to generate the command and the canonical `tiddly mcp configure` path — so an agent reading the `.md` still learns what the widget conveys.
- **Tips page**: `DocsTips` renders the tips corpus in `frontend/src/data/tips/`. That corpus is itself the single source of the tips — for the agent emit, generate the tips markdown *from the corpus*, do not re-author. This keeps tips single-sourced (consistent with M3's principle for structured data).
- Identify the full widget set from the code (`AISetupWidget`, `ExamplePrompts`, the tips components, and anything else the scan surfaces) rather than assuming the list above is exhaustive.

**Definition of Done**

- Widget pages render for humans; the emitted `.md` for each contains the fallback text (verified by a test asserting no widget page emits an empty/whitespace agent body and that each widget's fallback marker text is present).
- Tips agent output is generated from the corpus (a test asserting it reflects the corpus, not a hand-copied duplicate).
- `make frontend-verify` passes.

---

### Milestone 3 — Single-source tier/pricing data (resolves KAN-154 at the root)

**Goal & Outcome**

Give tier limits one canonical source that every surface derives from, eliminating the triplication that produced the FAQ bug.

- The public pricing page and the FAQ render tier numbers from a single source instead of hardcoded literals.
- The agent-readable content shows the same correct numbers from that source.
- The FAQ "how much can I store?" answer is correct — KAN-154 fixed structurally, not patched.

**Implementation Outline**

- **Canonical source stays `backend/src/core/tier_limits.py`.** Publish the *full* tier matrix for unauthenticated/public consumption — the existing `/users/me/limits` only returns the caller's own tier and requires auth, so it can't serve the public pricing page or an evaluating agent. Recommended: a public read-only endpoint returning all tiers; the implementing agent decides endpoint-vs-build-generated-artifact after reading how build/deploy is wired. **The load-bearing constraint, not the mechanism:** exactly one source of truth (`tier_limits.py`), and no hardcoded tier integers in `Pricing.tsx`, `FAQContent.tsx`, or the agent content.
- **Refactor `Pricing.tsx` and `FAQContent.tsx`** to consume the published source.
- **Feed the same source into the content emit** (M1/M2 pipeline) so tier numbers in agent docs derive from it too.
- **This supersedes KAN-152's Milestone 6 handling of the FAQ tier drift** — note that explicitly so the two plans don't both try to own it.

**Definition of Done**

- Pricing and FAQ display numbers sourced from `tier_limits.py`; changing a limit there changes every surface (human pages and agent content) with no other edits.
- A test asserts no hardcoded tier integers remain in `Pricing.tsx`/`FAQContent.tsx` (or that they equal the canonical values).
- KAN-154 is closeable.
- `make backend-verify` and `make frontend-verify` pass; if a public endpoint is added, update the deployed security tests' expectations (a new unauthenticated route) and remind the user to run them.

---

### Milestone 4 — Conventions + remaining public prose

**Goal & Outcome** (small)

Lock in the pattern so future docs are authored correctly, and extend it to any remaining public prose worth making agent-readable.

- `AGENTS.md` documents the content-as-markdown convention: new docs/FAQ prose is authored as MDX content, not embedded in TSX, and structured data is sourced from its canonical home — with a pointer to this plan.
- Optionally migrate remaining public marketing prose (`LandingPage.tsx`, `FeaturesPage.tsx`) to the same pipeline if we want it agent-readable; lower priority since the KAN-152 hub already carries the value-prop narrative.

**Implementation Outline**

- Update `AGENTS.md` "Files to Keep in Sync" / conventions to describe the content source, the agent-emit build step, and the no-hardcoded-structured-data rule.
- Migrate landing/features prose only if desired in this pass; otherwise record as a known follow-up.

**Definition of Done**

- `AGENTS.md` reflects the new authoring convention.
- Any migrated marketing prose meets the M1 bar (renders for humans, emits `.md`).

## Cross-cutting concerns

- **Drift elimination is the through-line.** Prose has one source (MDX) feeding both human and agent outputs; structured data has one source (`tier_limits.py`) feeding all surfaces. The reason this plan exists is to make these single-source by construction rather than by reminder-list discipline.
- **Boundary with KAN-152.** This plan owns the content source, the human renderer, the emitted per-page `.md` + concatenated corpus, and structured-data single-sourcing. It does **not** own the curated top-level `llms.txt` hub or the `llms-*.txt` family — those stay in KAN-152, which will be revised afterward to consume/generate from this foundation.
- **No commits until human approval at each milestone boundary.**

## Sequencing

M1 establishes the pipeline and conventions and must land first. M2 depends on M1 (it adds the component-fallback contract to the same pipeline). M3 is largely independent of M1/M2 (backend + two frontend components) but feeds its numbers into the M1/M2 emit, so it reads cleanest after M1 exists. M4 is last (conventions + optional extension). KAN-152 is revisited only after this plan completes.

## Open items (resolve during execution)

- Exact public-content `.md` URL scheme and confirmation that `frontend/public/*.md` is served at the mirrored path in production.
- Public-tier-data mechanism: endpoint vs. build-generated artifact (decide against the deploy/build code; constraint is single-source).
- Whether to generate a docs-level `llms-full.txt` concatenation in this plan or leave all `llms-*.txt` aggregation to KAN-152 (lean: emit the raw concatenation here since it's trivial; curation stays in 152).
