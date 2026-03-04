package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ExtractClaudeCodePATs reads the Claude Code config and extracts the Bearer tokens
// for the tiddly MCP servers. Returns empty strings on any parse error (best-effort).
func ExtractClaudeCodePATs(rc ResolvedConfig) (contentPAT, promptPAT string) {
	config, err := readJSONConfig(rc.Path)
	if err != nil {
		return "", ""
	}

	servers := getServersForScope(config, rc.Scope, rc.Cwd)
	if servers == nil {
		return "", ""
	}

	contentPAT = extractClaudeCodeServerPAT(servers, serverNameContent)
	promptPAT = extractClaudeCodeServerPAT(servers, serverNamePrompts)
	return contentPAT, promptPAT
}

// extractClaudeCodeServerPAT extracts the Bearer token from a Claude Code MCP server entry.
// The token is in headers.Authorization as "Bearer <PAT>".
func extractClaudeCodeServerPAT(servers map[string]any, serverName string) string {
	server, _ := servers[serverName].(map[string]any)
	if server == nil {
		return ""
	}
	headers, _ := server["headers"].(map[string]any)
	if headers == nil {
		return ""
	}
	authVal, _ := headers["Authorization"].(string)
	return extractBearerToken(authVal)
}

// ClaudeCodeConfigPath returns the path to ~/.claude.json.
func ClaudeCodeConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude.json")
}

// claudeCodeHTTPEntry is the JSON structure for an HTTP MCP server in Claude Code.
type claudeCodeHTTPEntry struct {
	Type    string            `json:"type"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
}

// getMCPServersMap returns the mcpServers map for the given scope from a ~/.claude.json config.
// For "user" scope, returns the top-level mcpServers.
// For "local" scope, returns projects[cwd].mcpServers.
func getMCPServersMap(config map[string]any, scope, cwd string) map[string]any {
	if scope == "local" {
		projects, _ := config["projects"].(map[string]any)
		if projects == nil {
			return nil
		}
		proj, _ := projects[cwd].(map[string]any)
		if proj == nil {
			return nil
		}
		servers, _ := proj["mcpServers"].(map[string]any)
		return servers
	}
	// "user" scope — top-level mcpServers
	servers, _ := config["mcpServers"].(map[string]any)
	return servers
}

// getServersForScope returns the mcpServers map for any scope including "project".
func getServersForScope(config map[string]any, scope, cwd string) map[string]any {
	if scope == "project" {
		servers, _ := config["mcpServers"].(map[string]any)
		return servers
	}
	return getMCPServersMap(config, scope, cwd)
}

// setMCPServersMap writes the mcpServers map back into the config at the correct path.
func setMCPServersMap(config map[string]any, scope, cwd string, servers map[string]any) {
	if scope == "local" {
		projects, _ := config["projects"].(map[string]any)
		if projects == nil {
			projects = make(map[string]any)
			config["projects"] = projects
		}
		proj, _ := projects[cwd].(map[string]any)
		if proj == nil {
			proj = make(map[string]any)
			projects[cwd] = proj
		}
		proj["mcpServers"] = servers
	} else {
		config["mcpServers"] = servers
	}
}

// resolveClaudeCodePath returns the config file path for the given scope.
// "user" and "local" both use ~/.claude.json. "project" uses .mcp.json in cwd.
// Called only from ResolveToolConfig.
func resolveClaudeCodePath(configPath, scope, cwd string) string {
	if scope == "project" {
		return filepath.Join(cwd, ".mcp.json")
	}
	if configPath != "" {
		return configPath
	}
	return ClaudeCodeConfigPath()
}

// buildClaudeCodeServers returns the two tiddly MCP server entries.
func buildClaudeCodeServers(contentPAT, promptPAT string) map[string]any {
	servers := make(map[string]any)
	if contentPAT != "" {
		servers[serverNameContent] = claudeCodeHTTPEntry{
			Type:    "http",
			URL:     ContentMCPURL(),
			Headers: map[string]string{"Authorization": "Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		servers[serverNamePrompts] = claudeCodeHTTPEntry{
			Type:    "http",
			URL:     PromptMCPURL(),
			Headers: map[string]string{"Authorization": "Bearer " + promptPAT},
		}
	}
	return servers
}

// buildClaudeCodeConfig reads the existing config and merges in the tiddly MCP server entries.
// Used by both InstallClaudeCode and DryRunClaudeCode to avoid duplicating merge logic.
func buildClaudeCodeConfig(rc ResolvedConfig, contentPAT, promptPAT string) (map[string]any, error) {
	config, err := readJSONConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			config = make(map[string]any)
		} else {
			return nil, err
		}
	}

	newServers := buildClaudeCodeServers(contentPAT, promptPAT)

	if rc.Scope == "project" {
		servers, _ := config["mcpServers"].(map[string]any)
		if servers == nil {
			servers = make(map[string]any)
		}
		for k, v := range newServers {
			servers[k] = v
		}
		config["mcpServers"] = servers
	} else {
		existing := getMCPServersMap(config, rc.Scope, rc.Cwd)
		if existing == nil {
			existing = make(map[string]any)
		}
		for k, v := range newServers {
			existing[k] = v
		}
		setMCPServersMap(config, rc.Scope, rc.Cwd, existing)
	}

	return config, nil
}

// InstallClaudeCode writes MCP server entries into the Claude Code config.
func InstallClaudeCode(rc ResolvedConfig, contentPAT, promptPAT string) error {
	config, err := buildClaudeCodeConfig(rc, contentPAT, promptPAT)
	if err != nil {
		return err
	}
	return writeJSONConfig(rc.Path, config)
}

// UninstallClaudeCode removes tiddly MCP server entries from the Claude Code config.
func UninstallClaudeCode(rc ResolvedConfig) error {
	config, err := readJSONConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if rc.Scope == "project" {
		servers, _ := config["mcpServers"].(map[string]any)
		if servers == nil {
			return nil
		}
		delete(servers, serverNameContent)
		delete(servers, serverNamePrompts)
		config["mcpServers"] = servers
		return writeJSONConfig(rc.Path, config)
	}

	existing := getMCPServersMap(config, rc.Scope, rc.Cwd)
	if existing == nil {
		return nil
	}
	delete(existing, serverNameContent)
	delete(existing, serverNamePrompts)
	setMCPServersMap(config, rc.Scope, rc.Cwd, existing)

	return writeJSONConfig(rc.Path, config)
}

// StatusClaudeCode returns tiddly MCP servers configured in Claude Code.
func StatusClaudeCode(rc ResolvedConfig) ([]string, error) {
	config, err := readJSONConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	servers := getServersForScope(config, rc.Scope, rc.Cwd)

	var found []string
	for _, name := range []string{serverNameContent, serverNamePrompts} {
		if _, exists := servers[name]; exists {
			found = append(found, name)
		}
	}
	return found, nil
}

// DryRunClaudeCode returns the config that would be written without writing it.
func DryRunClaudeCode(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error) {
	// Capture before state
	existing, readErr := readJSONConfig(rc.Path)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", "", readErr
	}
	if existing == nil {
		existing = make(map[string]any)
	}
	beforeJSON, _ := json.MarshalIndent(existing, "", "  ")
	before = string(beforeJSON)

	// Build after state using the shared merge logic
	afterConfig, err := buildClaudeCodeConfig(rc, contentPAT, promptPAT)
	if err != nil {
		return "", "", err
	}
	afterJSON, _ := json.MarshalIndent(afterConfig, "", "  ")
	after = string(afterJSON)

	return before, after, nil
}
