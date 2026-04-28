# Tip candidates — cli

## Strong candidates (strongest first)

### Install the Tiddly CLI with one curl command
- Description: Run `curl -fsSL https://raw.githubusercontent.com/shane-kercheval/tiddly/main/cli/install.sh | sh` to install the `tiddly` binary. Auto-detects OS/arch, verifies the SHA256 checksum, and drops the binary into `/usr/local/bin` (or `~/.local/bin` if not writable). Override the destination with `INSTALL_DIR=/custom/path`.
- Reference: cli/README.md:170; cli/install.sh
- Tags: feature | new-user

### Run `tiddly status` for a one-shot health check
- Description: `tiddly status` prints CLI version, login status, API latency, content counts (bookmarks/notes/prompts fetched in parallel), MCP server config across user and directory scopes, and installed skills — all read-only, no files modified. Use `--path /path/to/project` to inspect a different directory's project-scoped config.
- Reference: cli/cmd/status.go:25
- Tags: feature | new-user

### Auto-configure MCP for every detected AI tool in one command
- Description: Run `tiddly mcp configure` with no arguments. The CLI auto-detects Claude Desktop, Claude Code, and Codex, creates a dedicated PAT per tool/server, and writes both `tiddly_notes_bookmarks` and `tiddly_prompts` entries. Existing non-CLI-managed entries (e.g. `work_prompts`) are preserved untouched.
- Reference: cli/cmd/mcp.go:50; frontend/src/pages/docs/DocsCLIMCP.tsx:20
- Tags: feature | new-user

### Preview MCP config changes with `--dry-run`
- Description: Add `--dry-run` to `tiddly mcp configure` to see the exact diff (entries added, tokens that would be created) without writing any files or hitting the token API. Pair with `--force` to preview an overwrite of a mismatched CLI-managed entry.
- Reference: cli/cmd/mcp.go:206
- Tags: feature | power-user

### Authenticate headless environments with `tiddly login --token`
- Description: Skip the OAuth browser flow in CI/CD or SSH sessions by passing a Personal Access Token: `tiddly login --token bm_xxx`. The CLI validates the `bm_` prefix, verifies against the API, and stores the PAT in the system keyring (or a 0600 file fallback). Generate PATs at tiddly.me/app/settings/tokens.
- Reference: cli/cmd/login.go:45
- Tags: feature | power-user

### Export everything to JSON for backup or migration
- Description: `tiddly export --output backup.json` streams every bookmark, note, and prompt to a single JSON file with low memory use. Use `--types bookmark,note` to scope, or `--include-archived` to grab archived items too. Exports go to stdout by default — pipe straight into `jq` or another tool.
- Reference: cli/cmd/export.go:13
- Tags: workflow | power-user

### Sync your prompts as agent skills with `tiddly skills configure`
- Description: Tag prompts with `skill` in Tiddly, then run `tiddly skills configure` to auto-detect Claude Code/Codex/Claude Desktop and write each prompt as a `SKILL.md` file. The agent can then auto-invoke them based on context, or you can call them with `/skill-name` (Claude Code) or `$skill-name` (Codex).
- Reference: cli/cmd/skills.go:34; frontend/src/pages/docs/DocsCLISkills.tsx:28
- Tags: workflow | power-user

### Per-directory MCP/skills configuration with `--scope directory`
- Description: Run `tiddly mcp configure --scope directory` (or the same flag on `skills configure`) inside a project to restrict Tiddly access to that project only. Claude Code writes to `~/.claude.json` under the project key; Codex writes `.codex/config.toml` in the cwd; skills land in `.claude/skills/` or `.agents/skills/`. Useful for keeping work and personal accounts separate.
- Reference: cli/cmd/mcp.go:207; cli/cmd/skills.go:162
- Tags: feature | power-user

### Use `--servers content` or `--servers prompts` to install just one server
- Description: By default `tiddly mcp configure` installs both servers. Pass `--servers content` for bookmarks/notes only or `--servers prompts` for prompts only. Same flag on `tiddly mcp remove --servers content --delete-tokens` cleans up just one server's PAT.
- Reference: cli/cmd/mcp.go:209
- Tags: feature | power-user

### Revoke MCP tokens cleanly with `tiddly mcp remove --delete-tokens`
- Description: `tiddly mcp remove claude-code --delete-tokens` deletes the CLI-managed entries from the config and revokes the matching PATs server-side in one step. The CLI warns if a PAT is also referenced by a preserved entry (so you don't unintentionally break a multi-account setup) and notes any orphaned `cli-mcp-*` tokens left behind.
- Reference: cli/cmd/mcp.go:280
- Tags: feature | power-user

### Generate scoped PATs from the CLI with expirations
- Description: `tiddly tokens create "CI Pipeline" --expires 90` creates a 90-day PAT and prints it once — copy it immediately. List with `tiddly tokens list`, delete with `tiddly tokens delete <id>`. Token management requires browser-based OAuth login; PAT auth can't manage tokens.
- Reference: cli/cmd/tokens.go:94
- Tags: feature | power-user

### Enable shell tab completion
- Description: Add `source <(tiddly completion zsh)` to your `~/.zshrc` (or the `bash`/`fish` equivalents) for tab-completion of subcommands, flags, and tool names like `claude-code`, `codex`. Cuts down on typos in long commands like `tiddly mcp configure --servers content`.
- Reference: cli/cmd/completion.go:9
- Tags: feature | power-user

### Override the API URL or token per-command
- Description: Every command accepts `--token bm_...` and `--api-url https://...` for one-off overrides without changing your stored credentials. Token resolution order: `--token` flag > `TIDDLY_TOKEN` env > stored PAT > stored OAuth (auto-refreshed). Useful for testing against staging or running as a different user temporarily.
- Reference: cli/cmd/root.go:130; cli/internal/auth/token_manager.go:36
- Tags: feature | power-user

### Self-update with `tiddly update`
- Description: Run `tiddly update` to fetch the latest GitHub release, verify its SHA256 checksum, and atomically replace the running binary. The CLI also runs a non-blocking background update check (≤ once per 24h) and notifies on stderr when a new version exists. Disable with `tiddly config set update_check false` or `TIDDLY_NO_UPDATE_CHECK=1`.
- Reference: cli/cmd/update.go:14; cli/README.md:184
- Tags: feature | power-user

## Speculative

### Pipe `tiddly export` to `jq` for ad-hoc queries
- Description: Because `tiddly export` streams JSON to stdout (with progress suppressed), you can do things like `tiddly export --types bookmark | jq '.bookmarks[] | select(.tags | contains(["read-later"]))'` to script over your library without writing intermediate files.
- Reference: cli/cmd/export.go:62
- Tags: workflow | power-user
- Hesitation: jq usage is generic — tip risks teaching jq instead of Tiddly.

### Use `tiddly skills list --tags ""` to see every prompt as a candidate skill
- Description: The default `--tags skill` filter only shows prompts you've intentionally marked. Pass `--tags ""` to list every prompt — handy when deciding which existing prompts deserve the `skill` tag for export.
- Reference: cli/cmd/skills.go:169
- Tags: feature | power-user
- Hesitation: Niche; mostly relevant during initial skills curation.

### Force file-based credential storage in headless boxes
- Description: On VMs, containers, and SSH sessions where the system keyring isn't unlocked, the CLI logs a "keyring unavailable" warning and falls back to `~/.config/tiddly/credentials` at mode 0600. Pass `--keyring=file` to opt into file storage explicitly and silence the warning.
- Reference: cli/cmd/root.go:79; cli/cmd/login.go:150
- Tags: feature | power-user
- Hesitation: The flag is hidden (`MarkHidden("keyring")`) — surfacing it as a tip might be intentional anti-discoverability.

### Point the CLI at staging Auth0 with `TIDDLY_AUTH0_*` env vars
- Description: Override the OAuth tenant per-invocation: `TIDDLY_AUTH0_DOMAIN=... TIDDLY_AUTH0_CLIENT_ID=... TIDDLY_AUTH0_AUDIENCE=... tiddly login` lets you test against a dev tenant without rebuilding.
- Reference: cli/README.md:271
- Tags: feature | power-user
- Hesitation: Aimed at Tiddly developers, not end users.

### Use `--path` on `status` and `mcp status` to audit a different project
- Description: Both `tiddly status --path ~/code/work-project` and `tiddly mcp status --path ...` inspect directory-scoped MCP configs without `cd`-ing first. Useful for auditing several projects from one terminal.
- Reference: cli/cmd/status.go:122; cli/cmd/mcp.go:275
- Tags: feature | power-user
- Hesitation: Narrow audience; most users only audit their cwd.
