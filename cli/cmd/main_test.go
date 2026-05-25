package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

// TestMain sandboxes HOME (and the platform config-dir env vars) to a throwaway
// temp directory for every test in this package.
//
// The CLI resolves real tool configs — ~/.codex/config.toml, ~/.gemini/config/
// mcp_config.json, ~/Library/Application Support/Claude/claude_desktop_config.json,
// ~/.claude.json — via os.UserHomeDir(). Without this sandbox, any test that
// exercises `mcp configure`/`status` against a non-overridden handler reads, and
// can *overwrite*, the developer's real config files. That actually happened:
// configure tests wrote the `bm_test123` fixture token into real configs on dev
// machines where Codex/Antigravity/Claude were installed (detection also keys off
// real ~/.codex / ~/.gemini directories). Redirecting HOME makes touching a real
// config physically impossible regardless of how a test is written.
func TestMain(m *testing.M) {
	tmp, err := os.MkdirTemp("", "tiddly-cli-test-home-*")
	if err != nil {
		panic(err)
	}
	set := func(k, v string) {
		if err := os.Setenv(k, v); err != nil {
			panic(err)
		}
	}
	set("HOME", tmp)
	set("XDG_CONFIG_HOME", filepath.Join(tmp, ".config"))
	set("APPDATA", filepath.Join(tmp, "AppData")) // Windows Claude Desktop path
	if err := os.Unsetenv("CODEX_HOME"); err != nil { // force Codex to resolve under the sandboxed HOME
		panic(err)
	}
	code := m.Run()
	_ = os.RemoveAll(tmp)
	os.Exit(code)
}
