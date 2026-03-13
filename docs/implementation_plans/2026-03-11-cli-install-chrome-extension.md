# CLI Chrome Extension Install Command

> **Status: ON HOLD** — See Appendix A for findings that question whether a CLI command adds meaningful value over manual installation. Revisit later.

## Overview

Add a `tiddly chrome-ext install` command that installs the Tiddly Chrome extension via Chrome's external extension mechanism and optionally generates a PAT for the user to paste into the extension settings.

**Windows is out of scope** — macOS and Linux only.

### Flow

1. CLI writes a JSON file to Chrome's external extensions directory (OS-specific path)
2. Tells user to restart Chrome to complete installation
3. Asks if they want to generate a PAT for the extension
4. If yes, creates a PAT and prints it for the user to copy into the extension settings page

### Chrome External Extensions Reference

Read Chrome's external extension docs before implementing:
- https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions

**macOS:** `~/Library/Application Support/Google/Chrome/External Extensions/<extension-id>.json`
**Linux:** `~/.config/google-chrome/External Extensions/<extension-id>.json`

The JSON file contents:
```json
{
  "external_update_url": "https://clients2.google.com/service/update2/crx"
}
```

**Chrome Extension ID:** `npjlfgkihebhandkknldnjlcdmcpomkc`

---

## Milestone 1: Core Install Command (macOS + Linux)

### Goal & Outcome

A working `tiddly chrome-ext install` command that:
- Detects the user's OS and writes the external extension JSON to the correct path
- Supports macOS and Linux (JSON file approach); prints an error on unsupported OSes
- Tells the user to restart Chrome
- Asks if they want to generate a PAT (requires OAuth login)
- If yes, creates the PAT via existing `client.CreateToken()` with name `chrome-extension-<random>` (6-7 random alphanumeric characters, matching the convention of other generated PATs) and prints it
- If no, tells them how to generate one later (`tiddly tokens create "chrome-extension"`)
- Is idempotent — running again when already installed prints a message but doesn't error
- Handles non-interactive mode (no prompt, just installs and prints instructions)

### Implementation Outline

**New file: `cli/cmd/chrome_ext.go`**

Parent command `tiddly chrome-ext` with subcommand `install`. Follow the existing pattern from `tokens.go` — factory function `newChromeExtCmd()` returning `*cobra.Command`, registered in `root.go`.

The install command should:

1. Detect `runtime.GOOS` — for `darwin` and `linux`, write the JSON file. For anything else, return an error saying the OS is not supported.
2. Build the target directory path based on OS. Create the directory if it doesn't exist (`os.MkdirAll`).
3. Check if the JSON file already exists. If it does, inform the user ("Chrome extension already configured") but continue to the PAT prompt.
4. Write the JSON file with `external_update_url`.
5. Print: "Chrome extension configured. Restart Chrome to complete installation."
6. Check if stdin is a TTY (same pattern as `confirmDelete` in `tokens.go`). If interactive:
   - Prompt: "Would you like to generate a PAT for the extension? [Y/n] "
   - If yes (default): resolve OAuth token via `resolveOAuthToken()`, call `client.CreateToken()` with a generated name like `chrome-extension-a1b2c3` (6-7 random lowercase alphanumeric chars), print the token and instructions to paste it into the extension settings page (Options → Personal Access Token)
   - If no: print `tiddly tokens create "chrome-extension"` as a reminder
7. If non-interactive (not a TTY): skip the prompt, just print the install message and PAT instructions

**PAT name generation:** Use `crypto/rand` to generate 6-7 random lowercase alphanumeric characters, prefixed with `chrome-extension-`. Example: `chrome-extension-a1b2c3`.

**Flags:**
- `--pat` — auto-generate a PAT without prompting (useful for scripting)
- `--skip-pat` — skip PAT prompt entirely

**Register in `root.go`:**
```go
rootCmd.AddCommand(newChromeExtCmd())
```

**Constants** — define the Chrome extension ID and Chrome Web Store update URL as constants in the file (not buried in logic):
```go
const (
    chromeExtensionID = "npjlfgkihebhandkknldnjlcdmcpomkc"
    chromeUpdateURL   = "https://clients2.google.com/service/update2/crx"
)
```

**Path resolution** — extract into a helper function `chromeExternalExtDir(goos string) (string, error)` that returns the correct path per OS:
- `darwin`: `~/Library/Application Support/Google/Chrome/External Extensions/`
- `linux`: `~/.config/google-chrome/External Extensions/`
- other: return error

Use `os.UserHomeDir()` to resolve `~`. Accept `goos` as a parameter so tests can verify path logic without depending on the host OS.

Consider adding a `ChromeExtDir` field to `AppDeps` (or accept an override via a hidden flag) so tests can point to a temp directory instead of the real Chrome path.

### Testing Strategy

Follow the existing test patterns in `tokens_test.go` — use `testutil.NewMockAPI`, `setupTestDeps`, `testutil.ExecuteCmd`.

**Unit tests:**

- `TestChromeExtInstall__writes_json_file` — Use a temp dir, verify the JSON file is created with correct contents and correct filename (`<extension-id>.json`)
- `TestChromeExtInstall__idempotent` — Run twice, second run should succeed and print "already configured" message
- `TestChromeExtInstall__creates_directory_if_missing` — Target dir doesn't exist yet, command creates it
- `TestChromeExtInstall__pat_flag_creates_token` — With `--pat` flag, mock API returns token, verify token is printed and PAT name matches `chrome-extension-<random>` pattern
- `TestChromeExtInstall__pat_flag_requires_oauth` — With `--pat` flag but only PAT credentials, verify helpful error about needing OAuth login
- `TestChromeExtInstall__skip_pat_flag` — With `--skip-pat`, verify no PAT prompt or creation
- `TestChromeExtInstall__non_interactive_skips_prompt` — Non-TTY stdin, verify no prompt but install succeeds
- `TestChromeExtInstall__unsupported_os` — Pass unsupported OS to path helper, verify error message
- `TestChromeExternalExtDir__darwin` — Verify correct macOS path
- `TestChromeExternalExtDir__linux` — Verify correct Linux path
- `TestChromeExternalExtDir__unsupported` — Verify error for unsupported OS

---

## Milestone 2: Uninstall Command

### Goal & Outcome

- `tiddly chrome-ext uninstall` removes the external extension JSON file
- Does NOT uninstall the extension from Chrome — just removes the external install trigger
- Warns about any PATs that may have been created for the extension (similar to MCP uninstall pattern)

### Implementation Outline

- Remove the JSON file from the external extensions directory
- Print confirmation message
- Remind user that the extension itself must be removed from Chrome manually if desired
- Consider warning about orphaned PATs with names matching `chrome-extension-*` (list tokens, filter by name prefix, warn user)

### Testing Strategy

- `TestChromeExtUninstall__removes_file` — Verify JSON file is deleted
- `TestChromeExtUninstall__file_not_found` — Graceful handling when file doesn't exist (already uninstalled)
- `TestChromeExtUninstall__warns_about_pats` — Verify warning about potential orphaned PATs

---

## Appendix A: Review Findings — Is This Worth Building?

Research into Chrome's external extension mechanism revealed several issues that significantly reduce the value of a CLI install command.

### Finding 1: macOS Requires Manual Confirmation

Chrome's docs state: "Windows and macOS users will have to enable the extension using the following confirmation dialog." The JSON file triggers Chrome to show a prompt, but the user must still manually confirm. The planned message "Restart Chrome to complete installation" is misleading — the actual flow is:

1. CLI writes JSON file
2. User restarts Chrome
3. Chrome shows confirmation dialog
4. User clicks "Enable"

This is roughly the same number of user actions as just opening the Chrome Web Store page and clicking "Add to Chrome."

### Finding 2: Linux Paths Require Root

Chrome's documented Linux paths for external extensions are:
- `/opt/google/chrome/extensions/`
- `/usr/share/google-chrome/extensions/`

Both are system-level and require root/sudo. The plan's `~/.config/google-chrome/External Extensions/` path does not exist in Chrome's documentation and would not be read by Chrome. This means Linux support either requires `sudo` (bad UX) or doesn't work.

Source: https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions

### Finding 3: Uninstalled Extensions Get Blocklisted

If a user manually uninstalls an externally installed extension, Chrome blocklists it and will not reinstall it via the JSON file mechanism. Running `tiddly chrome-ext install` again would silently fail.

### Finding 4: PAT Naming Convention

The existing MCP flow uses a `cli-mcp-` prefix for generated PATs (e.g., `cli-mcp-claude-code-content-a1b2c3`) with safety guards in `DeleteTokensByPrefix()` that check for this prefix. If this command is built, PAT names should follow a similar convention (e.g., `cli-chrome-ext-<hex>`) for consistent orphan detection.

### Conclusion

Given that macOS requires manual confirmation anyway, the JSON file approach provides almost no UX advantage over simply opening the Chrome Web Store page. The CLI command's real value reduces to "open a URL + generate a PAT" — which may or may not justify a dedicated command.

**Options if revisited:**

1. **Drop it** — document "install from Chrome Web Store, run `tiddly tokens create`"
2. **Minimal command** — `tiddly chrome-ext install` opens the store page via `open`/`xdg-open` + offers PAT generation (~20 lines of logic)
3. **Full JSON approach** — as planned above, but with corrected Linux paths (requiring sudo) and corrected macOS messaging
