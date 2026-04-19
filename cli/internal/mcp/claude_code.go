package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// extractAllClaudeCodeTiddlyPATs returns every Bearer token from a tiddly-URL
// entry in the Claude Code config, in canonical-first order. Entries without
// an extractable PAT (missing/malformed headers) are filtered out.
//
// This is the primitive; extractClaudeCodePATs (survivors) is derived via
// survivorsOfAllTiddlyPATs so "who survives" has a single definition shared
// with the consolidation warning.
func extractAllClaudeCodeTiddlyPATs(rc ResolvedConfig) []TiddlyPAT {
	config, err := readJSONConfig(rc.Path)
	if err != nil {
		return nil
	}

	servers := getServersForScope(config, rc.Scope, rc.Cwd)
	if servers == nil {
		return nil
	}

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sortCanonicalFirst(names)

	var out []TiddlyPAT
	for _, name := range names {
		serverMap, _ := servers[name].(map[string]any)
		if serverMap == nil {
			continue
		}
		urlStr := extractServerURL(serverMap)
		pat := extractClaudeCodePATFromServer(serverMap)
		if pat == "" {
			continue
		}
		switch {
		case isTiddlyContentURL(urlStr):
			out = append(out, TiddlyPAT{ServerType: ServerContent, Name: name, PAT: pat})
		case isTiddlyPromptURL(urlStr):
			out = append(out, TiddlyPAT{ServerType: ServerPrompts, Name: name, PAT: pat})
		}
	}
	return out
}

// extractClaudeCodePATs returns survivor PATs (one per ServerType) derived
// from the full canonical-first walk.
func extractClaudeCodePATs(rc ResolvedConfig) PATExtraction {
	return survivorsOfAllTiddlyPATs(extractAllClaudeCodeTiddlyPATs(rc))
}

// extractClaudeCodePATFromServer extracts the Bearer token from a Claude Code MCP server entry.
// The token is in headers.Authorization as "Bearer <PAT>".
func extractClaudeCodePATFromServer(server map[string]any) string {
	headers, _ := server["headers"].(map[string]any)
	if headers == nil {
		return ""
	}
	authVal, _ := headers["Authorization"].(string)
	return extractBearerToken(authVal)
}

// ClaudeCodeConfigPath returns the path to ~/.claude.json.
func ClaudeCodeConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude.json"), nil
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
	if scope == "local" {
		return getMCPServersMap(config, scope, cwd)
	}
	servers, _ := config["mcpServers"].(map[string]any)
	return servers
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
func resolveClaudeCodePath(configPath, scope, cwd string) (string, error) {
	if scope == "project" {
		return filepath.Join(cwd, ".mcp.json"), nil
	}
	if configPath != "" {
		return configPath, nil
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
// Removes any existing entries pointing to tiddly URLs (regardless of key name) before adding
// new entries under canonical names. Used by both configureClaudeCode and dryRunClaudeCode.
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

	servers := getServersForScope(config, rc.Scope, rc.Cwd)
	if servers == nil {
		servers = make(map[string]any)
	}

	// Remove only the server types being configured (non-empty PAT means it's being configured)
	removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(contentPAT, promptPAT))

	for k, v := range newServers {
		servers[k] = v
	}

	setMCPServersMap(config, rc.Scope, rc.Cwd, servers)

	return config, nil
}

// configureClaudeCode writes MCP server entries into the Claude Code config.
// Returns the timestamped backup path (empty if no prior config existed).
func configureClaudeCode(rc ResolvedConfig, contentPAT, promptPAT string) (backupPath string, err error) {
	config, err := buildClaudeCodeConfig(rc, contentPAT, promptPAT)
	if err != nil {
		return "", err
	}
	return writeJSONConfig(rc.Path, config)
}

// removeClaudeCode removes tiddly MCP server entries from the Claude Code config.
// Identifies servers by URL, not by name, so custom-named entries are also
// removed. Returns the timestamped backup path (empty if nothing changed or
// no prior config existed).
func removeClaudeCode(rc ResolvedConfig, serverFilter []string) (backupPath string, err error) {
	config, err := readJSONConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	servers := getServersForScope(config, rc.Scope, rc.Cwd)
	if servers == nil {
		return "", nil
	}

	if !removeJSONServersByTiddlyURL(servers, serverURLMatcher(serverFilter)) {
		return "", nil
	}

	setMCPServersMap(config, rc.Scope, rc.Cwd, servers)

	return writeJSONConfig(rc.Path, config)
}

// statusClaudeCode returns MCP servers configured in Claude Code.
// Tiddly servers are identified by URL and listed in Servers; all others go to OtherServers.
// Entries under canonical names are tagged MatchByName; others are tagged MatchByURL.
func statusClaudeCode(rc ResolvedConfig) (StatusResult, error) {
	result := StatusResult{ConfigPath: rc.Path}

	config, err := readJSONConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return result, err
	}

	servers := getServersForScope(config, rc.Scope, rc.Cwd)

	for name, entry := range servers {
		serverMap, _ := entry.(map[string]any)
		if serverMap == nil {
			continue
		}
		urlStr := extractServerURL(serverMap)
		if match, other := classifyServer(name, urlStr, detectTransport(serverMap)); match != nil {
			result.Servers = append(result.Servers, *match)
		} else {
			result.OtherServers = append(result.OtherServers, *other)
		}
	}

	result.SortServers()
	sortOtherServers(result.OtherServers)
	return result, nil
}

// dryRunClaudeCode returns the config that would be written without writing it.
func dryRunClaudeCode(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error) {
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
