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

	configPath, ok := configPathOverrides["claude-desktop"]
	if !ok {
		var err error
		configPath, err = ClaudeDesktopConfigPath()
		if err != nil {
			return tool
		}
	}
	configDir := filepath.Dir(configPath)

	if info, err := os.Stat(configDir); err == nil && info.IsDir() {
		tool.Installed = true
		tool.ConfigPath = configPath
		tool.Reason = "config directory exists"
	}

	_, lookErr := looker.LookPath("npx")
	tool.HasNpx = lookErr == nil

	return tool
}

func detectClaudeCode(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: "claude-code"}

	if _, err := looker.LookPath("claude"); err == nil {
		tool.Installed = true
		tool.Reason = "binary in PATH"
		if p, ok := configPathOverrides["claude-code"]; ok {
			tool.ConfigPath = p
		} else if p, err := ClaudeCodeConfigPath(); err == nil {
			tool.ConfigPath = p
		}
	}

	return tool
}

func detectCodex(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: "codex"}

	if _, err := looker.LookPath("codex"); err == nil {
		tool.Installed = true
		tool.Reason = "binary in PATH"
		if p, ok := configPathOverrides["codex"]; ok {
			tool.ConfigPath = p
		}
		return tool
	}

	configPath, ok := configPathOverrides["codex"]
	if !ok {
		var err error
		configPath, err = CodexConfigPath()
		if err != nil {
			return tool
		}
	}
	configDir := filepath.Dir(configPath)
	if info, err := os.Stat(configDir); err == nil && info.IsDir() {
		tool.Installed = true
		tool.ConfigPath = configPath
		tool.Reason = "config directory exists"
	}

	return tool
}

// configPathOverrides allows tests to override the default config paths for each tool.
// Keys are tool names ("claude-desktop", "claude-code", "codex"). Production code never sets this.
var configPathOverrides map[string]string

// SetConfigPathOverride sets a config path override for a tool during tests.
// Returns a cleanup function that removes the override.
func SetConfigPathOverride(tool, path string) func() {
	if configPathOverrides == nil {
		configPathOverrides = make(map[string]string)
	}
	configPathOverrides[tool] = path
	return func() {
		delete(configPathOverrides, tool)
		if len(configPathOverrides) == 0 {
			configPathOverrides = nil
		}
	}
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
