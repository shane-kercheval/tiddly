# Tip candidates — cli (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section; `D#` = draft additions surfaced during review.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Install with one curl command | drop | Already in Settings → AI Integration instructions. Replaced with D1/D2 high-level workflow tips that emphasize "this is possible and easy" rather than the specific command. |
| 2 | `tiddly status` for one-shot health check | 25 | Real proactive command; not part of standard install/setup. |
| 3 | Auto-configure MCP (`tiddly mcp configure`) | 15 | Command-level companion to D1 — the actual command behind the high-level integration workflow. **Cross-category** with `mcp`. |
| 4 | Preview MCP config changes with `--dry-run` | 35 | Companion to #3; only useful once the user has run it. |
| 5 | Headless login `--token` | drop | Supported but not standard setup. |
| 6 | Export everything to JSON for backup or migration | 20 | Real proactive workflow (backup-anxiety tip; also useful for ad-hoc scripting). |
| 7 | Sync prompts as agent skills (`tiddly skills configure`) | 15 | Command-level companion to D2. Especially important for Codex users since Codex doesn't support MCP-style prompt invocation; skills are the workaround. **Cross-category** with `prompts`, `mcp`. |
| 8 | Per-directory MCP/skills with `--scope directory` | 25 | Real workflow for separating work/personal accounts or per-project AI configurations. |
| 9 | Use `--servers content` or `--servers prompts` to install one | 35 | Modifier flag for #3. |
| 10 | Revoke MCP tokens with `--delete-tokens` | drop | Too much detail; already in instructions. |
| 11 | Generate scoped PATs from the CLI with expirations | 25 | Real workflow for CI/scripting. **Cross-category** with `account` (PATs). |
| 12 | Enable shell tab completion | drop | Generic CLI hygiene, not Tiddly-specific. |
| 13 | Override API URL or token per-command | drop | Edge case for testing/staging. |
| 14 | Self-update with `tiddly update` | drop | Auto-check notifier already runs; the command itself is reactive, not proactive. |
| S1 | Pipe `tiddly export` to `jq` | drop | Generic jq usage; teaches jq more than Tiddly. |
| S2 | `tiddly skills list --tags ""` | drop | Niche; only relevant during initial skills curation. |
| S3 | Force file-based credential storage `--keyring=file` | drop | Hidden flag, intentionally. |
| S4 | Point at staging Auth0 with env vars | drop | Aimed at Tiddly developers. |
| S5 | `--path` to audit a different project | drop | Narrow audience. |
| **D1** (draft) | Connect your AI tool to your Tiddly bookmarks and notes | **8** | Workflow tip replacing #1. **Cross-category** with `mcp`, `bookmarks`, `notes`. Primary home `cli` for now; flip to `mcp` at consolidation if that reads better. |
| **D2** (draft) | Use your Tiddly prompts inside Claude or Codex | **5** | Workflow tip; user flagged "use prompts" as one of the most important workflows. **Cross-category** with `mcp`, `prompts`. |

## Final keepers (preserved details from the agent file, plus drafts)

### D2 — Use your Tiddly prompts inside Claude or Codex — priority 5 (draft) — cross-category: mcp, prompts

The same **Settings → AI Integration** page that connects your bookmarks/notes also lets you call your prompt library from inside your AI assistant. The mechanism varies by tool:

- **Claude Code & Claude Desktop**: prompts arrive via MCP. Type `/<prompt-name>` in Claude Code to invoke a saved prompt; Claude Desktop surfaces them in the prompt selector.
- **Codex**: doesn't support MCP-style prompt invocation the same way, so prompts get exported as **Agent Skills** via `tiddly skills configure`. Trigger them by name from inside Codex.

Your prompt library becomes a callable function library inside whichever AI assistant you use.

- Tags: workflow | new-user
- minTier: tbd (verify whether MCP/skills config is gated)

**Refinement notes**:
- Verify the exact invocation patterns per tool (the Codex story is the load-bearing one).
- Possibly merge with #7 at consolidation, or keep separate (high-level workflow + command-level command).
- Decide canonical home: `cli`, `mcp`, or `prompts`.

### D1 — Connect your AI tool to your Tiddly bookmarks and notes — priority 8 (draft) — cross-category: mcp, bookmarks, notes

Open **Settings → AI Integration**, pick your AI tool (Claude Desktop, Claude Code, Codex), and run the command shown. Your AI assistant can then read, search, and edit your bookmarks and notes directly — no copy-paste, no exporting. Ask Claude things like *"find that article I saved about transformers"* or *"fix the typo in my last meeting note"* and it goes straight at your library.

The workflow: **Settings → AI Integration → choose tool → run the displayed `tiddly mcp configure` command → use your AI tool normally.**

- Tags: workflow | new-user
- minTier: tbd

**Refinement notes**:
- Possibly merge with #3 at consolidation, or keep separate (D1 = "this is possible and easy"; #3 = "here's the literal command").
- Sample tasks ("find that article", "fix the typo") are illustrative; refine to the most representative use cases.
- Decide canonical home: `cli`, `mcp`, `bookmarks`/`notes`.

### #3 — Auto-configure MCP for every detected AI tool in one command — priority 15 — cross-category: mcp

Run `tiddly mcp configure` with no arguments. The CLI auto-detects Claude Desktop, Claude Code, and Codex, creates a dedicated PAT per tool/server, and writes both `tiddly_notes_bookmarks` and `tiddly_prompts` entries. Existing non-CLI-managed entries (e.g. `work_prompts`) are preserved untouched.

- Reference: `cli/cmd/mcp.go:50`
- Tags: feature | new-user

### #7 — Sync your prompts as agent skills with `tiddly skills configure` — priority 15 — cross-category: prompts, mcp

Tag prompts with `skill` in Tiddly, then run `tiddly skills configure` to auto-detect Claude Code/Codex/Claude Desktop and write each prompt as a `SKILL.md` file. The agent can then auto-invoke them based on context, or you can call them with `/skill-name` (Claude Code) or `$skill-name` (Codex).

Especially important for Codex, which doesn't support MCP-style prompt invocation — skills are the canonical way to trigger your saved prompts there.

- Reference: `cli/cmd/skills.go:34`
- Tags: workflow | power-user

### #6 — Export everything to JSON for backup or migration — priority 20

`tiddly export --output backup.json` streams every bookmark, note, and prompt to a single JSON file with low memory use. Use `--types bookmark,note` to scope, or `--include-archived` to grab archived items too. Exports go to stdout by default — pipe straight into `jq` or another tool.

- Reference: `cli/cmd/export.go:13`
- Tags: workflow | power-user

### #2 — Run `tiddly status` for a one-shot health check — priority 25

`tiddly status` prints CLI version, login status, API latency, content counts (bookmarks/notes/prompts fetched in parallel), MCP server config across user and directory scopes, and installed skills — all read-only, no files modified. Use `--path /path/to/project` to inspect a different directory's project-scoped config.

- Reference: `cli/cmd/status.go:25`
- Tags: feature | new-user

### #8 — Per-directory MCP/skills configuration with `--scope directory` — priority 25

Run `tiddly mcp configure --scope directory` (or the same flag on `skills configure`) inside a project to restrict Tiddly access to that project only. Claude Code writes to `~/.claude.json` under the project key; Codex writes `.codex/config.toml` in the cwd; skills land in `.claude/skills/` or `.agents/skills/`. Useful for keeping work and personal accounts separate.

- Reference: `cli/cmd/mcp.go:207`
- Tags: feature | power-user

### #11 — Generate scoped PATs from the CLI with expirations — priority 25 — cross-category: account

`tiddly tokens create "CI Pipeline" --expires 90` creates a 90-day PAT and prints it once — copy it immediately. List with `tiddly tokens list`, delete with `tiddly tokens delete <id>`. Token management requires browser-based OAuth login; PAT auth can't manage tokens.

- Reference: `cli/cmd/tokens.go:94`
- Tags: feature | power-user

### #4 — Preview MCP config changes with `--dry-run` — priority 35

Add `--dry-run` to `tiddly mcp configure` to see the exact diff (entries added, tokens that would be created) without writing any files or hitting the token API. Pair with `--force` to preview an overwrite of a mismatched CLI-managed entry.

- Reference: `cli/cmd/mcp.go:206`
- Tags: feature | power-user

### #9 — Use `--servers content` or `--servers prompts` to install just one — priority 35

By default `tiddly mcp configure` installs both servers. Pass `--servers content` for bookmarks/notes only or `--servers prompts` for prompts only. Same flag on `tiddly mcp remove --servers content --delete-tokens` cleans up just one server's PAT.

- Reference: `cli/cmd/mcp.go:209`
- Tags: feature | power-user

## Cross-category tracking

- `cli:3` ↔ `mcp` — auto-configure MCP. Likely surfaced from a different angle by the `mcp` agent; pick canonical at consolidation.
- `cli:7` ↔ `prompts` (the `skill` tag is a prompts feature) and ↔ `mcp` (the install destination).
- `cli:11` ↔ `account` — PATs.
- `cli:D1` ↔ `mcp`, `bookmarks`, `notes` — high-level integration workflow for content.
- `cli:D2` ↔ `mcp`, `prompts` — high-level integration workflow for prompts. Top-tier priority per user direction.
