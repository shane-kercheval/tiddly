# Milestone 0 — Concept categorization & artifact-family definition

**Parent plan:** [`2026-05-21-agent-empowerment.md`](./2026-05-21-agent-empowerment.md)
**Status:** Draft for human review.

The executed M0 deliverable: the concept inventory, the justified artifact set (with recommendations taken, not punted), the index/discoverability strategy, the copy-ready anti-drift philosophy, and findings uncovered during the research. Sources mined: `frontend/public/llms.txt`, the `frontend/src/pages/docs/*` pages, `frontend/src/data/docsRoutes.tsx`, `AGENTS.md`, and `docs/architecture.md`.

---

## 0. Scope — what these artifacts are (and are not) for

These artifacts empower **user-facing agents**: an agent evaluating Tiddly for a person, or guiding a person to use and integrate it. They are **not** for agents working inside the Tiddly codebase.

Therefore, **internal/system architecture is out of scope**: RLS/multi-tenant query invariants, middleware ordering, reverse-diff `ContentHistory` storage, Redis key schemas, cron internals, LiteLLM cost-bucket mechanics, auth-dependency variants, etc. That body of knowledge already has a home (`AGENTS.md` + `docs/architecture.md`) and a different consumer (a coding/security/self-hosting agent). If we ever want a hosted artifact for *that* audience, it's a separate effort — explicitly deferred, noted here so the line is deliberate.

What an evaluation/integration agent needs from the system layer is only the **user-observable contract**: that content is private/multi-tenant, versioned, soft-deleted/archived, rate-limited per tier, and that AI endpoints reject PATs. Those facts are in scope; their implementations are not.

---

## 1. Concept inventory (tagged by job)

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

---

## 2. Artifact set — recommendation

**Recommendation: six files.** Four general-purpose files (below), plus two MCP-server-specific files (`llms-mcp-content.txt`, `llms-mcp-prompts.txt`) reached from a new discovery path — the MCP server instructions themselves. I'm reversing my earlier "defer app-usage" — the mining shows a substantial, distinct USE body (search operators, editor mechanics, filters/collections, lifecycle, *and the known-issues/gotchas an agent should warn a user about*) that neither `llms.txt` (concepts) nor the integration/CLI files should carry. Its consumer is real (below). I keep it **lean and pointer-heavy** to docs, and we re-confirm at M1 drafting that it isn't a thin redirector — if it collapses, fold it into `llms.txt`.

> **On proliferation:** six files is the most this family should grow without strong justification. Each here passes the "distinct consumer + distinct job" guardrail, and the MCP pair has a *distinct discovery path* (the server instructions) that the others can't serve. But this is the ceiling — new artifact proposals should be met with "can an existing file own this?" first.

### `llms.txt` — the hub (EVAL + index) — **build**
- **Consumer:** an evaluation-mode agent (the landing-page CTA points here); any agent's first stop.
- **Objective:** explain and honestly pitch Tiddly without mandatory link-chasing, and **index the rest of the family + key docs**.
- **Owns:** value prop, who-it's/isn't-for, conceptual content-type definitions, pricing/tier *summary*, privacy/self-hosting, use cases, the agent-resource index.

### `llms-app-usage.txt` — operating the app (USE) — **build (lean)**
- **Consumer:** an agent helping a user *do things in Tiddly* ("how do I make a filter for all my Python tutorials?", "why is there an extra blank line in my list?"). Reached from `llms.txt` when the user is in "use" not "evaluate" or "connect" mode.
- **Objective:** task-oriented guidance for app features + the gotchas/known issues an agent should proactively flag. Owns the agent-oriented *orchestration*; cross-references `/docs/*` for exhaustive mechanics rather than copying them.
- **Owns:** the "to accomplish X, do Y in the UI" mapping, plus the known-issues awareness.

### `llms-integration.txt` — connecting to AI (INTEG) — **build**
- **Consumer:** an agent guiding a user through connecting Tiddly to their AI tooling (may not have the CLI yet).
- **Objective:** the integration landscape — MCP servers (what/endpoints/tool overview, read-only), connecting tools (CLI-recommended + manual fallback), per-tool quirks, skills export, REST API + PAT auth + **the 403 surfaces**, Chrome extension. Cross-references the CLI file for command depth.
- **Owns:** the MCP/API/PAT integration model and per-tool connection notes.

### `llms-cli-instructions.txt` — the CLI deep dive (CLI) — **build**
- **Consumer:** the `tiddly ai-instructions` command (and agents already driving the CLI). This agent *has* the CLI; it needs capabilities/workflows, not "install the CLI."
- **Objective:** full `tiddly` command reference, scopes, credential/token resolution, common workflows, the dashboard URLs CLI work touches.
- **Owns:** CLI command details and workflows.

### `llms-mcp-content.txt` — using the Content MCP server (MCP-USE) — **build**
- **Consumer:** an agent already connected to the Content MCP server, deciding when/how to use its tools. **Discovery path is the server's own instructions** (`backend/src/mcp_server/instructions.md`), which agents read to choose servers/tools — so the inline instructions stay concise and point here for depth.
- **Objective:** tool-usage guidance and worked examples — when to reach for `get_context` vs `search_items`, partial reads with `get_item`, surgical `edit_content` str-replace patterns, multi-step workflows. Cross-references `llms.txt` for concepts and does not restate tool schemas (those live in the MCP protocol/tool descriptions).
- **Owns:** "how to use the Content MCP tools well."

### `llms-mcp-prompts.txt` — using the Prompt MCP server (MCP-USE) — **build**
- **Consumer:** an agent connected to the Prompt MCP server. Discovery path: `backend/src/prompt_mcp_server/instructions.md`.
- **Objective:** native MCP prompts (`list_prompts`/`get_prompt` rendering) vs. management tools, the optimistic-locking workflow (`expected_updated_at`), naming conventions, worked examples.
- **Owns:** "how to use the Prompt MCP tools well."

**Decisions taken (were open questions):**
- **MCP artifacts: two files, one per server.** They map cleanly to the two deployed servers and their two `instructions.md` files — each server points only at its own file. (Open for your input: a single combined `llms-mcp.txt` is possible, but two matches the deployment topology and keeps each agent's fetch scoped to the server it's actually using.)
- **Inline MCP instructions stay concise + point to the hosted file.** The instructions are always in-context for a connected agent, so depth lives in the fetched-on-demand file, not the deployed string. This also means we can improve the rich guidance without redeploying the MCP servers.
- **CLI stays separate from integration.** Distinct consumer (the CLI command consumes the CLI file and already has the CLI installed); the no-restatement rule keeps the two from overlapping (integration says "use the CLI → see CLI file"; CLI file says "for the why, see integration").
- **Tier limits: summarize in `llms.txt`, link `/pricing` for authoritative numbers.** The exhaustive per-tier table is reference-heavy and a proven drift magnet (the FAQ already drifted — see §5). One authoritative home, linked, not copied.
- **Command vs. file naming: keep them different on purpose.** The command `tiddly ai-instructions` is optimized for agent discovery via `--help`; the file `llms-cli-instructions.txt` fits the family convention. The file URL is an implementation detail behind the command, so they needn't match.

---

## 3. Index / discoverability strategy

- **`llms.txt` is the single entry point and hub.** It ends with an **"Agent resources"** section: one line per sibling artifact (name, who it's for, when to read it), plus links to the highest-value `/docs/*` pages, `/docs/tips`, `/pricing`, and `/app/settings/ai-integration`. This is the *useful* application of the llms.txt link-index idea — pointing at our own purpose-built artifacts, not scattered marketing pages.
- **Routing by user mode:** evaluating → stay in `llms.txt`; using the app → `llms-app-usage.txt`; connecting → `llms-integration.txt`; the CLI itself → `llms-cli-instructions.txt`. `llms.txt` states this routing explicitly so an agent self-selects.
- **Web consumers** reach subfiles via `llms.txt` links.
- **CLI consumer** reaches `llms-cli-instructions.txt` via a hardcoded URL in `tiddly ai-instructions`, with the minimal embedded fallback (per M2). The CLI does **not** parse `llms.txt`.
- **MCP consumers** reach `llms-mcp-content.txt` / `llms-mcp-prompts.txt` via a pointer in each server's `instructions.md` — a second top-of-funnel entry point independent of `llms.txt`, since an agent connected via MCP may never see the landing page. The server instructions are the agent's first contact, so this is high-leverage discovery.
- All artifacts are static assets in `frontend/public/`, served at `https://tiddly.me/<name>.txt`.

---

## 4. Anti-drift philosophy (copy-ready for `AGENTS.md` and each artifact's header)

> **Tiddly agent-empowerment artifacts.** A family of `llms-*.txt` files, each for one job and one consumer. `llms.txt` is the hub: it carries the evaluation story and indexes the rest. Subfiles serve a single job — app usage, integration, or CLI.
>
> **Rules:**
> 1. **Generic facts have one home — `llms.txt`.** Value prop, tiers/pricing, privacy, and the conceptual definitions live there once. Subfiles do **not** restate them; they cross-reference (e.g. "tier limits: see `llms.txt` / `/pricing`").
> 2. **CLI command details live only in `llms-cli-instructions.txt`.** `llms-integration.txt` says "use the CLI (see CLI instructions)" and covers *when/why* + the manual alternative; it does not re-list commands.
> 3. **The MCP/API/PAT integration model lives only in `llms-integration.txt`.** `llms.txt` mentions "AI integration via MCP" at value-prop level and links onward.
> 4. **App mechanics live in `llms-app-usage.txt`**, which cross-references `/docs/*` for exhaustive detail rather than copying it.
> 4b. **MCP tool-usage guidance lives in `llms-mcp-content.txt` / `llms-mcp-prompts.txt`.** These do not restate tool schemas (the MCP protocol/tool descriptions own those) or concepts (`llms.txt`); they add workflows and examples. Each server's `instructions.md` carries only a concise summary + a pointer to its file.
> 5. **A subfile goes deep on a subject only when that subject is its job.** Everything else is a cross-reference.
> 6. **Don't duplicate `/docs/*` or `SKILL.md` content** — link to it; add the agent-oriented narrative/orchestration that docs lack.
> 7. **System internals are out of scope** for this family (they belong to `AGENTS.md` / `docs/architecture.md`); include only the user-observable contract.

Each artifact opens with a one-line header stating its job, its consumer, and "does not restate X — see Y."

---

## 5. Findings & issues uncovered during research

1. **FAQ tier-limit drift (correctness bug).** `FAQContent.tsx` states Free-tier limits of 100 bookmarks/notes/prompts; `tier_limits.py` and `llms.txt` say 10/10/5. This is exactly the drift the anti-restatement rule is meant to prevent, and it's user-facing wrong today. **Recommend a separate fix** (out of this ticket's scope, but flagged) and reinforces the "tiers have one authoritative home + link" decision.
2. **`llms.txt` gap: no "who it's *not* for" / comparison framing.** Present file pitches well but doesn't arm an agent for an honest evaluation. M1 should add this (per the writing philosophy's "honest" principle).
3. **Known-issues content is valuable to agents and currently invisible to them.** `/docs/known-issues` (text-only limitation, editor bugs/quirks) is exactly what an agent should proactively warn a user about — justifies surfacing it in `llms-app-usage.txt`.
4. **`/pricing` should be the authoritative tier source** the artifacts link to; confirm it's current before pointing at it.

---

## 6. What needs human sign-off

Per the DoD, this milestone gates the build work. I've taken positions on every decision above; the ones most worth your explicit yes/no before the re-planning checkpoint:

- The **six-file set** (especially: reversing to *build* a lean `llms-app-usage.txt` — agree, or keep it deferred? — and **two MCP files vs. one combined `llms-mcp.txt`**).
- **Tiers summarized + linked** rather than exhaustively inline in `llms.txt`.
- Treating the **FAQ tier-limit drift as a separate fix** (not folded into this ticket).
- **System internals explicitly out of scope** for this artifact family.

On approval, this triggers the re-planning checkpoint to detail Milestones 1–4 against this artifact set.
