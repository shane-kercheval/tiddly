# CLI Chrome Extension Install Command

## Overview

Add a `tiddly extension install` command that installs the Tiddly Chrome extension via Chrome's external extension mechanism and optionally generates a PAT for the user to paste into the extension settings.

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
**Windows:** Registry key at `HKEY_CURRENT_USER\Software\Google\Chrome\Extensions\<extension-id>` with string value `update_url` = `https://clients2.google.com/service/update2/crx`

The JSON file contents (macOS/Linux):
```json
{
  "external_update_url": "https://clients2.google.com/service/update2/crx"
}
```

**Chrome Extension ID:** `npjlfgkihebhandkknldnjlcdmcpomkc`

---

## Milestone 1: Core Install Command (macOS + Linux)

### Goal & Outcome

A working `tiddly extension install` command that:
- Detects the user's OS and writes the external extension JSON to the correct path
- Supports macOS and Linux (JSON file approach)
- Tells the user to restart Chrome
- Asks if they want to generate a PAT (requires OAuth login)
- If yes, creates the PAT via existing `client.CreateToken()` and prints it
- If no, tells them how to generate one later (`tiddly tokens create "Chrome Extension"`)
- Is idempotent — running again when already installed prints a message but doesn't error
- Handles non-interactive mode (no prompt, just installs and prints instructions)

### Implementation Outline

**New file: `cli/cmd/extension.go`**

Parent command `tiddly extension` with subcommand `install`. Follow the existing pattern from `tokens.go` — factory function `newExtensionCmd()` returning `*cobra.Command`, registered in `root.go`.

The install command should:

1. Detect `runtime.GOOS` — for `darwin` and `linux`, write the JSON file. For `windows`, print an error saying Windows is not yet supported (or implement registry — see Milestone 2).
2. Build the target directory path based on OS. Create the directory if it doesn't exist (`os.MkdirAll`).
3. Check if the JSON file already exists. If it does, inform the user ("Chrome extension already configured") but continue to the PAT prompt.
4. Write the JSON file with `external_update_url`.
5. Print: "Chrome extension configured. Restart Chrome to complete installation."
6. Check if stdin is a TTY (same pattern as `confirmDelete` in `tokens.go`). If interactive:
   - Prompt: "Would you like to generate a PAT for the extension? [Y/n] "
   - If yes (default): resolve OAuth token via `resolveOAuthToken()`, call `client.CreateToken()` with name `"Chrome Extension"`, print the token and instructions to paste it into the extension settings page (Options → Personal Access Token)
   - If no: print `tiddly tokens create "Chrome Extension"` as a reminder
7. If non-interactive (not a TTY): skip the prompt, just print the install message and PAT instructions

**Flags:**
- `--pat` — auto-generate a PAT without prompting (useful for scripting)
- `--skip-pat` — skip PAT prompt entirely

**Register in `root.go`:**
```go
rootCmd.AddCommand(newExtensionCmd())
```

**Constants** — define the Chrome extension ID and Chrome Web Store update URL as constants in the file (not buried in logic):
```go
const (
    chromeExtensionID = "npjlfgkihebhandkknldnjlcdmcpomkc"
    chromeUpdateURL   = "https://clients2.google.com/service/update2/crx"
)
```

**Path resolution** — extract into a helper function `chromeExternalExtDir() (string, error)` that returns the correct path per OS:
- `darwin`: `~/Library/Application Support/Google/Chrome/External Extensions/`
- `linux`: `~/.config/google-chrome/External Extensions/`
- other: return error

Use `os.UserHomeDir()` to resolve `~`.

### Testing Strategy

Follow the existing test patterns in `tokens_test.go` — use `testutil.NewMockAPI`, `setupTestDeps`, `testutil.ExecuteCmd`.

**Unit tests:**

- `TestExtensionInstall__writes_json_file` — Use a temp dir, verify the JSON file is created with correct contents and correct filename (`<extension-id>.json`)
- `TestExtensionInstall__idempotent` — Run twice, second run should succeed and print "already configured" message
- `TestExtensionInstall__creates_directory_if_missing` — Target dir doesn't exist yet, command creates it
- `TestExtensionInstall__pat_flag_creates_token` — With `--pat` flag, mock API returns token, verify token is printed
- `TestExtensionInstall__pat_flag_requires_oauth` — With `--pat` flag but only PAT credentials, verify helpful error about needing OAuth login
- `TestExtensionInstall__skip_pat_flag` — With `--skip-pat`, verify no PAT prompt or creation
- `TestExtensionInstall__non_interactive_skips_prompt` — Non-TTY stdin, verify no prompt but install succeeds
- `TestExtensionInstall__unsupported_os` — Mock `runtime.GOOS` equivalent (use the path helper), verify error message

**Testing the OS-specific paths:** The path helper `chromeExternalExtDir()` should accept the OS as a parameter (or use an interface/function injection) so tests can verify path logic without running on each OS. Alternatively, accept a `baseDir` override for testing, similar to how `ConfigDir` is injected in `AppDeps`.

Consider adding an `ExtensionDir` field to `AppDeps` (or a simpler approach: accept it as a parameter/option on the command) so tests can point to a temp directory instead of the real Chrome path.

---

## Milestone 2: Windows Support

### Goal & Outcome

- `tiddly extension install` works on Windows by writing to the Windows registry
- Same PAT flow as macOS/Linux

### Implementation Outline

On Windows, Chrome uses the registry instead of a JSON file:

- Key: `HKEY_CURRENT_USER\Software\Google\Chrome\Extensions\<extension-id>`
- String value: `update_url` = `https://clients2.google.com/service/update2/crx`

Use Go's `golang.org/x/sys/windows/registry` package (only imported on Windows via build tags).

**Build tags:** Create `extension_windows.go` with `//go:build windows` and `extension_unix.go` with `//go:build !windows` to separate the OS-specific installation logic. Both should implement the same interface/function signature.

**Idempotency:** Check if the registry key already exists before writing.

### Testing Strategy

- `TestExtensionInstall__windows_registry` — If running on Windows (or via abstraction), verify registry key creation
- The abstraction layer (interface for "install the extension") should be testable with a mock on any OS
- Test idempotency for the registry path

**Note:** If Windows support adds significant complexity (registry dependency, build tags, CI matrix), consider deferring and just printing a helpful message with manual instructions for Windows users. Ask the user before implementing.

---

## Milestone 3: Uninstall Command

### Goal & Outcome

- `tiddly extension uninstall` removes the external extension JSON file (or registry key on Windows)
- Does NOT uninstall the extension from Chrome — just removes the external install trigger
- Warns about any PATs that may have been created for the extension (similar to MCP uninstall pattern)

### Implementation Outline

- Remove the JSON file from the external extensions directory (or registry key on Windows)
- Print confirmation message
- Remind user that the extension itself must be removed from Chrome manually if desired
- Consider warning about orphaned PATs named "Chrome Extension" (list tokens, filter by name, warn user)

### Testing Strategy

- `TestExtensionUninstall__removes_file` — Verify JSON file is deleted
- `TestExtensionUninstall__file_not_found` — Graceful handling when file doesn't exist (already uninstalled)
- `TestExtensionUninstall__warns_about_pats` — Verify warning about potential orphaned PATs
