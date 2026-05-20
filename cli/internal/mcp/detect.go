package mcp

import (
	"os"
	"path/filepath"
	"runtime"
)

// ExecLooker finds executables in PATH.
type ExecLooker interface {
	LookPath(file string) (string, error)
}

// DetectedTool represents an AI tool found on the system.
type DetectedTool struct {
	Name       string // "claude-desktop", "claude-code", "codex"
	Detected   bool
	ConfigPath string // path to config file (if applicable)
	Reason     string // how detected
	HasNpx     bool   // for Claude Desktop: whether npx is available
}

// ClaudeDesktopConfigPath returns the Claude Desktop config file path for the current OS.
func ClaudeDesktopConfigPath() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), nil
	case "windows":
		appdata := os.Getenv("APPDATA")
		if appdata == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			appdata = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appdata, "Claude", "claude_desktop_config.json"), nil
	default: // linux
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".config", "Claude", "claude_desktop_config.json"), nil
	}
}

// CodexConfigPath returns the Codex config file path.
func CodexConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex", "config.toml"), nil
}

// AntigravityConfigPath returns the Antigravity MCP config file path.
//
// Antigravity inherits the ~/.gemini/ tree from its Gemini lineage; the MCP
// config is the dedicated file ~/.gemini/config/mcp_config.json, shared by both
// the `agy` CLI and the Antigravity IDE. (Empirically confirmed against agy
// 1.0.0; the legacy Gemini CLI's own ~/.gemini/settings.json is NOT read by
// Antigravity and is deliberately not touched here.)
func AntigravityConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".gemini", "config", "mcp_config.json"), nil
}

// antigravityInstallDirs returns the directories whose existence signals an
// Antigravity install. Used for detection when the `agy` binary isn't on PATH
// (e.g. a desktop-app-only install). These are Antigravity-specific: the CLI
// installer creates ~/.gemini/antigravity-cli/ and the IDE creates
// ~/.gemini/antigravity/. We deliberately do NOT probe ~/.gemini/config/ —
// that path's provenance is ambiguous with a legacy Gemini CLI install, so
// keying off it would false-positive Antigravity for Gemini-CLI-only users.
func antigravityInstallDirs() ([]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return []string{
		filepath.Join(home, ".gemini", "antigravity-cli"),
		filepath.Join(home, ".gemini", "antigravity"),
	}, nil
}
