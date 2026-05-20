# Antigravity MCP Configuration via Tiddly CLI

**Date:** 2026-05-19
**Status:** Planned
**Branch:** `antigravity-mcp-support`

## Background

Google announced ([Developers Blog, May 2026](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli)) that Gemini CLI is being replaced by Antigravity for free-tier, Pro, and Ultra users on **June 18, 2026**. Enterprise customers keep Gemini CLI; everyone else moves to Antigravity. We never shipped Gemini CLI support, so the cleanest path is to skip it entirely and target Antigravity directly — that lines up with where the broad individual-user base will be in a month.

Antigravity ships as both an IDE (desktop app) and a terminal CLI binary (`agy`, installed at `~/.local/bin/agy`). They share **one MCP config file** at `~/.gemini/config/mcp_config.json` — so a single `antigravity` handler covers both surfaces.

We support three tools today (`claude-desktop`, `claude-code`, `codex`) via direct file writes (no shelling out to upstream CLIs). This adds a fourth, `antigravity`, following the same pattern.

## What this is and isn't

**This is:** A new `AntigravityHandler` implementing `ToolHandler`, registered alongside the existing three; updates to user-facing settings, docs, and discovery surfaces.

**This is not:**
- Antigravity skills/plugins support. Antigravity uses git-installable plugins (`agy plugin install ...`) bundling MCP servers, skills, and SKILL.md content. That model doesn't map onto our current `tiddly skills configure` flow (which extracts a tar.gz into `~/.claude/skills/`). Deferred to a separate plan if/when there's a use case.
- A Gemini CLI handler. Skipped per the discussion above.
- Antigravity OAuth-based MCP server flows. The binary references `DisconnectMcpOAuth`, but our PATs are static bearer tokens — same as the other three tools.

## Key design decisions (settled)

- **Tool name is `antigravity`** (lowercase, no hyphen). Single name covers both the IDE and the `agy` CLI because they share the same config file. Matches naming convention of existing handlers (`codex`, `claude-code`).
- **Closest existing analog is `ClaudeDesktopHandler`, not `CodexHandler`.** The MCP config file is *dedicated* — it holds only `mcpServers`, no other user prefs — so we do NOT need the `rest map[string]any` preservation pattern Codex uses. User theme/auth lives in sibling files (`~/.gemini/config/config.json`, `~/.gemini/antigravity-cli/settings.json`); we don't touch those.
- **HTTP transport field is `serverUrl`**, not `url`. This is the *only* structural difference from how Claude Desktop / Claude Code write HTTP entries. Empirically verified by writing a test entry to `~/.gemini/config/mcp_config.json` and confirming `agy -p "list mcp servers"` reads it back during the research session that produced this plan (transcript appended below under "Verification results"); also confirmed by grepping the `agy` binary for the literal `"serverUrl"`.
- **`extractServerURL` and `detectTransport` (in `status.go`) are extended in-place to handle `serverUrl`, NOT shadowed by a new Antigravity-local extractor.** The two helpers internally check both field names with preference order `serverUrl` > `url`. No signature change; existing call sites (`claude_code.go:36`, `claude_code.go:276`, `claude_desktop.go:158`) keep working unchanged. Decision rationale: alternative was either a parameterized signature threaded through every call site, or a typed-struct route per Codex. The internal-check route is the smallest diff that keeps URL extraction in one place — load-bearing for status, mismatch preflight, preserved-entry detection, PAT reuse, and `remove --delete-tokens` classification all going through that one helper. The implementing agent does NOT need to re-decide this; just edit the helpers and add tests.
- **Bearer header is `headers.Authorization: "Bearer <PAT>"`** — same as Claude Code / Claude Desktop. PAT extraction reuses the existing `extractBearerToken` helper.
- **Detection: `agy` binary in PATH OR `~/.gemini/antigravity-cli/` or `~/.gemini/antigravity/` directory exists.** Mirrors the Codex detection pattern (binary OR Antigravity-specific dir). These two dirs are created by the Antigravity installer (CLI and IDE respectively); the older Gemini CLI does NOT create them. Do NOT use `~/.gemini/config/` as a detection signal — that dir's provenance is ambiguous enough that an enterprise Gemini-CLI user could falsely appear to have Antigravity installed.
- **No "restart Antigravity" warning.** Unlike Claude Desktop, `agy` re-reads the config on each invocation; the IDE picks up changes via its file watcher.
- **Plaintext-token warning is included** (same wording pattern as Codex / Claude Code).
- **File-direct writes, not shell-out.** Matches the existing handler pattern. `agy` has *no* `mcp add` subcommand anyway (only `plugin`, `install`, `update`, `changelog`), so this isn't even an option — but the principle is documented for the agent: we never call the upstream tool's CLI.
- **Directory-scope path is pending empirical verification.** Community templates ([mapachekurt/antigravity-template](https://github.com/mapachekurt/antigravity-template)) put `mcp_config.json` at the project root (NOT under `.gemini/`). Documentation is thin. Milestone 1 verifies this before Milestone 2 commits to a path.

### Reference documentation (agent must read before implementing)

- Existing handler implementation: `cli/internal/mcp/handler.go`, `claude_desktop.go`, `handler_claude_desktop.go`, `codex.go`, `handler_codex.go` — the new handler must follow the same interface and conventions.
- Scope translation: `cli/internal/mcp/resolve.go`.
- URL classifier, transport detection, PAT-sort: `cli/internal/mcp/status.go` (`classifyServer`, `extractServerURL`, `detectTransport`, `sortCanonicalFirst`).
- Bearer extraction: `cli/internal/mcp/claude_desktop.go` (`extractBearerToken`).
- Atomic-write helpers and shared JSON read/write: `cli/internal/mcp/config_io.go` (`atomicWriteFileFunc`, `readJSONConfig`, `writeJSONConfig`).
- Antigravity MCP docs: https://antigravity.google/docs/mcp (sparse but authoritative for the schema).
- Antigravity transition announcement: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli — context only.
- Community installation references (schema corroboration only — these are not authoritative):
  - https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-antigravity.md
  - https://github.com/czlonkowski/n8n-mcp/blob/main/docs/ANTIGRAVITY_SETUP.md

## Milestones

---

### Milestone 1 — Empirical verification

Small experiment, not a code change. Resolve four open questions before M2 commits to paths and surfaces.

**Goal & Outcome.** Settle, by direct observation, the facts M2 and M3 depend on:

1. **Confirm the user-level path.** Re-confirm that `agy` reads `~/.gemini/config/mcp_config.json` (this was done in the research session that produced this plan; record the transcript fragment here so future implementers have the receipt).
2. **Find the directory-scope path** (or confirm there is none).
3. **Confirm IDE↔CLI path consistency.** Does the Antigravity desktop app read the same `~/.gemini/config/mcp_config.json` post-migration, or has the IDE diverged from the CLI?
4. **Confirm MCP-prompts surfacing.** Does Antigravity actually expose MCP `prompts/*` to the user, or is it tools-only?

**Implementation Outline.**

**General method.** Use a unique random suffix on every test entry name (e.g. `tiddly_verify_<8 hex chars>`). LLM prose enumeration can omit names or hallucinate them; a unique suffix makes either failure mode unambiguous. Where possible, adjudicate against log/debug output, not prose.

First, before any test, run `agy --help` and confirm the `--dangerously-skip-permissions` and `-p` flags exist (they did during this plan's research session; reconfirming defends against an upstream rename). Also run `agy --debug --help` to see whether `--debug` produces structured output useful for grepping.

**(1) Re-confirm user path.** Write `{"mcpServers": {"tiddly_verify_<suffix>": {"serverUrl": "https://mcp.tiddly.me/content", "headers": {"Authorization": "Bearer test"}}}}` to `~/.gemini/config/mcp_config.json`. Run `agy --dangerously-skip-permissions -p "Print the exact MCP server name from your config"`. Confirm the unique suffix appears in the response AND that `~/.gemini/antigravity-cli/cli.log` references the config path. Paste both fragments into the "Verification results" section.

**(2) Directory-scope path.** Plant a uniquely-named entry at each candidate path in an empty test directory, with the user-level config cleared between probes:

1. `<cwd>/mcp_config.json` (community-template convention)
2. `<cwd>/.gemini/config/mcp_config.json` (mirror of user-level structure)
3. `<cwd>/.antigravitycli/mcp_config.json` (using Antigravity's project marker dir)

For each candidate: (a) plant, (b) run agy from that directory and ask for the unique suffix, (c) check `~/.gemini/antigravity-cli/cli.log` for any line resolving an MCP config path. Also test *merge semantics*: with both user-level and a working directory-level config present, are entries additive (combined) or does one override? Record findings.

If none of the three work, project-scope is unavailable; M2 ships `user`-only with `SupportedScopes()` returning `["user"]` (precedent: `ClaudeDesktopHandler`) and `docs/ai-integration.md` "Known Limitations" gets an entry.

**(3) IDE↔CLI consistency.** With the Antigravity desktop app running, edit `~/.gemini/config/mcp_config.json` to contain a uniquely-suffixed server, then in the IDE chat ask it to list its MCP servers. The IDE log lives at `~/Library/Logs/Antigravity` (Mac); grep that log for the config path or the suffix. The IDE check is best-effort — its log structure may not match the CLI's — so write the result up *with the caveat that the CLI check is the rigorous one*. If the IDE doesn't pick up the file, document the divergence in M3's user-facing docs (e.g., "IDE users must restart" or "IDE reads a different file").

**(4) MCP-prompts surfacing.** With both `tiddly_notes_bookmarks` and `tiddly_prompts` configured against staging (or any reachable Tiddly server with a real PAT), ask agy explicitly to list MCP *prompts* (not tools): `agy --dangerously-skip-permissions -p "List every MCP prompt available to you. Prompts are slash-command-style, distinct from tools."` If at least one Tiddly-managed prompt appears, MCP Prompts is `true` in the M3 comparison table. If only tools show up, set the table cell to "Tools only" and add a "Known Limitations" entry in `docs/ai-integration.md`.

**Definition of Done.** Each of the four questions has a recorded answer in this plan's "Verification results" section (appended at the bottom), with at least one of {response-with-unique-suffix, cli.log line, IDE log line} for each. Hand the verified paths and the MCP-Prompts answer to M2 and M3.

---

### Milestone 2 — `AntigravityHandler` implementation

**Goal & Outcome.** The Tiddly CLI supports Antigravity as a fourth target tool:

- `tiddly mcp configure` writes `tiddly_notes_bookmarks` and `tiddly_prompts` entries to `~/.gemini/config/mcp_config.json`. **User scope only** — M1 confirmed agy 1.0.0 supports no directory/project scope.
- `tiddly mcp status` lists Tiddly entries from those files, distinguishing canonical (`MatchByName`) from non-canonical Tiddly-URL entries (`MatchByURL`), and listing all other entries under `OtherServers`.
- `tiddly mcp remove` removes the two canonical entries (URL-agnostic, by name), preserving non-canonical Tiddly-URL entries.
- Auto-detect (`tiddly mcp configure` with no args) picks up Antigravity when `agy` is in PATH or an Antigravity-specific dir (`~/.gemini/antigravity-cli/` or `~/.gemini/antigravity/`) exists.
- `tiddly mcp configure --dry-run` shows a before/after diff with Bearer tokens redacted.
- `--force` overrides the canonical-URL-mismatch refusal, same semantics as the other handlers.
- `tiddly mcp remove --delete-tokens` revokes PATs attached to canonical entries with the same shared-PAT warning and orphan-subtraction logic the other handlers get.

**Implementation Outline.**

1. **Files.** New `cli/internal/mcp/antigravity.go` (per-tool primitives) and `cli/internal/mcp/handler_antigravity.go` (interface adapter). Patterns to mirror: `claude_desktop.go` + `handler_claude_desktop.go` (the closest analog — dedicated MCP-only JSON file).

2. **Schema and round-trip shape.** Read the whole `mcp_config.json` into `map[string]any`, mutate the canonical entries inside `mcpServers`, write the map back. Matches `claude_code.go`'s round-trip approach for `~/.claude.json`. Non-canonical user entries (including stdio entries with `command`/`args`/`env`) are preserved untouched. This is the chosen approach — do NOT use a typed-struct mcpServers value type (Codex's pattern), which would silently drop fields on stdio entries because Antigravity's file mixes HTTP and stdio MCP servers in one map. The contract is "preserve every key we didn't touch."

   When constructing the canonical entries for write, define a small typed struct (e.g. `antigravityHTTPEntry`) with JSON tag `serverUrl` for clarity at the write site; serialize it back into the `map[string]any` for round-trip. This is a write-side convenience, not a read-side type.

3. **Paths.**
   - User scope → `~/.gemini/config/mcp_config.json`. Add an `AntigravityConfigPath()` helper in `detect.go` next to `CodexConfigPath()`.
   - **No directory scope.** `SupportedScopes()` returns `["user"]` (precedent: `ClaudeDesktopHandler`). M1 probed three candidate paths and none were read by agy 1.0.0; see the M1 verification writeup for the full negative evidence.

4. **Detection.** Pattern after `CodexHandler.Detect`: prefer `LookPath("agy")`; fall back to `os.Stat` on `~/.gemini/antigravity-cli/` OR `~/.gemini/antigravity/`. Either dir confirms Antigravity is installed (CLI installer creates the former; IDE installer creates the latter). Do NOT use `~/.gemini/config/` as the fallback signal — the older Gemini CLI may produce ambiguous evidence there.

5. **Scope translation.** **No change to `TranslateScope`** (`resolve.go:19`) for Antigravity — directory scope isn't supported. If a user passes `--scope directory` with `antigravity` as the tool, the existing `IsTiddlyScopeSupported` check returns false and the CLI errors out cleanly. No special-case logic needed.

6. **URL classifier integration (the key shared-helper change).** Before adding any Antigravity-side code, extend `extractServerURL` and `detectTransport` in `status.go` so they recognize `serverUrl` in addition to `url`. Internal check, no signature change, no call-site updates required. Preference order inside both functions: `serverUrl` first, then `url`. With that in place, `statusAntigravity` and the PAT extractor can route through the existing helpers exactly like Claude Code does — using `extractServerURL(serverMap)` and `detectTransport(serverMap)` against each entry in `mcpServers`.

   Antigravity stdio entries (community-template style) classify under `OtherServers` and stay there; we never claim ownership of stdio entries.

7. **PAT extraction.** `extractAllAntigravityTiddlyPATs` walks `mcpServers`, reads `headers.Authorization` via the existing `extractBearerToken` helper, and tags entries by URL classification — identical structure to `extractAllClaudeCodeTiddlyPATs` (NOT Codex, which uses its own typed `HTTPHeaders` field). Canonical-first sort via existing `sortCanonicalFirst`.

8. **Registration.** Append `&AntigravityHandler{}` to `DefaultHandlers()` (`handler.go:127`). Order determines display order in CLI output; place it last for now (alphabetical inside the "post-Anthropic" group: `codex`, then `antigravity`). Adjust if the team prefers alphabetical overall — the implementer can decide based on consistency.

9. **Constants.** No new `ServerType` constants — reuse `ServerContent` / `ServerPrompts`. No new canonical names — reuse `serverNameContent` / `serverNamePrompts`.

10. **Configure warnings.** Same plaintext-token warning as Codex/Claude Code (`"Tokens are stored in plaintext in <path>. Manage tokens at https://tiddly.me/settings."`). No restart prompt.

11. **Compile-time interface check.** Add `_ ToolHandler = (*AntigravityHandler)(nil)` in `handler.go:4`.

**Edge cases to handle (these mirror existing handler obligations — listed so the agent can confirm coverage):**

- Empty/missing `mcp_config.json` on first configure → create the file with mode `0600` and parent dir `0700`. Reuse `atomicWriteFileFunc`.
- Pre-existing entries with non-canonical names pointing at Tiddly URLs (multi-account case) → preserve untouched on both configure and remove.
- Canonical entry pointing at a non-Tiddly URL → refuse with the mismatch error unless `--force` is set (existing `--force` machinery applies; no per-handler work needed).
- A user with the Antigravity IDE running while `tiddly mcp configure` writes the file → IDE picks up the change via file watcher; no race we need to handle (we already write atomically).

**Definition of Done.**

- Unit tests parallel to `codex_test.go` and `claude_desktop_test.go` covering: configure-from-empty, configure-with-existing-non-canonical-entries (preservation including stdio entries with `command`/`args`/`env`), configure-with-mismatched-canonical-entry (refuse + force-override), remove (canonical-only), status (canonical vs OtherServers vs URL-match — must exercise both `MatchByName` and `MatchByURL` against `serverUrl` entries), PAT extraction across canonical and non-canonical `serverUrl` entries, dry-run diff with Bearer redaction, detection (binary present; binary absent + `~/.gemini/antigravity-cli/` present; binary absent + `~/.gemini/antigravity/` present; both absent — no false positive on a vanilla `~/.gemini/` that contains only legacy Gemini-CLI artifacts).
- **New unit tests for the shared-helper change** in `status_test.go` (or wherever existing helper tests live): `extractServerURL` returns the URL when only `serverUrl` is set; returns the URL when only `url` is set; prefers `serverUrl` when both are present; returns "" when neither is set; `mcp-remote` arg lookup still works. `detectTransport` returns `"http"` for `serverUrl`-only entries.
- Backup/atomic-write behavior identical to other handlers — verify via the shared test helpers if they exist; otherwise write a dedicated test.
- `mcp configure antigravity` and `mcp remove antigravity` run end-to-end against a real `~/.gemini/config/mcp_config.json` on the dev machine (manual smoke test — record in PR description). **The smoke-test verification must NOT use `agy -p` prose enumeration** — M1 demonstrated that agy's print-mode LLM hallucinates and is unreliable as a verification signal. Use one of these deterministic checks instead: (a) run a local Tiddly Content/Prompt MCP server (via `make content-mcp-server` / `make prompt-mcp-server`) pointed at by the canonical entries, invoke `agy`, and confirm the local server's stdout records a `POST /mcp HTTP/1.1 200 OK` connection; OR (b) open the Antigravity IDE settings panel and confirm both canonical entries appear with non-zero tool counts. See M1's verification writeup at the bottom of this file for the full rationale on why prose-based checks are unreliable.
- `make cli-verify` passes.
- No new docs in this milestone — that's M3.

---

### Milestone 3 — User-facing surfaces

**Goal & Outcome.** A user landing on `/app/settings/ai-integration` or `/docs/ai` can discover and follow Antigravity setup; the docs reflect Antigravity's scope mapping.

- The "Gemini CLI / Coming soon" card on `AIIntegration.tsx` is replaced with a working Antigravity card linking into the setup docs.
- The Compare-integrations table on the same page gains a fourth column for Antigravity.
- `docs/ai-integration.md` gains an Antigravity section in both the "Official Tool Documentation" group and the "Unified Scope Mapping" table.
- The command palette can find Antigravity setup via keywords like `antigravity`, `agy`, `gemini` (so users searching for the old name still land on the right page).

**Implementation Outline.**

1. **`frontend/src/pages/AIIntegration.tsx`** — replace the existing `Gemini CLI` "coming soon" entry in `AI_CLIENTS` with an Antigravity entry. Use the existing `GeminiIcon` (Google branding is shared) or add a dedicated `AntigravityIcon` if one exists; the implementer can decide based on what's in `components/icons/`. Add a fourth column to `comparisonRows` for Antigravity:
   - Environment: Terminal + Desktop (Antigravity ships both)
   - Config type: JSON
   - MCP Prompts: **false** (M1 verified Antigravity is a tools-only MCP client as of agy 1.0.0, verified 2026-05-19 — see verification results below). Add a code comment alongside the row anchoring the value to that agy version so a future maintainer has a reason to revisit when they bump the version.
   - Agent Skills: false (deferred; Antigravity has its own plugin model, our tar.gz skills don't apply)

   Decide whether to keep the table at 3 columns and add Antigravity as a 4th, or split into two tables — the implementer judges based on layout. The card list grid (`sm:grid-cols-2 lg:grid-cols-3`) already supports an extra entry.

2. **`frontend/src/components/AISetupWidget.tsx` — DO NOT skip this file.** It drives the actual setup flow on `/app/settings/ai-integration` and has the tool list hard-coded at many call sites. Required changes:
   - L18: replace `gemini-cli` in the `ClientType` union with `antigravity`. (The string `gemini-cli` should not appear anywhere after this milestone.)
   - L108, L287, L355: extend `CliToolType` from `['claude-desktop', 'claude-code', 'codex']` to include `'antigravity'`.
   - L431, L436, L441, L447, L452: per-tool branches that build config-file path lists and command strings — add Antigravity branches writing `~/.gemini/config/mcp_config.json` (user scope only — no directory branch, since M1 confirmed Antigravity has no directory scope).
   - L566–L568 and L1929/L1947/L1990: select-option dropdowns; add Antigravity.
   - L1464 `SkillsClientType` and the skills sub-flow (L1875–L1916): **leave Antigravity OUT** — skills support is explicitly out of scope. Antigravity must not appear in the skills tool selector.
   - L1947: the legacy `gemini-cli` branch in the manual setup tab is removed entirely (no replacement — Antigravity uses the same MCP CLI flow as other tools).

3. **`frontend/src/pages/settings/SettingsMCP.test.tsx`** — mirror existing claude-code/codex test cases for antigravity: tool-selection state, command-string generation (`tiddly mcp configure antigravity`), file-path generation. `frontend-verify` must pass.

4. **`docs/ai-integration.md`** — add an Antigravity section under "Official Tool Documentation":
   - Document the user-level path (`~/.gemini/config/mcp_config.json`, empirically verified — cite M1's transcript).
   - Document the schema difference (`serverUrl` instead of `url`).
   - Note that Antigravity has no upstream `mcp add` subcommand — our CLI writes the file directly, same as Claude Desktop and Codex.
   - Note that one config file is shared between the IDE and the `agy` CLI (cite M1's IDE-consistency finding).

   Add an Antigravity row to the "Unified Scope Mapping" table (user scope only — no directory column entry).

   **Add two "Known Limitations" entries**:
   - **No directory/project scope as of agy 1.0.0 (2026-05-19).** M1 probed three candidate paths (`<cwd>/mcp_config.json`, `<cwd>/.gemini/config/mcp_config.json`, `<cwd>/.antigravitycli/mcp_config.json`); none were read by agy. A future agy release may add directory scope — re-evaluate if a user surfaces a working path.
   - **MCP prompts not surfaced (tools-only client) as of agy 1.0.0 (2026-05-19).** Tiddly's prompt MCP server registers MCP-protocol prompts (via `@server.list_prompts()`), but Antigravity (CLI and IDE) ignores `prompts/*` RPCs. Tiddly prompt templates are still accessible via the `search_prompts` / `get_prompt_content` *tools*; they're just not invokable as slash-command-style MCP prompts the way Claude Desktop / Claude Code surface them.

5. **`docs/architecture.md`** — if it enumerates supported MCP tools anywhere, add Antigravity. (The agent should grep for `claude-desktop`, `claude-code`, `codex` and patch wherever the list appears.)

6. **`frontend/public/llms.txt`** — same: grep for the existing tool list and add Antigravity.

7. **`frontend/src/data/settingsRoutes.tsx` / `docsRoutes.tsx`** — extend the `searchText` for the AI integration / docs pages with keywords: `antigravity`, `agy`, `gemini` (so users searching for the now-deprecated "Gemini CLI" still land on Antigravity). Per AGENTS.md, optimize for keyword density, not prose.

8. **`README.md`** — if it lists supported AI tools, add Antigravity.

9. **`frontend/src/pages/docs/DocsCLIMCP.tsx`** and **`DocsAIFeatures.tsx`** — patch any tool-list mentions, scope-mapping examples, and configure-flag tables to include Antigravity.

**Definition of Done.**

- `frontend/src/pages/AIIntegration.tsx` shows Antigravity as a real, clickable card (not "Coming soon"). The comparison table includes it with `MCP Prompts: false` and a code comment anchoring the value to agy 1.0.0 / 2026-05-19.
- `AISetupWidget.tsx` includes Antigravity in every CLI-tool list, dropdown, and per-tool branch; the string `gemini-cli` no longer appears anywhere. No directory-scope branch for Antigravity. `SettingsMCP.test.tsx` covers Antigravity parallel to the existing tools.
- `docs/ai-integration.md` documents the Antigravity path, scope mapping, and schema specifics, plus the two Known Limitations entries (no directory scope; tools-only).
- Searching `antigravity`, `agy`, or `gemini` in the command palette surfaces the AI Integration settings page.
- `make frontend-verify` passes.
- A manual walk-through: from a clean browser session, navigate `/app/settings/ai-integration → Antigravity card → docs page → run the documented command → `agy -p "list mcp servers"` lists the Tiddly entries`. Record in PR description.

---

## Out of scope (explicit non-goals)

- Antigravity plugin/skills installation. The `agy plugin` model is git-install-based and structurally different from our skills tar.gz extraction. If users ask, that's a follow-up plan.
- Gemini CLI support. Deprecating for individual tiers June 18, 2026; we never shipped it; not building it.
- Migration tooling for users moving from Gemini CLI to Antigravity. We never managed their Gemini CLI config, so there's nothing on our side to migrate.
- Antigravity MCP OAuth flows. Our PATs are bearer tokens — same as the other three handlers.

## Commit/push policy

Per the user's standing instruction: do not commit, do not push, do not open a PR. Stop after each milestone for review.

## Verification results (Milestone 1, completed 2026-05-19)

Test setup: Antigravity CLI `agy` 1.0.0, IDE on macOS 25.3.0. Local content + prompt MCP servers running on ports 8001/8002 against the dev backend (DEV_MODE=true, so bearer tokens accept any non-empty value). Unique suffix used to disambiguate planted entries from anything the IDE/CLI might cache: `1712a0f1`. **The LLM enumeration approach the plan originally proposed turned out to be unreliable** — agy's print-mode LLM hallucinated server names that weren't actually loaded, and reported `chrome-devtools-plugin` (a hardcoded reference in its system context) regardless of mcp_config.json contents. The reliable signal turned out to be **HTTP connection logs from the target MCP server itself**: if the server records `POST /mcp HTTP/1.1 200 OK` from agy's PID, the config was loaded; if not, it wasn't. Use this method for any future agy MCP verification.

### Q1 — User-level config path & schema

**Answer:** `~/.gemini/config/mcp_config.json`, schema `mcpServers.<name>.serverUrl` + `headers.Authorization`.

Evidence:
- `cli-20260519_134319.log` line: `discovery.go:335] Failed to load JSON config file /Users/shanekercheval/.gemini/config/mcp_config.json: unexpected end of JSON input` — confirms this is the path agy probes at startup. (Triggered by my deliberately-empty file during Q1c.)
- Q1f probe: planted four schema variants in one file (`url` alone, `url`+`type:"http"`, `httpUrl`, `serverUrl`) all pointing at `http://localhost:8001/mcp`. Only the `serverUrl` entry produced connection log lines in the content MCP server's stdout: `INFO: 127.0.0.1:51748 - "POST /mcp HTTP/1.1" 200 OK`. The other three variants produced no connection attempts, confirming agy silently rejects them.

Other paths probed and **NOT** read by agy: `~/.gemini/antigravity-cli/mcp_config.json`, `~/.gemini/settings.json` (the legacy Gemini CLI MCP location).

### Q2 — Directory-scope path

**Answer:** No directory-scope path among the three candidates probed for agy 1.0.0. M2 ships `SupportedScopes()` returning `["user"]` (precedent: `ClaudeDesktopHandler`); M3 documents the limitation. Re-evaluate if a future agy release or a user surfaces a working path — the negative is over the three candidates probed, not all possible paths.

Evidence: Three candidates planted with uniquely-named entries pointing at `http://localhost:8002/mcp`. From each candidate directory, ran `agy ... -p "list MCP server names ..."`:

| Candidate path | Connection to 8002? | Verdict |
|---|---|---|
| `<cwd>/mcp_config.json` (community-template convention) | No | Not read |
| `<cwd>/.gemini/config/mcp_config.json` (mirror of user-level structure) | No | Not read |
| `<cwd>/.antigravitycli/mcp_config.json` (Antigravity's project marker dir) | No | Not read |

The prompts MCP server stdout showed zero new bytes after baseline across all three probes. Other plausible paths NOT probed: `~/.gemini/projects/<project-id>/mcp_config.json`, `<cwd>/.agy/mcp_config.json`, `<cwd>/gemini.json`. If any of these turn out to be readable in a later version, the user-only constraint can be lifted.

### Q3 — IDE↔CLI consistency

**Answer:** The IDE reads the same `~/.gemini/config/mcp_config.json` as the CLI. Confirmed.

Evidence: User restarted the Antigravity IDE with the unique-suffixed pair `tiddly_verify_1712a0f1_content` / `tiddly_verify_1712a0f1_prompts` planted in `~/.gemini/config/mcp_config.json`. The IDE's MCP settings panel showed both entries with their tools enumerated (58 tools and 51 tools respectively — screenshot captured but not committed).

### Q4 — MCP Prompts surfacing

**Answer:** As of agy 1.0.0 (verified 2026-05-19), the Antigravity IDE is a **tools-only** MCP client — it does NOT surface MCP-protocol prompts (the `prompts/list` / `prompts/get` RPCs). The agy CLI is inferred to behave the same way by code symmetry with the IDE. M3 comparison table sets "MCP Prompts: false" for Antigravity. `docs/ai-integration.md` adds a "Known Limitations" entry noting that Tiddly's prompt templates are accessible via Antigravity only through the `search_prompts` / `get_prompt_content` *tools*, not as slash-command-style MCP prompts (the way Claude Desktop and Claude Code surface them).

Evidence (ordered by strength):

1. **(Strong, empirical)** The Antigravity IDE settings panel showed `tiddly_verify_1712a0f1_prompts` with 51 entries under "**Mcp Tools**" — no separate "Mcp Prompts" section anywhere in the UI. The 51 entries are CRUD operations (`get_prompt_content`, `search_prompts`, `create_prompt`, etc.) — i.e., the Tiddly tools that *manage* prompt templates, NOT the prompt templates themselves. Falsifiable: if the IDE had surfaced server-provided prompts, they'd appear in a sibling section.
2. **(Strong, server-side)** The Tiddly prompt MCP server at `backend/src/prompt_mcp_server/server.py:149` registers `@server.list_prompts()`. Tiddly DOES expose MCP-protocol prompts — so the absence in the IDE is on the *client* side, not because Tiddly failed to publish anything.
3. **(Inference)** The agy CLI and Antigravity IDE share the same compiled MCP client (per Google's "Antigravity is a unified platform" architecture). What the IDE doesn't surface, agy CLI shouldn't either. Stronger empirical confirmation would require capturing agy's JSON-RPC request bodies and grepping for `prompts/list` calls — not done in this M1 run because the IDE evidence is already strong and the inference path is direct. If a future user reports prompts working in the agy CLI but not the IDE, this assumption is the one to revisit.
4. **(Weak, do not rely on)** `agy -p "List every MCP prompt … available"` returned "no prompts" despite connecting to both servers (proven by `POST /mcp HTTP/1.1 200 OK` on port 8002). This corroborates but does not itself prove the finding — the prose-LLM check is unreliable per the banner at the top of this section.

**DEV_MODE caveat.** Q4 ran against the local Tiddly backend in `DEV_MODE=true`, which only bypasses auth (the MCP server still serves the same `prompts/list` shape it would in prod). The tools-only finding is therefore not dev-mode-specific.

### Restored state

User's `~/.gemini/config/mcp_config.json` and `~/.gemini/settings.json` restored byte-for-byte from `m1-backup-*` snapshots taken at the start of M1, then the backup files deleted. All test directories under `/tmp/m1-*` and probe output files (`/tmp/agy-q*.out`) removed. Local content + prompt MCP servers (ports 8001/8002) and the API on 8000 left running — the user started those before M1 began and may want to keep them up for M2 smoke testing.

### Implications for M2 / M3 (now folded into the milestone bodies above)

The M2/M3 sections at the top of this plan have been normalized to reflect M1's findings — no more conditional "if M1 found a path" language. This subsection summarizes what changed so a reviewer can spot-check that the milestone bodies stay in sync.

- **M2 step 3 (Paths):** Directory scope is permanently dropped. `SupportedScopes()` returns `["user"]`.
- **M2 step 4 (Detection):** Unchanged.
- **M2 step 5 (Scope translation):** No `TranslateScope` case added for Antigravity — directory scope isn't supported; existing `IsTiddlyScopeSupported` returns false for `directory + antigravity` and the CLI errors cleanly.
- **M2 step 6 (URL classifier integration):** `extractServerURL` / `detectTransport` extended to recognize both `serverUrl` and `url`, preference order `serverUrl` > `url`. **Tests in `status_test.go` must keep existing `url` support intact** (Claude Code and Claude Desktop write `url`; rejecting it there would regress those handlers) — verify both fields work and the preference order. The Antigravity-specific tests must verify the *write side*: when configure creates a canonical entry, the JSON key emitted is `serverUrl` — never `url` or `httpUrl`. Do NOT add tests asserting the shared helper rejects `url`/`httpUrl` — that would break Claude Code.
- **M2 DoD (smoke test):** Manual smoke test does NOT use `agy -p` prose enumeration (M1 showed this is unreliable). Use either local-MCP-server connection logs or the IDE settings panel — see DoD above.
- **M3 comparison table:** `MCP Prompts: false` for Antigravity. Code comment alongside the row anchoring the value to agy 1.0.0 / 2026-05-19.
- **M3 `docs/ai-integration.md`:** Two "Known Limitations" entries (no directory scope as of agy 1.0.0; MCP prompts not surfaced as of agy 1.0.0). Both dated; both phrased so a future maintainer has a reason to revisit when bumping the agy version.
