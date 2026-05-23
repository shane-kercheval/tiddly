# Agent Empowerment: educating users and AI agents about Tiddly

**Ticket:** [KAN-152](https://tiddly.atlassian.net/browse/KAN-152)
**Date:** 2026-05-21
**Status:** Planning

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
- **Code-derived facts name their canonical source in the artifact header.** The AGENTS.md "Files to Keep in Sync" convention is *not* sufficient on its own — it already lists `FAQContent.tsx` and that file still drifted (see findings doc / M6). So for any inlined fact that derives from code (command names, MCP tool names, tier numbers, URLs, the 403 surfaces), the artifact's header states where it must agree with (e.g. "command list mirrors `cli/cmd/`; tier numbers: see `/pricing`"). This gives a reviewer an explicit diff target. Prefer linking over inlining for code-derived facts wherever possible; reserve inlining for facts an agent must have without a fetch. The findings-doc inventory tags each fact code-derived vs. narrative to make this concrete.
- **`llms-app-usage.txt` is orientation, not a tips dump.** It is the higher-level "map" of how the app is structured and how to accomplish core tasks (organize, search, filter, edit) plus the gotchas to warn users about. It cross-references the `/docs/tips` corpus wholesale and may deep-link a small handful of high-value tips by `#tip-<id>` anchor where one is load-bearing for a core workflow — but it does **not** reproduce the corpus (tips remain the authoritative home for granular tips).
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

**Definition of Done** *(to be detailed after M0)*
- For each server, an explicit decision recorded: hosted file created (with additive pointers wired into instructions + tool descriptions) or consciously skipped because inline guidance suffices.
- `make backend-verify` passes. **Run the MCP evals** (`make evals`) against a recorded pre-change baseline. Because nothing is removed, regression risk is ~nil; the eval question is whether the additions *help* — a regression is still a blocker.
- `AGENTS.md` sync list updated for any MCP artifact actually created, plus the instructions-pointer convention.

### Milestone 6 — Content consistency reconciliation (capstone)

**Goal & Outcome**

Authoring each artifact against the real code and existing surfaces will surface content inconsistencies across the product (FAQ, docs, `llms.txt`, MCP instructions, etc.) — the FAQ tier-limit drift found during M0 is the first of likely several. This is the running ledger for those findings and the consolidated pass that fixes them, reconciling each against the single sources of truth this effort establishes.

This milestone owns the **living findings list** (the M0 findings doc, `2026-05-21-agent-empowerment-m0-findings.md`, stays frozen as a historical record; new inconsistencies discovered during M1–M5 are appended to the list below, not to that doc).

Outcomes:
- Every logged inconsistency reconciled against its canonical source.
- For **each** affected file, `AGENTS.md` "Files to Keep in Sync" is verified to list it — added if missing. This converts each one-off fix into a durable guardrail against re-drift.

**Findings list** (seeded from M0; append as discovered):
- **FAQ tier limits (was [KAN-154](https://tiddly.atlassian.net/browse/KAN-154)).** `frontend/src/components/FAQContent.tsx` "How much content can I store?" shows wrong Free-tier numbers (100/100/100 vs. actual 10/10/5; 100,000 vs. 25,000 char content limit; 100 vs. 200 char title). Reconcile against `backend/src/core/tier_limits.py` (or have it reference `/pricing`), and confirm the FAQ surface is in the `AGENTS.md` sync list. **Folded into this milestone rather than fixed separately** — at beta scale the user-facing risk is low, and consolidating keeps related content fixes in one reviewable PR.

**Fixed decisions:**
- KAN-154 is resolved here, not on its own branch.
- The findings list lives in *this plan*, not in the frozen M0 findings doc.

**Definition of Done** *(to be detailed as findings accumulate)*
- All logged inconsistencies resolved against canonical sources.
- `AGENTS.md` sync-list coverage verified (and extended) for every affected file.
- `make frontend-verify` / `make backend-verify` pass as appropriate to the files touched; KAN-154 closeable.

## Cross-cutting concerns

- **Anti-drift / single source of truth.** The hard principles (no restatement; `llms.txt` as hub; each artifact earns its existence) are the mitigation. Record them in `AGENTS.md` so future changes know which file owns which concept. Note the existing content homes that overlap (`docs/*`, skills `SKILL.md`, the MCP `instructions.md` files) and ensure artifacts cross-reference rather than copy them.
- **Sequencing.** M0 gates everything and triggers the re-planning checkpoint. M1 (artifacts) must land before M3's prompt references them. M2 is independent of M1/M3 once its artifact exists. M4 depends on M3's reusable component. M5 depends on M0's artifact set and on its two hosted files existing (authored in M1 or within M5); it is otherwise independent and touches the backend + evals. M6 is the capstone — it runs throughout as a findings ledger and resolves everything in the final pass, so it depends on M1–M5 having surfaced the inconsistencies.
- **No commits until human approval at each milestone boundary.**

## Open items (resolved during execution, not blockers)

- The exact artifact set, names, and per-file objectives — decided in M0.
- Whether evaluation content needs a single file or an `llms.txt` + deeper file — folded into M0's artifact-set decision.
- Landing CTA label/placement and the exact copy for every artifact and prompt — finalized within their milestones.
