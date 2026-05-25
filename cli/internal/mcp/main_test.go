package mcp

import (
	"os"
	"path/filepath"
	"testing"
)

// TestMain sandboxes HOME for every test in this package. The MCP handlers
// resolve real tool config paths via os.UserHomeDir() (see detect.go), so a test
// that writes through a non-overridden handler would mutate the developer's real
// config files. Redirecting HOME to a temp dir prevents any test from reading or
// writing a real config. See cmd/main_test.go for the full rationale.
func TestMain(m *testing.M) {
	tmp, err := os.MkdirTemp("", "tiddly-mcp-test-home-*")
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
	set("APPDATA", filepath.Join(tmp, "AppData"))
	if err := os.Unsetenv("CODEX_HOME"); err != nil {
		panic(err)
	}
	code := m.Run()
	_ = os.RemoveAll(tmp)
	os.Exit(code)
}
