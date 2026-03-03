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
	Installed  bool
	ConfigPath string // path to config file (if applicable)
	Reason     string // how detected
	HasNpx     bool   // for Claude Desktop: whether npx is available
}

// ResolvedConfigPath returns the tool's config path, falling back to the default
// for the tool if ConfigPath is empty.
func (t DetectedTool) ResolvedConfigPath() string {
	if t.ConfigPath != "" {
		return t.ConfigPath
	}
	switch t.Name {
	case "claude-desktop":
		return ClaudeDesktopConfigPath()
	case "claude-code":
		return ClaudeCodeConfigPath()
	case "codex":
		return CodexConfigPath()
	}
	return ""
}

// DetectTools finds installed AI tools on the system.
func DetectTools(looker ExecLooker) []DetectedTool {
	var tools []DetectedTool

	tools = append(tools, detectClaudeDesktop(looker))
	tools = append(tools, detectClaudeCode(looker))
	tools = append(tools, detectCodex(looker))

	return tools
}

func detectClaudeDesktop(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: "claude-desktop"}

	configPath := ClaudeDesktopConfigPath()
	configDir := filepath.Dir(configPath)

	if info, err := os.Stat(configDir); err == nil && info.IsDir() {
		tool.Installed = true
		tool.ConfigPath = configPath
		tool.Reason = "config directory exists"
	}

	_, err := looker.LookPath("npx")
	tool.HasNpx = err == nil

	return tool
}

func detectClaudeCode(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: "claude-code"}

	if _, err := looker.LookPath("claude"); err == nil {
		tool.Installed = true
		tool.Reason = "binary in PATH"
		tool.ConfigPath = ClaudeCodeConfigPath()
	}

	return tool
}

func detectCodex(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: "codex"}

	if _, err := looker.LookPath("codex"); err == nil {
		tool.Installed = true
		tool.Reason = "binary in PATH"
		return tool
	}

	configPath := CodexConfigPath()
	configDir := filepath.Dir(configPath)
	if info, err := os.Stat(configDir); err == nil && info.IsDir() {
		tool.Installed = true
		tool.ConfigPath = configPath
		tool.Reason = "config directory exists"
	}

	return tool
}

// ClaudeDesktopConfigPath returns the Claude Desktop config file path for the current OS.
func ClaudeDesktopConfigPath() string {
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
	case "windows":
		appdata := os.Getenv("APPDATA")
		if appdata == "" {
			home, _ := os.UserHomeDir()
			appdata = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appdata, "Claude", "claude_desktop_config.json")
	default: // linux
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	}
}

// CodexConfigPath returns the Codex config file path.
func CodexConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".codex", "config.toml")
}
