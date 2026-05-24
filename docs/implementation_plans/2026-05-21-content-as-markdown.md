# Content as Markdown + Data: single-source public content for humans, agents, and clients

**Date:** 2026-05-21

## Problem

tiddly.me's public content is rendered client-side from React/TSX. A plain HTTP fetch of `tiddly.me/pricing` or `tiddly.me/docs/...` returns a ~590-byte empty shell — invisible to anything without a JS engine (AI agents, and any non-web client like a future mobile app). Separately, the same facts are duplicated across surfaces and drift: tier limits live in `backend/src/core/tier_limits.py` (canonical, enforced), are hand-copied into `Pricing.tsx` and `FAQContent.tsx` (the latter currently *wrong* — KAN-154), and prose facts live inside TSX where nothing else can read them.

## What we're building

A single source for each piece of public content, consumable by humans (the SPA), agents, and other HTTP clients — **without server-side rendering**. Two content *kinds*, two mechanisms:

1. **Prose** (docs, FAQ, legal): authored as plain markdown files (the single source), rendered for humans with `react-markdown`, and served as the *same* `.md` files.
2. **Structured data** (tips, shortcuts, tier limits): lives in **canonical JSON data files** that the code *reads* — not data hardcoded in code that we generate JSON out of. The same file is served as-is.

### Decisions made in this conversation (transmit these; not recoverable from the code)

- **Serve content as static files at the web origin (`tiddly.me/...`), not from a backend content API.** Both options are just unauthenticated HTTP `GET`s that return text, so neither needs special client tooling — but static files at the web origin keep content alongside the human site, give guessable/conventional URLs, are public by default (no risk of accidentally inheriting the API's auth), and return an unambiguous format. Serving content through a backend API was considered and rejected for prose: it adds a separate host, an auth-misconfiguration failure mode, and a markdown-vs-JSON-envelope ambiguity, with no offsetting benefit — we own the requirements and markdown/JSON over HTTP is acceptable for every consumer. Record this rationale in code/commit so no one reintroduces a content API.
- **No SSR / no framework migration.** Agent/client readability comes entirely from the served `.md`/`.json`. The human SPA pages stay client-rendered and are *never* the agent-readable surface. SSR/prerender is explicitly out of scope. This is what keeps the effort bounded; record the rationale at the build step.
- **Render prose with `react-markdown`, NOT MDX.** `react-markdown` renders a markdown *string* at runtime, so the file we author is byte-identical to the file we serve — a true single source with no derived artifact. MDX compiles markdown-with-embedded-JSX into a React module, which would force a *generated*, stripped `.md` emit (the drift we're avoiding) and a new dependency we don't have. The styled helpers used across docs today (`InfoCallout`, `StepSection`) lower to plain markdown (a callout → blockquote, steps → ordered list) and are styled via `react-markdown`'s `components` map — no visual regression, still valid `.md`. Genuinely interactive widgets (`AISetupWidget`, `ExamplePrompts`) are composed as **page-level siblings** of the rendered markdown, with a markdown equivalent of their information written into the prose so the served `.md` is complete. **MDX is not a supported authoring mode.** It may be introduced for a *single page only*, as a documented exception, if the code-scan finds a genuinely *inline* interactive component that can't be expressed as markdown or composed as a sibling — and that page's `.md` is then explicitly a generated artifact. The gate: confirm during the scan whether `AISetupWidget`/`ExamplePrompts` are block-level (expected); if so, the exception is never needed.
- **Canonical data lives in data files; code reads them.** We do *not* define data as TS/Python literals and generate JSON from it. The JSON file *is* the source of truth: the frontend reads it, the backend reads it (tiers), and the same file is served. Validation that exists today as code (`validateTips` at module load; typed `TierLimits` literals) is preserved as **schema validation on load** (fail fast), not lost.
- **Honest build-step framing (not "copy, not generate").** Content `.md`/`.json` files are authored and **copied** verbatim — there's no content generation. But the build *does* produce two generated things: the per-folder `index.json` manifests, and (only if the MDX exception is ever used) that page's emitted `.md`. Name this honestly: a tested build step that copies content and generates manifests, with completeness/round-trip tests as the staleness guard. The single-source argument doesn't need a "zero generation" overclaim.
- **URL layout — two folders + manifests.** Prose under `tiddly.me/prose/`, structured data under `tiddly.me/data/`, each with an `index.json` manifest listing its files (served path, short description, and for prose the human route it mirrors). HTTP can't list a static directory, so the manifest is how an agent discovers the *set*. (`/prose` and `/data` are recommended names — "prose vs data" mirrors the two kinds; open to a better name at review. Chosen over the alternative of mirroring each human page's URL with a `.md` suffix (e.g. `tiddly.me/docs/faq.md`) because grouping the files under two folders with a manifest lets an agent discover the whole set, rather than relying on it guessing per-page URLs.)
- **Output format by kind:** whole-document prose (docs pages, legal) → `.md`; structured data (records) → `.json`. Records may carry markdown *body* fields (a tip's `body`, an FAQ entry's `answer`) rendered by the same `react-markdown` renderer. The **FAQ is structured data, not prose** — it's a list of `{question, answer}` (answer = markdown), which is exactly the shape a mobile FAQ screen or an agent wants — so it's a `.json` file, not a markdown document with a heading convention.
- **`openapi.json` is out of scope.** `api.tiddly.me/openapi.json` already serves *programmatic API clients* (frontend, MCP, CLI, mobile). It is not an agent-education artifact and this plan doesn't touch it. `DocsAPI` (the human/agent *explanation* of the API) is prose → markdown.

### Libraries (already in the stack — no new tooling)

The prose renderer is built on `react-markdown` + `remark-gfm` + `rehype-sanitize`, already in `frontend/package.json` (used today only by `TipBody`). Build the renderer against the `react-markdown` API (its `components` mapping and plugins); do **not** add MDX tooling. Vite serves the build output at the origin and imports JSON natively — that's what backs the `/prose` + `/data` serving and the tiers build-time import.

## Content inventory (full scope, classified)

**Prose → markdown (`/prose/`):** `PrivacyPolicy`, `TermsOfService`, and the docs prose pages: `DocsOverview, DocsFeaturesHub, DocsContentTypes, DocsPrompts, DocsTagsFilters, DocsSearch, DocsVersioning, DocsAIHub, DocsAIFeatures, DocsCLIHub, DocsCLIMCP, DocsCLISkills, DocsExtensionsHub, DocsExtensionsChrome, DocsExtensionsSafari, DocsKnownIssues, DocsAPI`. Lower priority (M4): `LandingPage`/`FeaturesPage`/`AIIntegration.tsx` marketing copy. *(`DocsAIFeatures` = `/docs/features/ai` — present in the router; do not omit it.)*

**Structured data → canonical JSON (`/data/`):**
- **FAQ** — canonical today: `frontend/src/components/FAQContent.tsx`, a flat list of `{question, answer}` hand-written in TSX (answers are prose). **`DocsFAQ` and `SettingsFAQ` render the exact same content** (both mount `<FAQContent/>` with no props — only the page title differs), so one `faq.json` (`[{question, answer}]`, answer = markdown) feeds both pages plus agents/mobile.
- **Tips** — canonical today: `frontend/src/data/tips/` TS objects (`Tip` shape, with a markdown `body`). `DocsTips` is a view.
- **Shortcuts** — canonical today: the registry under `frontend/src/shortcuts/`. Only the *data* subset (id → keys/description) becomes a file; behavior stays in code. `DocsShortcuts` is a view.
- **Tier limits** — canonical today: `backend/src/core/tier_limits.py` (`TIER_LIMITS`, enforced). Cross-stack: backend (enforcement) + frontend (display) + agents.

**Out of scope:** `openapi.json`; authenticated app pages (`AllContent`, `*Detail`, settings app pages).

## Shared conventions (established in M1; reused everywhere)

- **Serving + build output:** generated/copied files are emitted into the **build output** (`dist/prose`, `dist/data`), never written into source-controlled `frontend/public/` (that would dirty the working tree on every build). Provide a **dev/test serving path** so local verification doesn't require a production build: a Vite dev-server middleware that serves `/prose/*` and `/data/*` during `vite dev`, or a `predev`/`pretest` step that materializes them to a temp/cache dir.
- **Static files must win over the SPA catch-all.** This is a single-page app: unknown routes fall through to `index.html`. `/prose/*.md` and `/data/*.json` must be served as **real static files**, ahead of that fallback — otherwise an agent fetching `/prose/faq.md` gets the SPA HTML shell, not markdown. Positive precedent: `llms.txt` already serves correctly at `/llms.txt` today, so the host serves root-level static files ahead of the fallback — but **verify the same holds for subdirectory `.md`/`.json` paths** in production (the static-host/router config), since that's where this silently breaks. This is a hard requirement, not a nice-to-have; the round-trip tests (M1/M2) should assert a fetched artifact is the file, not HTML.
- **Prose rendering:** one shared `react-markdown` renderer/layout, with a `components` map: fenced code → the existing `CopyableCodeBlock`, links → router `Link`, blockquote → callout styling, ordered list → step styling. Docs page components become thin renderers of their `.md`.
- **Docs sanitize schema:** the renderer uses a **docs-specific** `rehype-sanitize` schema that allows headings and table elements. It is explicitly **not** `TipBody`'s schema, which strips `h1–h6` (so tip snippets can't inject document structure) — reusing that would silently delete the headings docs prose depends on.
- **Manifest shape:** `/prose/index.json` and `/data/index.json` are lists of entries with at least `path` (served URL) + `description`; prose entries also carry the mirrored human route. Define once, reuse for both.
- **Data validation on load:** every JSON data file is validated against a schema when read (frontend at load/test; backend at startup, fail-fast). Replaces the compile-time guarantees given up by moving literals → JSON.

## Milestones

---

### Milestone 1 — Prose pipeline: `react-markdown` + `/prose/` + manifest

**Goal & Outcome**

Stand up the markdown content pipeline and migrate the prose pages (docs, legal). This single milestone covers all prose — there is no separate "interactive prose" milestone, because the styled helpers lower to markdown and true widgets compose as siblings. (The FAQ is structured data, handled in M2, but its markdown answers reuse the renderer built here.)

- Prose docs and the legal pages live as plain `.md` files (single source); the SPA renders them via `react-markdown`, unchanged in appearance.
- Each is fetchable as plain markdown at `tiddly.me/prose/...`; `tiddly.me/prose/index.json` lists them.
- Renderer handles GFM tables/lists, fenced code with copy, internal links, callouts (blockquote), and steps (ordered list).

**Implementation Outline**

- Build the shared `react-markdown` renderer with the `components` map and the docs-specific sanitize schema (see Shared conventions). **Do not add MDX tooling.**
- Migrate page content out of TSX into `.md` files; each docs page component becomes a thin renderer. Lower `InfoCallout` → blockquote and `StepSection` → ordered list, styled via the `components` map (run the code-scan to enumerate every embedded helper/widget first — `InfoCallout`/`StepSection` are on ~11 pages; confirm the full set).
- Compose genuinely-interactive widgets (`AISetupWidget`, `ExamplePrompts`) as page-level siblings of the rendered markdown, and write a markdown equivalent of their information into the prose so the `.md` is complete. Only if the scan finds an *inline* widget that can't be a sibling or markdown, apply the documented single-page MDX exception (and mark that `.md` generated).
- Build step copies `.md` into `dist/prose/` and generates `/prose/index.json`; wire the dev/test serving path. Confirm production serves these paths (today `public/llms.txt` → `/llms.txt`).
- Keep `docsRoutes.tsx` accurate. Don't touch tier numbers (M3) or the curated top-level `llms.txt` hub (KAN-152 owns it).

**Definition of Done**

- Migrated prose renders identically for humans and is fetchable as `.md`; `/prose/index.json` resolves.
- **Completeness test driven from `DOCS_ROUTES` + an explicit public/legal page list** (not `App.tsx` router introspection): every entry has a `.md` artifact + manifest entry, with explicit exclusions for the structured-data views (`DocsFAQ`/`SettingsFAQ`, `DocsTips`, `DocsShortcuts` — these come from `/data/*.json`, not `/prose/`) and authenticated app pages.
- Round-trip test: each served `.md` equals its authored source (copy path); representative content strings present; a heading-bearing doc keeps its headings (guards the sanitize schema).
- `make frontend-verify` passes; rationale ("no SSR; react-markdown not MDX; readability via served files") recorded at the renderer/build step.

---

### Milestone 2 — Structured data as canonical JSON: FAQ, tips, shortcuts under `/data/`

**Goal & Outcome**

Move frontend-owned structured data to canonical JSON files the code reads, served for agents/clients.

- The FAQ, known issues, tips, and the shortcut data subset live in canonical JSON; the SPA reads them (the FAQ pages, known-issues/tips/shortcuts pages, and in-app consumers render from the same files).
- Fetchable at `tiddly.me/data/faq.json`, `tiddly.me/data/known-issues.json`, `tiddly.me/data/tips.json`, `tiddly.me/data/shortcuts.json`; `tiddly.me/data/index.json` lists them.
- Validation previously in code (`validateTips`, etc.) runs against the JSON on load/test.
- Docs prose shortcuts render OS-correctly (Mac vs Windows/Linux) and are single-sourced from `shortcuts.json` (see the shortcut-token task below).

**Implementation Outline**

- **FAQ:** extract `FAQContent.tsx`'s items into `faq.json` as `[{question, answer}]` with `answer` authored as **markdown** (the current TSX answers use `<strong>`, paragraphs, lists — all expressible in markdown). Replace `FAQContent` with a thin component that maps each entry to the collapsible item and renders `answer` via the M1 `react-markdown` renderer. Since `DocsFAQ` and `SettingsFAQ` both mount `FAQContent`, both pick this up with no per-page change.
- **Known issues:** `DocsKnownIssues` is structured records (`[{title, status, body}]`, `status ∈ {expected-behavior, bug, limitation}`, `body` = markdown), not prose — reclassified from M1 to here during M1 execution. Extract into `known-issues.json`; `DocsKnownIssues` becomes a thin view that renders the status badge + the `body` via the M1 `react-markdown` renderer.
- **Tips / shortcuts:** convert the tips corpus and shortcut data subset from TS literals to canonical JSON; consumers read from them (Vite JSON import or runtime fetch — agent's choice against the code). Behavior/selectors/handlers stay in code, now operating on loaded data; relocate `validateTips`-style checks to schema validation on load (+ test). For shortcuts, only the data (id/keys/description) moves; runtime behavior stays in code and references it.
- **Docs-prose shortcut tokens (OS-correctness):** M1 left docs-prose shortcuts as hardcoded literal text (e.g. `` `Cmd+V` ``), matching the original TSX — so Windows/Linux users see Mac modifiers. Now that `shortcuts.json` exists: (1) extend the shared `DocsMarkdown` renderer to resolve `` `{{shortcut:<id>}}` `` inline tokens to an OS-localized `<Kbd>` chip (via `formatShortcut`), **consolidating the mechanism `TipBody` currently implements on its own copy** — one shared resolver, not two; (2) sweep the M1-migrated docs `.md` files, replacing hardcoded shortcut text with `{{shortcut:<id>}}` tokens so docs are OS-correct and single-sourced from `shortcuts.json`. The served `.md` carries the token; an agent resolves it against `shortcuts.json`.
- Build step copies the JSON into `dist/data/` and generates `/data/index.json` (reuse M1's manifest shape + dev/test serving).

**Definition of Done**

- FAQ/known-issues/tips/shortcuts pages and in-app consumers render from the JSON; `/data/faq.json|known-issues.json|tips.json|shortcuts.json` and `/data/index.json` resolve.
- Docs-prose shortcuts render OS-localized via shared `{{shortcut:<id>}}` tokens; `TipBody` and `DocsMarkdown` use one shared resolver (no duplicated shortcut logic); a test asserts a docs `.md` shortcut token renders the right keys per platform.
- Tests: schema validation rejects malformed data; files load into expected shapes; the FAQ and known-issues render the same content as before (nothing lost in the TSX→JSON move); existing tips/shortcuts UI tests pass against file-sourced data.
- `make frontend-verify` passes.

---

### Milestone 3 — Tiers as a cross-stack shared data file (resolves KAN-154 at the root)

**Goal & Outcome**

Make tier limits a single file read by backend enforcement, frontend display, and agents — eliminating the triplication behind the FAQ bug.

- One canonical `tiers.json` is the source of truth: backend reads it at startup for enforcement; `Pricing.tsx`/FAQ render from it; agents fetch the served copy.
- The FAQ storage-limits answer is correct and sourced — KAN-154 fixed structurally.
- Changing one file changes every surface, with no loading spinner on the pricing page.

**Implementation Outline**

- **Canonical location: `frontend/src/data/tiers.json`.** It must live inside `frontend/` because the frontend's deploy build context is `/frontend` — a repo-root/`shared/` file would be outside that context and unreachable for the frontend's build-time import and serving. **Document loudly in the file/code that it is cross-stack-owned** (backend enforcement depends on it) despite its location, so a future frontend cleanup doesn't move/delete it and silently break enforcement; the backend's fail-fast startup load is the tripwire.
- **Frontend consumes via build-time import** (Vite JSON import), not runtime fetch — so Pricing/FAQ render synchronously with no loading state or error path. Build copies the file into `dist/data/tiers.json` and adds it to `/data/index.json`.
- **Backend** loads `tiers.json` at startup and constructs the existing `TIER_LIMITS: dict[Tier, TierLimits]` from it, validating fail-fast. Contained change: `TierLimits` is a frozen dataclass and consumers go through `get_tier_limits()`, so only the *source* of values moves. `Dockerfile.api`'s context is the repo root, so it `COPY`s `frontend/src/data/tiers.json` into the image (packaging, not generation) — startup fails fast if absent.
- **Full `TierLimits` in the file, not a subset.** `tiers.json` holds the *complete* per-tier limits (item caps, content lengths, PATs, field lengths, rate limits, AI limits, relationships, history retention) — it's all structured data and belongs in one source; serving it publicly is fine (the repo is public). The backend constructs `TIER_LIMITS` for free/standard/pro entirely from the file. Field-length values (identical across tiers today) are repeated per tier for self-containment, with a test asserting they stay equal across product tiers (preserves the "structural, same across tiers" invariant). Load-time validation (fail-fast) replaces the dataclass's compile-time construction check, same pattern as `shortcuts.json`.
- **Enforced values are the arbiter.** Seed `tiers.json` from `tier_limits.py`'s actual `TIER_LIMITS` values (read them — do not assume any display surface is canonical; Free is 10/10/5).
- **"Unlimited" is display, not enforcement.** `Pricing.tsx` shows Pro item caps as "Unlimited" while the backend enforces a finite anti-abuse ceiling (today 10,000). `tiers.json` stores the enforced integer **plus a per-tier `unlimitedItems` flag** (set on Pro); Pricing renders "Unlimited" when the flag is set, the backend ignores it and enforces the integer. (The 10,000 ceiling is a value the engineer can bump in the file; not changed here.)
- **`Pricing.tsx` is the single display surface that renders numbers; the FAQ points to it.** FAQ answers are static markdown (M2) and can't template tier data, so the FAQ content-limits answer (currently wrong: 100/100/100 in `faq.json`) is reworded to drop the numbers and link to Pricing — KAN-154 fixed by removing the drift, not by re-templating the FAQ. Pricing renders the comparison table + cards (including the "Version history retention" row) from `tiers.json`.
- **Public file excludes the `DEV` tier.** `tiers.json` holds product tiers only (free/standard/pro). `Tier.DEV` stays a code constant (runtime-only, resolved under `dev_mode`) — it is never in the file and never served.
- **Deferred drift surfaces (pick up later).** Two other places still hardcode tier numbers and are intentionally out of M3 scope; the `tier_limits.py` sync comment is updated to name `tiers.json` as the source and point at these: (1) `LandingPage.tsx`'s "How much does Tiddly cost?" copy → **M4** (marketing prose); (2) `frontend/public/llms.txt` Tier Limits section → **KAN-152** (agent-empowerment). Each should be rewired to read/derive from `tiers.json` when its milestone runs.
- Record that this **supersedes KAN-152's Milestone 6** FAQ-tier handling, so the two plans don't both own it.

**Definition of Done**

- The display==enforcement guarantee is **by construction**: frontend imports and backend `COPY`s+loads the *same* `frontend/src/data/tiers.json`, so they cannot diverge. Tests are two independent file-pinned assertions — (1) frontend display equals the JSON; (2) backend enforcement equals the JSON — **not** a cross-stack frontend-reaches-into-backend comparison.
- A test asserts no hardcoded tier integers remain in `Pricing.tsx`/`FAQContent.tsx` (values come from the import); a test asserts the served `tiers.json` excludes `dev`; backend startup-validation fails fast on malformed/missing data; existing tier tests pass against file-sourced values.
- KAN-154 closeable. `make backend-verify` + `make frontend-verify` pass.
- **Deploy + docs:** `Dockerfile.api` updated to `COPY` the file; **update `README_DEPLOY.md`** (the backend now has a build-time cross-stack file dependency and won't boot without it) and **`docs/architecture.md`** (tier limits are now loaded from a file, not Python literals). This milestone publishes new *public* static files (`/data/*.json`); sanity-check they expose nothing sensitive (DEV excluded above; FAQ/tips are public content) — no auth boundary changes, so the deployed penetration tests don't need new cases, but confirm the new paths return the file, not the SPA shell.

---

### Milestone 4 — Conventions, manifest wrap-up, and remaining prose

**Goal & Outcome** (small)

Lock in the model and close gaps.

- `AGENTS.md` and `docs/architecture.md` document the model: prose as markdown under the content source (not TSX), structured data as canonical JSON read by code (not hardcoded), the `/prose` + `/data` + manifest + `dist/` serving convention (static-files-before-SPA-fallback), react-markdown-not-MDX, and no SSR.
- Both manifests complete; optionally migrate marketing prose (`LandingPage`/`FeaturesPage`/`AIIntegration`) using the M1 pattern (lower priority — designed layouts; agent value largely covered by the KAN-152 hub).

**Implementation Outline**

- Update `AGENTS.md` "Files to Keep in Sync"/conventions and `docs/architecture.md` (the content-serving shape) with the model + a pointer to this plan. Verify both manifests list everything published. Migrate marketing prose only if desired this pass; else record as a follow-up.
- **Carryover from M3:** `LandingPage.tsx`'s "How much does Tiddly cost?" copy still hardcodes tier numbers. When migrating it, source the numbers from `tiers.json` (build-time import) rather than re-hardcoding, so it doesn't reintroduce the KAN-154 drift M3 closed. (`llms.txt`'s Tier Limits section is the parallel carryover owned by KAN-152.)

**Definition of Done**

- `AGENTS.md` and `docs/architecture.md` reflect the model; manifests complete; any migrated marketing prose meets the M1 bar; `make frontend-verify` passes.

---

### Milestone 5 — Deployment & rollout checklist (Railway)

**Goal & Outcome**

A clear operator runbook for shipping this branch — what's verified before merge, and the exact manual Railway actions + production checks after merge. **This milestone is the canonical home for the one-off rollout steps** (they don't belong in `README_DEPLOY.md`, which documents from-scratch deploys). The *permanent* config those steps establish — `tiers.json` in the `Dockerfile.api` services' watch paths, and the cross-stack dependency note — already lives in `README_DEPLOY.md`'s setup so a future from-scratch deploy gets it.

This branch introduces a **build-time cross-stack file dependency** (the backend reads `frontend/src/content/data/tiers.json` at startup) and **new public static paths** (`/prose/*.md`, `/data/*.json`). The tiers dependency is the one needing an operator action (a watch-path change); the static paths are already handled by the frontend's Caddy config and just warrant a post-deploy confirmation.

**Pre-merge (in-repo / CI — no Railway action)**

- `make backend-verify` and `make frontend-verify` pass.
- `npm run build` (or `make frontend-build`) emits `dist/prose/*.md`, `dist/data/*.json`, and both `index.json` manifests.
- No new env vars, no DB migration, no Makefile change required (the content pipeline rides the Vite build; the backend resolves `tiers.json` via a repo-relative path that also works in `make api-run` and CI).

**Post-merge (Railway dashboard — manual operator actions)**

1. **Watch paths.** On all four `Dockerfile.api` services (`api`, `ai-usage-flush`, `cleanup`, `orphan-relationships`), add `frontend/src/content/data/tiers.json` to **Settings → Build → Watch Paths**. Without it, editing a tier limit alone won't trigger a backend redeploy, so enforcement would lag the published Pricing page. (`Dockerfile.api` `COPY`s the file into every backend image regardless, so booting isn't affected — this is purely about auto-redeploy on tiers-only edits.)
2. **Deploy + boot check.** Deploy the API (and crons). They **fail fast on boot if `tiers.json` is missing**; confirm the API comes up healthy (the `COPY` ensures the file is present).
3. **Confirm production static serving (expected to pass — final belt-and-suspenders check).** The frontend's Caddy config (`frontend/Caddyfile`) serves via `try_files {path} {path}.html {path}/index.html /index.html` — it serves an existing file first and only falls back to the SPA `index.html` for non-file routes. So `/data/*.json` and `/prose/*.md` (both emitted into `dist/`) are served as real files; this is the same mechanism that already serves `llms.txt`. As a final check, `curl` `https://tiddly.me/data/tiers.json`, `/data/index.json`, `/prose/<page>.md`, `/prose/index.json` and confirm each returns the **file** (correct `Content-Type`), not `index.html`. This is no longer an unknown — verified locally via `vite preview` and confirmed by the Caddyfile; if it somehow failed it would be a Caddy `root`/`{{.DIST_DIR}}` misconfig (the `dist/` root that already serves `llms.txt`), not a missing route. **Discovery is via the `index.json` manifests, not directory listing** — agents fetch `/data/index.json` and `/prose/index.json` (directory autoindex is intentionally not enabled).
4. **Sanity-check the data.** Served `/data/tiers.json` excludes the `dev` tier and shows the correct product-tier numbers; the Pricing page renders them.

**Definition of Done**

- API + crons boot with `tiers.json` present; the four services' watch paths include it.
- `/data/*` and `/prose/*` confirmed serving as files (not the SPA shell) in production.
- `README_DEPLOY.md`'s from-scratch setup carries the permanent config (watch paths + the cross-stack dependency note); the one-off rollout steps stay in this milestone.

## Cross-cutting concerns

- **Single-source by construction, not by reminder.** Prose has one source (the `.md`, rendered *and* served) and structured data has one source (the JSON file, read by all consumers). This replaces the "keep N copies in sync" discipline that produced KAN-154. The only generated artifacts are the manifests (and any MDX-exception emit), guarded by tests.
- **Boundary with KAN-152.** This plan publishes content (`/prose/*.md`, `/data/*.json`, manifests). It does not own the curated `llms.txt` hub or the `llms-*.txt` family — KAN-152 is revisited afterward to link to / generate from this foundation.
- **No commits until human approval at each milestone boundary.**

## Sequencing

M1 establishes the prose pipeline, the serving/`dist` convention, the sanitize schema, and the manifest shape; it lands first. M2 establishes the structured-data/`/data/` convention (reusing M1's manifest + serving). M3 depends on M2's `/data/` convention and additionally touches the backend + deploy. M4 is the docs/conventions wrap-up. M5 is the deployment checklist — its post-merge Railway actions run when the branch ships. KAN-152 is revisited only after this plan completes.

## Open items (resolve during execution)

- Final folder names (`/prose`, `/data`) and exact prose URL nesting (mirror `/docs` under `/prose`?) — decide at M1; the manifest makes the scheme non-critical for discovery.
- Whether tips/shortcuts (M2) are read via build-time import or runtime fetch — agent's call against the code (tiers is decided: build-time import).
- Whether the top-level `llms.txt` links to the manifests now or leaves all `llms-*` aggregation to KAN-152 (lean: ship the manifests here; KAN-152 wires the hub).
