package mcp

import (
	"fmt"
	"strings"
)

// ResolvedConfig carries the validated, resolved config for a tool.
// Created once at the command boundary via ResolveToolConfig.
type ResolvedConfig struct {
	Path  string // Fully resolved file path
	Scope string // Validated scope ("user", "local", or "project")
	Cwd   string // Working directory (used by claude-code local scope)
}

// ToolSupportedScopes returns valid scopes for a tool.
func ToolSupportedScopes(toolName string) []string {
	switch toolName {
	case "claude-desktop":
		return []string{"user"}
	case "claude-code":
		return []string{"user", "local", "project"}
	case "codex":
		return []string{"user", "project"}
	default:
		return nil
	}
}

// ResolveToolConfig validates the scope for the tool and resolves the config path.
// Empty scope defaults to "user". Returns an error if the scope is unsupported
// for the tool, or if cwd is empty for project/local scope.
func ResolveToolConfig(toolName, configPath, scope, cwd string) (ResolvedConfig, error) {
	if scope == "" {
		scope = "user"
	}

	supported := ToolSupportedScopes(toolName)
	if supported == nil {
		return ResolvedConfig{}, fmt.Errorf("unknown tool %q", toolName)
	}

	valid := false
	for _, s := range supported {
		if s == scope {
			valid = true
			break
		}
	}
	if !valid {
		return ResolvedConfig{}, fmt.Errorf(
			"scope %q is not supported by %s (valid: %s)",
			scope, toolName, strings.Join(supported, ", "),
		)
	}

	if (scope == "project" || scope == "local") && cwd == "" {
		return ResolvedConfig{}, fmt.Errorf("scope %q requires a working directory (cwd)", scope)
	}

	var path string
	switch toolName {
	case "claude-desktop":
		if configPath != "" {
			path = configPath
		} else {
			path = ClaudeDesktopConfigPath()
		}
	case "claude-code":
		path = resolveClaudeCodePath(configPath, scope, cwd)
	case "codex":
		path = resolveCodexPath(configPath, scope, cwd)
	}

	return ResolvedConfig{Path: path, Scope: scope, Cwd: cwd}, nil
}
