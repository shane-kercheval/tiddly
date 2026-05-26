# Agent Empowerment: educating users and AI agents about Tiddly

**Ticket:** [KAN-152](https://tiddly.atlassian.net/browse/KAN-152)
**Date:** 2026-05-21
**Status:** Active — [`2026-05-21-content-as-markdown.md`](./2026-05-21-content-as-markdown.md) has merged; reconciled against it below. Resuming at Milestone 1.

> **Reconciled with content-as-markdown (merged 2026-05-24).** That refactor made tiddly's public content agent-readable and single-sourced the structured data, changing several assumptions this plan was written under. The points below are **authoritative over any conflicting wording in the milestones/appendix that follow**:
> 1. **Agents can now read `/docs` and `/pricing` content** — served as `/prose/*.md` and `/data/*.json`, each with an `index.json` manifest. This makes the plan's "prefer linking over inlining for code-derived facts" principle *strictly* better than inlining (an agent can fetch the target), so lean harder on linking.
> 2. **Tier numbers link the machine-readable canonical `/data/tiers.json`** (the file the backend itself reads at startup), with `/pricing` as the human page — supersedes the earlier "link `/pricing`" wording (A.2/A.5).
> 3. **Cross-references target the agent-readable artifacts, not the SPA routes:** `/prose/<page>.md`, `/data/known-issues.json`, `/data/tips.json`, `/data/faq.json`, `/data/shortcuts.json`.
> 4. **`llms.txt`'s "Agent resources" index points at the new manifests** (`/prose/index.json`, `/data/index.json`). Relationship: content-as-markdown provides *machine discovery* (manifests + raw files); this plan adds *curated narrative + mode routing* (the `llms.txt` family). Complementary, not redundant.
> 5. **Milestone 6's seed finding is already resolved** — content-as-markdown M3 fixed the FAQ tier-limit drift (KAN-154, now closeable) and single-sourced tiers. M6 collapses to a ledger for *new* inconsistencies surfaced during M1–M5 (see M6).
> 6. **Public content now lives in `frontend/src/content/prose/*.md` + `content/data/*.json`** (the `Docs*.tsx` pages are thin renderers) — M1 authoring and M0's "mine existing sources" target those, not the TSX pages.
>
> **In-progress artifact:** `frontend/public/llms.txt` was rewritten as the hub during M1 on this branch (committed as work-in-progress). It was drafted under the pre-refactor assumptions (e.g. links `/pricing`, which an agent then couldn't read) and is **redone fresh in M1** against the reconciliation above — do not treat it as final.

## Summary

Give AI agents the knowledge they need to (a) **evaluate and explain** Tiddly to people still deciding whether to use it, and (b) **guide users through using and integrating** Tiddly once they've adopted it. The vehicle is a *family* of agent-facing text artifacts (`llms.txt` plus purpose-specific `llms-*.txt` files), surfaced through the landing page, the CLI, and other in-app/docs surfaces.

A key realization shaped this plan: we cannot specify the build work up front because we don't yet know the right *set* of artifacts. So the first milestone is a substantive research/ideation step that defines the artifact family; the later build milestones are intentionally provisional and get fleshed out at a re-planning checkpoint after that.

Ship as **one PR**, organized into the milestones below. Each milestone is a stop-and-review checkpoint; do not commit until the human approves.

## Guiding thesis (read before any milestone)

Landing-page and first-touch visitors are in **learning/evaluation mode**, not integration mode. They (and their agents) are asking *"what is Tiddly, why use it, how does it compare?"* — not *"how do I set it up?"* Users who have already decided are in **integration mode**: they integrate their notes/prompts/bookmarks with AI. These are different audiences with different needs, and one document cannot serve both well.

Rather than force everything into one or two files, we treat agent empowerment as a **family of artifacts**, each with a distinct job and consumer. An illustrative (not final — Milestone 0 decides the real set) sketch:

- `llms.txt` — the hub: what an AI needs to know about Tiddly (value prop, use cases, high-level concepts), plus an **index/links to the other artifacts and to docs**. This is the single entry point.
- `llms-app-usage.txt` — how an AI should guide a user in using the app; points to docs rather than duplicating them.
- `llms-integration.txt` — context an AI needs to guide a user through integration (MCP, skills, API).
- `llms-cli-instructions.txt` — CLI-specific instructions. The CLI is **one consumer** of this artifact, not its identity.

### Hard principles for the artifact family

These are guardrails Milestone 0 must enforce, and they must survive into the artifacts themselves (state them in `AGENTS.md` and in each file's header):

1. **No restatement of generic information.** Shared facts — tiers, pricing, value prop, core concepts — live **once**, in `llms.txt`. Subfiles do **not** restate them; they cross-reference. A subfile only goes deep on a subject when *that subject is the file's job*. This is the primary anti-drift mechanism: a family of files that each partially restate the same facts will rot.
2. **Every artifact earns its existence** with a *distinct consumer and a distinct job* — not merely a distinct topic. Before committing to a file, confirm there is a real consumer for it.
3. **`llms.txt` is the hub/index.** An agent has one entry point and the family stays navigable. (This is the genuinely useful part of the llmstxt.org link-index idea — applied to our own purpose-built artifacts, not to scattered marketing pages.)

### Why on-demand artifacts, not installable skills

For *agent-empowerment instructions* (how to use/integrate Tiddly), we deliberately use on-demand text artifacts and a CLI command rather than installable agent skills. (This is distinct from Tiddly's prompts-as-skills *export* feature, which is a product capability and unaffected.) The reasoning:

- **Skills go stale.** A skill lives as a local copy on the user's machine. To update it the user must reinstall; if they don't, the instructions silently drift out of date — exactly the failure mode we're trying to avoid. This is the most important point: a hosted artifact is always current, and our CLI command fetches the latest text on every call rather than shipping a frozen copy.
- **Install footprint is ambiguous and sticky.** Where does a skill get installed — across all of a user's tools/configs? How do they uninstall it when they're done? Empowerment instructions for an occasional task shouldn't leave residue.
- **Skill/MCP proliferation degrades agents.** The more skills and MCP servers installed, the worse an agent gets at selecting among them. Adding ours to that pile makes every agent slightly worse, including for unrelated work.
- **The work is occasional, but skills are always-on.** Setting up an integration is a one-time/occasional task. An installed skill keeps surfacing (e.g. in suggestions when invoking unrelated personal skills) long after the work is done.

On-demand artifacts avoid all of this: zero install, nothing to uninstall, always current (no stale local copy), discovered exactly when needed (`llms.txt` for evaluation; `tiddly ai-instructions` / the hosted files for integration), and no standing contribution to skill/tool clutter.

### What "optimized for an agent" means (writing philosophy)

All copy work is anchored to this. It is **not** the bite-size, clickbait, conversion-optimized prose of marketing pages, and `llms.txt` itself is **not** a bare link index that forces an agent to fetch a dozen unrelated pages to assemble basic understanding. It is:

- **Self-contained and narrative where it counts.** `llms.txt` should let an agent explain what Tiddly is, the fundamental concepts, and how to get started from the document itself. Links supplement; they don't substitute for core understanding.
- **Informative without being verbose.** Dense with the facts an agent needs to reason and answer questions; free of filler, hype, and repetition.
- **Honest.** Includes "who this is *not* for" / trade-offs where relevant, so an agent can give a balanced evaluation rather than a sales pitch.

We keep llmstxt.org's structural conventions (H1 title, blockquote summary, sectioned content; **read <https://llmstxt.org/> before editing**) while consciously rejecting the minimal-link-index interpretation for content that should be taught directly.

## Milestones

---

### Milestone 0 — Concept categorization & artifact-family definition (research/ideation; the substantive milestone)

**Goal & Outcome**

Define *what* we are building before building it. Enumerate everything worth communicating to an agent, decide which artifacts should exist and what each is for, and establish the navigation and anti-drift rules. Everything downstream derives from this; the build milestones are deliberately under-specified until it lands.

Outcomes (the deliverable, reviewed with the human):
- A categorized inventory of every concept/topic worth communicating to an agent (value prop, differentiators, comparisons, the three content types, tags/filters/collections/relationships, prompts & Jinja2, search, versioning, MCP both servers, CLI, skills export, Chrome extension, API/PATs, tiers/pricing/limits, privacy, common dashboard URLs, getting-started flows, etc.), each tagged by which job it serves (evaluation / app-usage / integration / CLI / …).
- The **justified artifact set**: for each proposed `llms-*.txt`, its name, its single consumer/audience, and its high-level objective — with each artifact tested against the "earns its existence" guardrail.
- The **index/discoverability strategy**: how `llms.txt` points to the others, and how non-web consumers (e.g. the CLI) reach their artifact.
- The **division-of-labor + anti-drift philosophy** written as text to be referenced/partly copied into `AGENTS.md` and each artifact's header (the hard principles above, made concrete for the chosen set).

**Implementation Outline**

- Mine existing sources rather than inventing: current `frontend/public/llms.txt` (already strong and comprehensive — a good raw inventory), the docs under `frontend/src/pages/docs/` (esp. `DocsAIHub`, `DocsCLIMCP`, `DocsCLISkills`, `DocsAPI`, `DocsContentTypes`, `DocsPrompts`, `DocsAIFeatures`), `AGENTS.md`, and `docs/architecture.md`.
- Produce the deliverable above as a reviewed document. No code.
- The single-vs-multiple-file structure for evaluation content (e.g. whether an `llms-full.txt` is warranted) is **subsumed into the artifact-set decision** here — do not decide it separately or earlier.

**Definition of Done**
- Inventory + artifact set + index strategy + philosophy reviewed and approved by the human. No tests (non-code milestone). **This milestone gates all build work, and triggers the re-planning checkpoint below.**

---

### Re-planning checkpoint (after M0, before M1)

Once the artifact set is approved, revisit and detail Milestones 1–4 against it: which files get written (M1), what the CLI fetches and the landing prompt points at (M2/M3), and which surfaces host which artifact (M4). The provisional outlines below capture only the decisions already fixed; treat them as scaffolding to be firmed up here.

**Automated content validation — deliberately declined at beta scale.** A broader cross-surface validation layer (asserting public files exist, `llms.txt` links resolve, command/tool names in artifacts exist in code) was considered and rejected: the cheap checks guard plumbing, not the content currency that actually drifts (the FAQ failure mode), and the name-existence checks that *would* catch drift are partial and not worth the cost here. The genuinely useful checks aren't a "layer" — they're ordinary per-milestone tests already in scope (the M2 fetch-URL test; testing M5's pointer wiring). Drift is instead handled by the canonical-source headers (see M1) plus the M6 reconciliation pass. Recorded as a conscious choice, not an oversight.

---

### Milestone 1 — Author the artifact family *(provisional — detail after M0)*

**Goal & Outcome**

Write/refine the `llms-*.txt` files defined in M0, per the writing philosophy and hard principles. An evaluation-mode agent reading `llms.txt` can explain and honestly pitch Tiddly without mandatory link-chasing; each subfile serves its one job without restating generic information.

**Fixed decisions (carry into the detailed plan):**
- `llms.txt` **keeps its value prop, concepts, use-cases, and a pricing *summary*, gains the hub/index, and sheds the rest.** This is not a light touch-up: roughly half the current 320-line file relocates under the no-restatement rule — the MCP/integration section (~lines 77–222) → `llms-integration.txt`, keyboard shortcuts (~226–254) → `llms-app-usage.txt`, and the exhaustive tier table (~271–302) → a summary + `/pricing` link. The opening value prop is reused; the body is substantially restructured. Say so to the implementer so the diff target is unambiguous and integration content doesn't end up duplicated in both files.
- Subfiles obey the no-restatement principle and cross-reference `llms.txt`/docs.
- **Code-derived facts name their canonical source in the artifact header.** The AGENTS.md "Files to Keep in Sync" convention is *not* sufficient on its own — it already lists `FAQContent.tsx` and that file still drifted (see findings doc / M6). So for any inlined fact that derives from code (command names, MCP tool names, tier numbers, URLs, the 403 surfaces), the artifact's header states where it must agree with (e.g. "command list mirrors `cli/cmd/`; tier numbers: `/data/tiers.json`"). This gives a reviewer an explicit diff target. Prefer linking over inlining for code-derived facts wherever possible — and post-content-as-markdown the link targets are themselves agent-readable (`/data/*.json`, `/prose/*.md`), so a linked fact is now genuinely fetchable rather than a dead-end SPA route; reserve inlining for facts an agent must have without a fetch. Appendix A's inventory tags each fact code-derived vs. narrative to make this concrete.
- **`llms-app-usage.txt` is orientation, not a tips dump.** It is the higher-level "map" of how the app is structured and how to accomplish core tasks (organize, search, filter, edit) plus the gotchas to warn users about. It cross-references the tips corpus wholesale — the agent-readable `/data/tips.json` (human page `/docs/tips`) — and may deep-link a small handful of high-value tips where one is load-bearing for a core workflow, but it does **not** reproduce the corpus (tips remain the authoritative home for granular tips). Likewise its known-issues awareness cross-references `/data/known-issues.json`.
- All files are static assets served from `frontend/public/`.
- Exact copy for every file is finalized *within this milestone* (reviewed with the human), not pre-specified.

**Definition of Done** *(to be detailed after M0)*
- Each artifact reviewed and approved against the M0 inventory and philosophy.
- `AGENTS.md` "Files to Keep in Sync" updated to list the artifact family and the anti-drift principle. No automated tests (static content); validation is human review.

---

### Milestone 2 — `tiddly ai-instructions` CLI command *(provisional — detail after M0)*

**Goal & Outcome**

A CLI consumer of the integration/CLI artifact: an integration-mode agent working in a user's environment can discover and read Tiddly's CLI instructions through the CLI, and we can update that text without shipping a new binary.

**Fixed decisions (carry into the detailed plan):**
- The command **fetches a hosted artifact** (the M0-named CLI file, e.g. `llms-cli-instructions.txt`) so copy updates don't require a CLI release. The CLI is just one consumer of that file.
- **No auth required** — must work before `tiddly login` so an agent can call it immediately; do not resolve credentials or hit the authenticated API.
- **Graceful offline degradation:** ships a *minimal* embedded fallback (via `go:embed`), prefers the live URL with a short timeout, and on any fetch failure prints the fallback (which points at the URL) and **still exits 0 with usable content**, plus a one-line stderr note. The embedded fallback is intentionally minimal so its drift cost is low — comment this rationale at the embed site.
- New command file in `cli/cmd/`, registered in `cli/cmd/root.go`; model on simple text-output commands (`logout.go`, `auth status.go`).
- **A new web-origin constant is required, distinct from `DefaultAPIURL`.** The CLI's only base URL today is `DefaultAPIURL = "https://api.tiddly.me"` (`cli/internal/config/config.go`) — the *API* host. The hosted artifacts are static frontend assets served from the *web* origin (`https://tiddly.me/...`). Reusing `DefaultAPIURL` would 404 and silently serve the embedded fallback on every call. Add a `tiddly.me` web-origin constant; **confirm the production serving path for `frontend/public/*.txt` before hardcoding.**
- **Skip `PersistentPreRunE` side effects.** `cli/cmd/root.go` runs config/keyring init and starts a background update check in `PersistentPreRunE`, with an existing early-return skip set for `completion`/`help` (root.go:63). Add `ai-instructions` to that skip set so the command does no dep init and no update-check network call — its only side effect is the instruction fetch (+ fallback).
- **`--help` advertises it as the command an agent should call first** (per the ticket's example wording).
- **Subcommands deferred** (single command prints the full hosted doc); note the deferral in a doc comment.

**Definition of Done** *(to be detailed after M0)*
- Implemented + registered; `make cli-verify` passes.
- Go tests: success path (mock 200 → prints body), failure path (mock error/non-200/timeout → prints fallback, exits 0, stderr note), `--help` contains the agent-first-call guidance, default fetch URL equals `https://tiddly.me/llms-cli-instructions.txt`, and the command runs with **no stored credentials and no update-check network call** (only the instruction fetch path).
- Docs: `frontend/src/pages/docs/DocsCLIReference.tsx` + CLI hub; `frontend/src/data/docsRoutes.tsx` searchText; `AGENTS.md` CLI command list + artifact in sync list; `docs/architecture.md` CLI section.

---

### Milestone 3 — Landing-page evaluation CTA *(provisional — detail after M0)*

**Goal & Outcome**

A Clerk-style button + popover on the landing page gives a visitor a ready-to-paste **evaluation** prompt that arms their agent to research and explain Tiddly, pointing the agent at `llms.txt`.

**Fixed decisions (carry into the detailed plan):**
- Clerk-style button → popover/dialog with a short explanation of the prompt's purpose, the (scrollable) prompt text, and a copy button.
- **Single prompt, evaluation-oriented** (we have no skills to install, so no second tab). The prompt references the hub artifact (`llms.txt`) as the agent's authoritative source.
- Reuse existing copy components (`CopyableCodeBlock`, `CopyToClipboardButton`) — no new clipboard plumbing.
- Build the popover/prompt-card as a **reusable component** (explanation + prompt text as props) so Milestone 4 can reuse it.
- Placement and button/section label (the "connect" vs other phrasing on `LandingPage.tsx`) and the exact prompt copy are finalized *within this milestone*.

**Definition of Done** *(to be detailed after M0)*
- CTA + prompt reviewed and approved; `make frontend-verify` passes; light component test for the copy interaction if not already covered.

---

### Milestone 4 — Additional empowerment surfaces *(provisional — detail after M0)*

**Goal & Outcome**

Identify and populate other surfaces where an evaluation- or integration-oriented agent-empowerment component belongs, reusing the Milestone 3 component and pointing each at the appropriate artifact.

**Fixed decisions (carry into the detailed plan):**
- **Discovery is part of the milestone** — survey candidates (app sidebar, Settings → AI Integration at `/app/settings/ai-integration`, docs AI hub `DocsAIHub.tsx`, the `AISetupWidget` area), present recommendations, implement only approved placements.
- Public/first-touch surfaces get evaluation framing (point at `llms.txt`); in-app surfaces for adopted users get integration framing (point at the integration/CLI artifacts).
- Update palette discoverability (`frontend/src/data/settingsRoutes.tsx` / `docsRoutes.tsx`) for new findable surfaces.

**Definition of Done** *(to be detailed after M0)*
- Candidate list reviewed; approved placements implemented; `make frontend-verify` passes; relevant sync-list docs updated.

### Milestone 5 — MCP hosted depth (additive, hypothesis-gated) *(provisional — detail after M0)*

**Goal & Outcome**

Where the MCP server/tool descriptions can be *meaningfully improved*, an agent is pointed to a richer hosted artifact (`llms-mcp-content.txt` / `llms-mcp-prompts.txt`) with additional high-value clarifications, workflows, and examples. The MCP server instructions and per-tool descriptions are the **first thing an agent reads** when choosing which server/tool to use, and they're always in-context — a high-leverage discovery path the landing page and CLI can't serve (an MCP-connected agent may never see either).

**This milestone is strictly additive and the hosted files are hypotheses, not commitments.** Two hard constraints drive that:
- **Never subtract from `instructions.md` or tool descriptions.** A single-response, one-shot tool-calling LLM (exactly what our evals exercise) *cannot* fetch-then-act within one turn, so anything essential to correct tool selection/use must remain inline regardless of agent capability. We removed the earlier "keep it lean" motivation entirely — it was the only thing that created downside.
- **Create a hosted file only if it earns it.** The bet is that we can write guidance *beyond* what's already inline. If, when drafting, `instructions.md` already says enough, **we do not create the file** — no file for symmetry's sake. This is the "earns its existence" guardrail applied at authoring time.

**Fixed decisions (carry into the detailed plan):**
- Hosted MCP files are **conditional**: authored only where they add meaningful, optional depth beyond the existing inline descriptions. The MCP pair may end up as zero, one, or two files.
- Any depth added is **purely additive** — `instructions.md` and tool descriptions are only ever extended, never trimmed.
- If a hosted file is created, its pointer goes in **both** the server `instructions.md` **and** the relevant individual tool descriptions, so a multi-step agent finds it from wherever it's looking. Essential guidance still lives inline for single-shot agents.
- Hosted content is tool-usage workflows/examples — **not** restated tool schemas or concepts (cross-reference `llms.txt`).
- The exact copy and the decision to create each file are finalized *within this milestone*.

**Decision (executed):** **Both hosted MCP files were consciously skipped — inline guidance suffices.** A full audit of both servers' `instructions.md` and per-tool descriptions (and the evals that exercise them) found the inline guidance already strong: the content server's `instructions.md` carries 10 worked workflows, full FTS-operator docs, optimistic-locking and full-replacement semantics, and the content-vs-item distinction; both servers' `edit_*`/`update_*` tool descriptions richly cover tool selection, atomic argument coordination, and omit-to-preserve. The candidate "depth" topics were either already inline (search operators, size-assessment, edit error-recovery) or speculative best-practice (tag hierarchies, multi-agent concurrency, Jinja2 deep-dives) that fail the "earns it" gate. Crucially, because single-shot agents can't fetch-then-act, any genuinely useful guidance is better added **inline** (helps every agent) than in a fetch-only hosted file — so a hosted file's audience is strictly smaller than the equivalent inline edit. No symmetry file created.

**The one real gap found was fixed inline (additive):** the prompt server's `search_prompts` had no FTS-operator documentation while the content server's `search_items` did, despite both routing through the same `search_all_content()` (`websearch_to_tsquery` + ILIKE substring). Mirrored the content server's search guidance into `prompt_mcp_server/tools.yaml` (`search_prompts` description + `query` param), and corrected the `sort_by` note to match actual behavior (defaults to relevance when a query is provided). Purely additive; nothing trimmed.

**Definition of Done**
- ✅ For each server, an explicit decision recorded (above): both hosted files consciously skipped; the prompt-search operator gap closed inline.
- `make backend-verify` passes. **Run the MCP evals** (`make evals`) against a recorded pre-change baseline (requires API + MCP servers running). Risk is ~nil — purely additive, and the existing evals exercise edit/update *selection*, not search-operator usage — but run them to confirm no regression.
- `AGENTS.md` sync list: no MCP artifact created, so no new entry needed.

### Milestone 6 — Content consistency reconciliation (capstone)

**Goal & Outcome**

Authoring each artifact against the real code and existing surfaces will surface content inconsistencies across the product (FAQ, docs, `llms.txt`, MCP instructions, etc.) — the FAQ tier-limit drift found during M0 is the first of likely several. This is the running ledger for those findings and the consolidated pass that fixes them, reconciling each against the single sources of truth this effort establishes.

This milestone owns the **living findings list** (Appendix A is the frozen M0 snapshot; new inconsistencies discovered during M1–M5 are appended to the list below, not to the appendix).

Outcomes:
- Every logged inconsistency reconciled against its canonical source.
- For **each** affected file, `AGENTS.md` "Files to Keep in Sync" is verified to list it — added if missing. This converts each one-off fix into a durable guardrail against re-drift.

**Findings list** (seeded from M0; append as discovered):
- ✅ **RESOLVED upstream — FAQ tier limits (was [KAN-154](https://tiddly.atlassian.net/browse/KAN-154)).** The FAQ "How much content can I store?" answer showed wrong Free-tier numbers. **Fixed by content-as-markdown M3**, not here: the FAQ moved to `/data/faq.json` and its storage answer was reworded to drop the numbers and link `/pricing`, and tier numbers are now single-sourced from `/data/tiers.json` (backend + Pricing read the same file). KAN-154 is already closeable; no action remains in this milestone. Retained as the cautionary example that motivates the "name the canonical source in the header" rule.
- ✅ **RESOLVED in M6 — Antigravity skills claim in the setup prompt (introduced in M3/M4).** The `MCP_SETUP_PROMPT` (`frontend/src/data/agentPrompts.ts`) told the agent that "Codex (or Antigravity)" gets prompts "set up as skills" — but Antigravity is **tools-only**: the CLI's `validSkillsTools` excludes it (`claude-code`, `codex`, `claude-desktop` only) and the artifacts (`llms-integration.txt`, `llms-cli-instructions.txt`) all state Antigravity supports neither native MCP Prompts nor Tiddly skills (prompts reached only via the prompt server's tools). Root cause: the prompt **restated** a code-derived per-tool fact instead of deferring to the doc it already tells the agent to read. Fix: reworded to say Codex/Antigravity "don't surface MCP prompts natively … and [explain] how each makes prompts available instead," removing the restated (and partly-wrong) mechanism — so the agent gets the accurate specifics from the instructions rather than from our copy. This is exactly the "name the canonical source, don't inline the code-derived fact" rule (M1) applied to UI prompt copy.

**Fixed decisions:**
- M6 collapses to a **ledger only**: its seed finding (KAN-154) was resolved by content-as-markdown, so M6 carries no required fix at resume time. It exists to capture and reconcile *new* inconsistencies surfaced while authoring artifacts against the code during M1–M5. If none surface, M6 is a no-op verification pass.
- The findings list lives in *this milestone*, not in the frozen M0 snapshot (Appendix A).

**Definition of Done** *(to be detailed as findings accumulate)*
- Any inconsistency logged during M1–M5 reconciled against its canonical source (the new single sources: `/data/*.json`, `/prose/*.md`, `tier_limits.py`); if none were logged, that is recorded explicitly.
- `AGENTS.md` sync-list coverage verified (and extended) for every affected file.
- `make frontend-verify` / `make backend-verify` pass as appropriate to any files touched. (KAN-154 is already closeable independent of this milestone.)

### Milestone 7 — Deployment (release the artifacts and the CLI)

**Goal & Outcome**

Get everything this effort produced in front of real users. There are **two independent deploys** with a required order:

1. **Frontend deploy** — publishes the artifact family (`llms.txt` + the `llms-*.txt` files) and the `/data` / `/prose` static files to the web origin. This is the normal Railway frontend deploy (merge to `main`); no special step beyond confirming the new `.txt` files are actually served as `text/plain` at `https://tiddly.me/...` (not the SPA shell).
2. **CLI release** — ships the new Go code (`ai-instructions` command + its SPA-shell fallback, and the config-write integrity fix) to users. The *content* `ai-instructions` prints is fetched live and needs no release, but the **command itself is binary code** and only reaches users via a versioned release.

Outcomes:
- The artifact files are fetchable at the web origin (verified, not assumed).
- A new CLI version is published and installable; existing users see it via the built-in update check.

**Implementation Outline**

- **Order matters.** Deploy the frontend **before** tagging the CLI. If the CLI ships first, `ai-instructions` hits the not-yet-deployed path, gets the SPA shell, and prints the offline fallback — safe and exit-0, but degraded. Frontend-first closes that window.
- **CLI release is tag-triggered and automated.** Pushing a `cli/vX.Y.Z` tag fires `.github/workflows/cli-release.yaml` → GoReleaser builds the cross-platform binaries with `cliVersion` injected via ldflags and publishes a GitHub release. There is no manual build/upload step.
- **Target version: `cli/v0.3.2`** (current latest is `cli/v0.3.0`). Bundles the codex preservation/integrity bugfix and the `ai-instructions` feature.
- Do not push the tag until the work is merged to `main` and the frontend artifact deploy is confirmed live.

**Definition of Done**
- `https://tiddly.me/llms.txt` and each `llms-*.txt` return `200 text/plain` with real content (curl the `content-type`, not just the status).
- `cli/v0.3.2` tag pushed; the release workflow succeeds and the GitHub release lists the platform binaries.
- A clean install (`install.sh`) yields a binary whose `tiddly --version` reports `0.3.2` and whose `tiddly ai-instructions` fetches the live doc (no fallback note) against prod.

## Cross-cutting concerns

- **Anti-drift / single source of truth.** The hard principles (no restatement; `llms.txt` as hub; each artifact earns its existence) are the mitigation. Record them in `AGENTS.md` so future changes know which file owns which concept. Note the existing content homes that overlap (`docs/*`, skills `SKILL.md`, the MCP `instructions.md` files) and ensure artifacts cross-reference rather than copy them.
- **Sequencing.** M0 gates everything and triggers the re-planning checkpoint. M1 (artifacts) must land before M3's prompt references them. M2 is independent of M1/M3 once its artifact exists. M4 depends on M3's reusable component. M5 depends on M0's artifact set and on its two hosted files existing (authored in M1 or within M5); it is otherwise independent and touches the backend + evals. M6 is the capstone — it runs throughout as a findings ledger and resolves everything in the final pass, so it depends on M1–M5 having surfaced the inconsistencies. M7 (deployment) runs last and depends on all prior milestones being merged: frontend deploy first, then the `cli/v0.3.2` tag.
- **No commits until human approval at each milestone boundary.**

## Open items (resolved during execution, not blockers)

- The exact artifact set, names, and per-file objectives — decided in M0.
- Whether evaluation content needs a single file or an `llms.txt` + deeper file — folded into M0's artifact-set decision.
- Landing CTA label/placement and the exact copy for every artifact and prompt — finalized within their milestones.

---

## Appendix A — M0 deliverable (frozen historical record)

**Status:** Frozen historical record of the M0 research; the living decisions are in the milestones above. Preserved here as the M0 snapshot.

> **Superseded notes:** (1) The FAQ tier-limit fix (§5/§6 below) was **resolved by the content-as-markdown refactor**, not in this PR (see Milestone 6). (2) The living findings ledger now lives in Milestone 6, not in this appendix. (3) **Link targets below are superseded by the reconciliation note at the top of this plan:** tier numbers now link `/data/tiers.json` (not just `/pricing`), and `/docs/*` cross-references become the agent-readable `/prose/*.md` + `/data/*.json` artifacts. The appendix text is preserved as the frozen M0 snapshot; the reconciliation note is authoritative where they differ.

The executed M0 deliverable: the concept inventory, the justified artifact set (with recommendations taken, not punted), the index/discoverability strategy, the copy-ready anti-drift philosophy, and findings uncovered during the research. Sources mined: `frontend/public/llms.txt`, the `frontend/src/pages/docs/*` pages, `frontend/src/data/docsRoutes.tsx`, `AGENTS.md`, and `docs/architecture.md`.

### A.0 Scope — what these artifacts are (and are not) for

These artifacts empower **user-facing agents**: an agent evaluating Tiddly for a person, or guiding a person to use and integrate it. They are **not** for agents working inside the Tiddly codebase.

Therefore, **internal/system architecture is out of scope**: RLS/multi-tenant query invariants, middleware ordering, reverse-diff `ContentHistory` storage, Redis key schemas, cron internals, LiteLLM cost-bucket mechanics, auth-dependency variants, etc. That body of knowledge already has a home (`AGENTS.md` + `docs/architecture.md`) and a different consumer (a coding/security/self-hosting agent). If we ever want a hosted artifact for *that* audience, it's a separate effort — explicitly deferred, noted here so the line is deliberate.

What an evaluation/integration agent needs from the system layer is only the **user-observable contract**: that content is private/multi-tenant, versioned, soft-deleted/archived, rate-limited per tier, and that AI endpoints reject PATs. Those facts are in scope; their implementations are not.

### A.1 Concept inventory (tagged by job)

Jobs: **EVAL** (what/why/compare/who-for) · **USE** (operating app features) · **INTEG** (connecting Tiddly to AI tooling) · **CLI** (the `tiddly` CLI specifically) · **MCP-USE** (an agent using a connected MCP server's tools effectively — distinct from INTEG, which is about *setting up* the connection). A concept may touch several jobs but gets **one home** (§4). "Home" column is the recommended owning artifact.

| Concept | Jobs | Home |
|---|---|---|
| Value prop / four pillars / differentiators | EVAL | `llms.txt` |
| Who it's for / **who it's *not* for** / vs. generic bookmark+notes apps | EVAL | `llms.txt` |
| The three content types — conceptual ("what is a prompt-as-content") | EVAL | `llms.txt` |
| The three content types — operational (fields, click vs. edit behavior, Quick-Add `Cmd+V`) | USE | `llms-app-usage.txt` |
| Tags (global), filters (boolean AND/OR), collections, sidebar org | USE | `llms-app-usage.txt` |
| Relationships (link any type to any type, optional description) | USE | `llms-app-usage.txt` |
| Search — operators (`"phrase"`, `-exclude`, `OR`), FTS+substring, in-content, unified | USE | `llms-app-usage.txt` |
| Markdown editor — slash menu, `Cmd+/` command menu, reading mode, view toggles | USE | `llms-app-usage.txt` |
| Keyboard shortcuts (full set) | USE | `llms-app-usage.txt` (or link to `/docs/shortcuts`) |
| Content lifecycle — active / archived / trash, 30-day purge | USE | `llms-app-usage.txt` |
| Optimistic-locking conflict dialog (another tool edited the item) | USE | `llms-app-usage.txt` |
| **Known issues / gotchas / limitations** (text-only content, loose-list spacing, wrapped-line selection bug) | USE | `llms-app-usage.txt` (link `/docs/known-issues`) |
| Version history — user-facing (restore, source/auth tracking, retention by tier) | EVAL + USE | `llms.txt` (transparency = selling point) + cross-ref |
| Prompts & Jinja2 — authoring (syntax, args, conditionals, filters, loops, strict mode, auto-sync) | USE | `llms-app-usage.txt` (link `/docs/features/prompts`) |
| Prompts — consuming via MCP (`list_prompts`/`get_prompt`) | INTEG | `llms-integration.txt` |
| MCP servers — what they are, endpoints, tool inventory, read-only (no delete) | INTEG | `llms-integration.txt` |
| Content MCP — using the tools well (when to use `get_context` vs `search_items`, `get_item` partial reads, `edit_content` str-replace patterns, multi-step workflows, examples) | MCP-USE | `llms-mcp-content.txt` |
| Prompt MCP — using the tools well (native `list_prompts`/`get_prompt` rendering vs. management tools, optimistic-locking workflow, examples) | MCP-USE | `llms-mcp-prompts.txt` |
| Connecting AI tools — CLI-recommended path + manual config | INTEG | `llms-integration.txt` (CLI depth → CLI file) |
| Per-tool notes & quirks (Claude Desktop/Code, Codex tools-only, Antigravity, ChatGPT soon) | INTEG | `llms-integration.txt` |
| Skills export (prompts → SKILL.md; per-client install behavior & limits) | INTEG | `llms-integration.txt` (CLI invocation → CLI file) |
| REST API — endpoint groups, Swagger, pagination/sort/filter, rate-limit headers | INTEG | `llms-integration.txt` |
| PAT auth + **the 403 security surfaces** (AI/tokens/settings/scrape are Auth0-only) | INTEG | `llms-integration.txt` |
| Chrome extension (save/search flows, PAT setup, shortcut) | INTEG + USE | `llms-integration.txt` (link `/docs/extensions/chrome`) |
| `tiddly` CLI — full command set, scopes, credential storage, token resolution | CLI | `llms-cli-instructions.txt` |
| CLI workflows (login → configure → status; export; token mgmt) | CLI | `llms-cli-instructions.txt` |
| Common dashboard URLs (Settings → AI Integration / PATs / General; `/docs/*`; `/pricing`) | CLI + INTEG | each file links the ones it needs |
| AI suggestion features (tag/title/description/relationship/argument; BYOK; model choice) | EVAL + USE | `llms.txt` (Pro selling point) + `llms-app-usage.txt` (how-to) |
| Pricing / tiers — headline numbers + "beta = Pro free" | EVAL | `llms.txt`, summarized; link `/pricing` for authoritative detail |
| Privacy / security posture / self-hosting / multi-tenant isolation | EVAL | `llms.txt` |
| Data export (`tiddly export`, REST) | EVAL + CLI | `llms.txt` mentions; mechanics in CLI file |
| Use cases & examples (PKB, AI prompt library, research, AI content mgmt, automation) | EVAL | `llms.txt` |
| Getting-started flows (first bookmark, MCP setup, skills, extension, CLI login, API) | EVAL→INTEG | `llms.txt` points to the right artifact per flow |

#### A.1a Code-derived vs. narrative classification (drift exposure)

*(Added post-review; feeds Milestone 1's "name the canonical source in the header" rule.)* Every fact above is one of two kinds, and they have different drift exposure:

- **Code-derived** — has an authoritative source elsewhere and rots when that source changes: CLI command set/scopes (`cli/cmd/`), MCP tool names/inventory (server tool registries), tier/pricing numbers (`tier_limits.py` / `/pricing`), endpoint groups + the **403/Auth0-only surfaces** (API routers), per-tool quirks, dashboard URLs, MCP endpoints. **Prefer linking; if inlined, name the canonical source in the artifact header.**
- **Narrative** — exists only in the artifact and can't drift against code: value prop, who-it's/isn't-for, use cases, task orchestration ("to do X, do Y"), tool-usage workflows, the agent-resource index, "optimized for an agent" framing. Owned outright by its artifact.

The FAQ tier-limit drift (§5) is the cautionary case: a code-derived fact (Free-tier counts) inlined into a surface that's *already* in the AGENTS.md sync list, and it still went stale — which is why naming an explicit diff target in the header matters beyond the sync-list reminder.

### A.2 Artifact set — recommendation

**Recommendation: four committed files + up to two conditional MCP files.** The four general-purpose files (below) we'll clearly need. The two MCP-server-specific files (`llms-mcp-content.txt`, `llms-mcp-prompts.txt`) are **hypothesis-gated** (revised post-review — see the MCP entries and Milestone 5): they're created only if, when drafting, we can write meaningful guidance *beyond* what the always-in-context `instructions.md`/tool descriptions already provide. The MCP pair may end up as zero, one, or two files. I'm reversing my earlier "defer app-usage" — the mining shows a substantial, distinct USE body (search operators, editor mechanics, filters/collections, lifecycle, *and the known-issues/gotchas an agent should warn a user about*) that neither `llms.txt` (concepts) nor the integration/CLI files should carry. Its consumer is real (below). I keep it **lean and pointer-heavy** to docs, and we re-confirm at M1 drafting that it isn't a thin redirector — if it collapses, fold it into `llms.txt`.

> **On proliferation:** four committed files is the ceiling without strong justification; the MCP pair is *additive depth*, gated on earning its existence at authoring time. Each file passes the "distinct consumer + distinct job" guardrail, and the MCP pair has a *distinct discovery path* (the server instructions) that the others can't serve. New artifact proposals should be met with "can an existing file own this?" first.

#### `llms.txt` — the hub (EVAL + index) — **build**
- **Consumer:** an evaluation-mode agent (the landing-page CTA points here); any agent's first stop.
- **Objective:** explain and honestly pitch Tiddly without mandatory link-chasing, and **index the rest of the family + key docs**.
- **Owns:** value prop, who-it's/isn't-for, conceptual content-type definitions, pricing/tier *summary*, privacy/self-hosting, use cases, the agent-resource index.

#### `llms-app-usage.txt` — operating the app (USE) — **build (lean)**
- **Consumer:** an agent helping a user *do things in Tiddly* ("how do I make a filter for all my Python tutorials?", "why is there an extra blank line in my list?"). Reached from `llms.txt` when the user is in "use" not "evaluate" or "connect" mode.
- **Objective:** task-oriented guidance for app features + the gotchas/known issues an agent should proactively flag. Owns the agent-oriented *orchestration*; cross-references `/docs/*` for exhaustive mechanics rather than copying them.
- **Owns:** the "to accomplish X, do Y in the UI" mapping, plus the known-issues awareness.

#### `llms-integration.txt` — connecting to AI (INTEG) — **build**
- **Consumer:** an agent guiding a user through connecting Tiddly to their AI tooling (may not have the CLI yet).
- **Objective:** the integration landscape — MCP servers (what/endpoints/tool overview, read-only), connecting tools (CLI-recommended + manual fallback), per-tool quirks, skills export, REST API + PAT auth + **the 403 surfaces**, Chrome extension. Cross-references the CLI file for command depth.
- **Owns:** the MCP/API/PAT integration model and per-tool connection notes.

#### `llms-cli-instructions.txt` — the CLI deep dive (CLI) — **build**
- **Consumer:** the `tiddly ai-instructions` command (and agents already driving the CLI). This agent *has* the CLI; it needs capabilities/workflows, not "install the CLI."
- **Objective:** full `tiddly` command reference, scopes, credential/token resolution, common workflows, the dashboard URLs CLI work touches.
- **Owns:** CLI command details and workflows.

#### `llms-mcp-content.txt` — using the Content MCP server (MCP-USE) — **conditional / additive** (revised post-review)
- **Consumer:** an agent already connected to the Content MCP server, deciding when/how to use its tools. **Discovery path is the server's own instructions** (`backend/src/mcp_server/instructions.md`) and the per-tool descriptions, which agents read to choose servers/tools.
- **Objective:** *additional* high-value tool-usage guidance/examples beyond what's already inline — e.g. when to reach for `get_context` vs `search_items`, partial reads with `get_item`, surgical `edit_content` str-replace patterns, multi-step workflows. Cross-references `llms.txt` for concepts; does not restate tool schemas.
- **Owns:** "extra depth for using the Content MCP tools well" — **only if it earns it.** `mcp_server/instructions.md` is already ~139 lines / 10 worked examples; create this file only if drafting yields meaningful additions, otherwise skip it.

#### `llms-mcp-prompts.txt` — using the Prompt MCP server (MCP-USE) — **conditional / additive** (revised post-review)
- **Consumer:** an agent connected to the Prompt MCP server. Discovery path: `backend/src/prompt_mcp_server/instructions.md` + tool descriptions.
- **Objective:** *additional* depth on native MCP prompts (`list_prompts`/`get_prompt` rendering) vs. management tools, the optimistic-locking workflow (`expected_updated_at`), naming conventions, worked examples.
- **Owns:** "extra depth for using the Prompt MCP tools well" — **only if it earns it.** `prompt_mcp_server/instructions.md` is already minimal (~28 lines), so there's likely room here — but still gated on adding real value, not symmetry with the content file.

**Decisions taken (were open questions):**
- **MCP files are additive and hypothesis-gated** *(revised post-review — supersedes the earlier "two files, lean instructions" stance)*. We **never subtract** from `instructions.md` or tool descriptions: a single-shot tool-calling LLM (what our evals exercise) can't fetch-then-act in one turn, so essential guidance must stay inline. The hosted files add optional depth *beyond* inline, are created only where they earn it (zero/one/two files), and if created their pointer goes in both the server instructions and the relevant tool descriptions. See Milestone 5.
- **CLI stays separate from integration.** Distinct consumer (the CLI command consumes the CLI file and already has the CLI installed); the no-restatement rule keeps the two from overlapping (integration says "use the CLI → see CLI file"; CLI file says "for the why, see integration").
- **Tier limits: summarize in `llms.txt`, link `/pricing` for authoritative numbers.** The exhaustive per-tier table is reference-heavy and a proven drift magnet (the FAQ already drifted — see §5). One authoritative home, linked, not copied.
- **Command vs. file naming: keep them different on purpose.** The command `tiddly ai-instructions` is optimized for agent discovery via `--help`; the file `llms-cli-instructions.txt` fits the family convention. The file URL is an implementation detail behind the command, so they needn't match.

### A.3 Index / discoverability strategy

- **`llms.txt` is the single entry point and hub.** It ends with an **"Agent resources"** section: one line per sibling artifact (name, who it's for, when to read it), plus links to the highest-value `/docs/*` pages, `/docs/tips`, `/pricing`, and `/app/settings/ai-integration`. This is the *useful* application of the llms.txt link-index idea — pointing at our own purpose-built artifacts, not scattered marketing pages.
- **Routing by user mode:** evaluating → stay in `llms.txt`; using the app → `llms-app-usage.txt`; connecting → `llms-integration.txt`; the CLI itself → `llms-cli-instructions.txt`. `llms.txt` states this routing explicitly so an agent self-selects.
- **Web consumers** reach subfiles via `llms.txt` links.
- **CLI consumer** reaches `llms-cli-instructions.txt` via a hardcoded URL in `tiddly ai-instructions`, with the minimal embedded fallback (per M2). The CLI does **not** parse `llms.txt`.
- **MCP consumers**, *if a hosted MCP file is created* (conditional — see §2), reach it via an additive pointer in both the server's `instructions.md` and the relevant tool descriptions — a second top-of-funnel entry point independent of `llms.txt`, since an agent connected via MCP may never see the landing page. Essential guidance stays inline regardless (single-shot agents can't fetch); the file is optional depth.
- All artifacts are static assets in `frontend/public/`, served at `https://tiddly.me/<name>.txt`.

### A.4 Anti-drift philosophy (copy-ready for `AGENTS.md` and each artifact's header)

> **Tiddly agent-empowerment artifacts.** A family of `llms-*.txt` files, each for one job and one consumer. `llms.txt` is the hub: it carries the evaluation story and indexes the rest. Subfiles serve a single job — app usage, integration, or CLI.
>
> **Rules:**
> 1. **Generic facts have one home — `llms.txt`.** Value prop, tiers/pricing, privacy, and the conceptual definitions live there once. Subfiles do **not** restate them; they cross-reference (e.g. "tier limits: see `llms.txt` / `/pricing`").
> 2. **CLI command details live only in `llms-cli-instructions.txt`.** `llms-integration.txt` says "use the CLI (see CLI instructions)" and covers *when/why* + the manual alternative; it does not re-list commands.
> 3. **The MCP/API/PAT integration model lives only in `llms-integration.txt`.** `llms.txt` mentions "AI integration via MCP" at value-prop level and links onward.
> 4. **App mechanics live in `llms-app-usage.txt`**, which cross-references `/docs/*` for exhaustive detail rather than copying it.
> 4b. **MCP tool-usage depth (if created) lives in `llms-mcp-content.txt` / `llms-mcp-prompts.txt`** — additive only. These do not restate tool schemas (the MCP protocol/tool descriptions own those) or concepts (`llms.txt`); they add workflows and examples *beyond* what's inline. We never trim `instructions.md` or tool descriptions; the hosted file is optional depth, pointed to from both, and created only where it earns it.
> 5. **A subfile goes deep on a subject only when that subject is its job.** Everything else is a cross-reference.
> 6. **Don't duplicate `/docs/*` or `SKILL.md` content** — link to it; add the agent-oriented narrative/orchestration that docs lack.
> 7. **System internals are out of scope** for this family (they belong to `AGENTS.md` / `docs/architecture.md`); include only the user-observable contract.

Each artifact opens with a one-line header stating its job, its consumer, and "does not restate X — see Y."

### A.5 Findings & issues uncovered during research

1. **FAQ tier-limit drift (correctness bug).** `FAQContent.tsx` states Free-tier limits of 100 bookmarks/notes/prompts; `tier_limits.py` and `llms.txt` say 10/10/5. This is exactly the drift the anti-restatement rule is meant to prevent, and it's user-facing wrong today. *(Originally recommended as a separate fix; now folded into Milestone 6 — see superseded note at the top of this appendix.)* Reinforces the "tiers have one authoritative home + link" decision.
2. **`llms.txt` gap: no "who it's *not* for" / comparison framing.** Present file pitches well but doesn't arm an agent for an honest evaluation. M1 should add this (per the writing philosophy's "honest" principle).
3. **Known-issues content is valuable to agents and currently invisible to them.** `/docs/known-issues` (text-only limitation, editor bugs/quirks) is exactly what an agent should proactively warn a user about — justifies surfacing it in `llms-app-usage.txt`.
4. **`/pricing` should be the authoritative tier source** the artifacts link to; confirm it's current before pointing at it.

### A.6 What needed human sign-off (resolved)

*Resolved during post-M0 review — recorded here for history; the live versions are in the milestones above.*

- **Artifact set:** four committed files + up to two **conditional, additive** MCP files (revised from "six committed"; the single-vs-two MCP question is moot now that they're hypothesis-gated). `llms-app-usage.txt` confirmed as a build (lean). ✔
- **Tiers summarized + linked** rather than exhaustively inline in `llms.txt`. ✔
- **FAQ tier-limit drift** folded into **Milestone 6** (not a separate fix) — see superseded note at top. ✔
- **System internals explicitly out of scope** for this artifact family. ✔
