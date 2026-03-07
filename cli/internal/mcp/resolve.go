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

// ToolSupportedScopes returns valid scopes for a tool by looking up its handler.
func ToolSupportedScopes(toolName string) []string {
	h, ok := GetHandler(DefaultHandlers(), toolName)
	if !ok {
		return nil
	}
	return h.SupportedScopes()
}

// IsScopeSupported returns true if the given scope is valid for the tool.
func IsScopeSupported(toolName, scope string) bool {
	for _, s := range ToolSupportedScopes(toolName) {
		if s == scope {
			return true
		}
	}
	return false
}

// ResolveToolConfig validates the scope for the handler and resolves the config path.
// Empty scope defaults to "user". Returns an error if the scope is unsupported
// for the tool, or if cwd is empty for project/local scope.
func ResolveToolConfig(handler ToolHandler, configPath, scope, cwd string) (ResolvedConfig, error) {
	if scope == "" {
		scope = "user"
	}

	toolName := handler.Name()
	supported := handler.SupportedScopes()
	scopeOK := false
	for _, s := range supported {
		if s == scope {
			scopeOK = true
			break
		}
	}
	if !scopeOK {
		return ResolvedConfig{}, fmt.Errorf(
			"scope %q is not supported by %s (valid: %s)",
			scope, toolName, strings.Join(supported, ", "),
		)
	}

	if (scope == "project" || scope == "local") && cwd == "" {
		return ResolvedConfig{}, fmt.Errorf("scope %q requires a working directory (cwd)", scope)
	}

	path, err := handler.ResolvePath(configPath, scope, cwd)
	if err != nil {
		return ResolvedConfig{}, fmt.Errorf("resolving %s config path: %w", toolName, err)
	}

	return ResolvedConfig{Path: path, Scope: scope, Cwd: cwd}, nil
}
