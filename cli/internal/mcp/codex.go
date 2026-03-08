package mcp

import (
	"fmt"
	"os"
	"path/filepath"

	toml "github.com/pelletier/go-toml/v2"
)

// codexConfig represents the Codex config.toml structure.
// We only parse the mcp_servers section and preserve the rest as raw data.
type codexConfig struct {
	MCPServers map[string]codexMCPServer `toml:"mcp_servers"`
	rest       map[string]any
}

// codexMCPServer represents a single MCP server in Codex config.
type codexMCPServer struct {
	URL         string            `toml:"url"`
	HTTPHeaders map[string]string `toml:"http_headers,omitempty"`
}

// resolveCodexPath returns the config file path based on scope.
// Called only from ResolveToolConfig.
func resolveCodexPath(configPath, scope, cwd string) (string, error) {
	if scope == "project" {
		return filepath.Join(cwd, ".codex", "config.toml"), nil
	}
	if configPath != "" {
		return configPath, nil
	}
	return CodexConfigPath()
}

// extractCodexPATs reads the Codex config and extracts the Bearer tokens
// for the tiddly MCP servers. Identifies servers by URL, not by name.
// Returns empty strings on any parse error (best-effort).
func extractCodexPATs(rc ResolvedConfig) (contentPAT, promptPAT string) {
	config, err := readCodexConfig(rc.Path)
	if err != nil {
		return "", ""
	}

	names := make([]string, 0, len(config.MCPServers))
	for name := range config.MCPServers {
		names = append(names, name)
	}
	canonicalNamesFirst(names)

	for _, name := range names {
		server := config.MCPServers[name]
		if contentPAT == "" && isTiddlyContentURL(server.URL) {
			contentPAT = extractBearerToken(server.HTTPHeaders["Authorization"])
		}
		if promptPAT == "" && isTiddlyPromptURL(server.URL) {
			promptPAT = extractBearerToken(server.HTTPHeaders["Authorization"])
		}
	}
	return contentPAT, promptPAT
}

// buildCodexConfig reads the existing config (or creates empty) and adds tiddly MCP servers.
// Removes any existing entries pointing to tiddly URLs (regardless of key name) before adding
// new entries under canonical names.
func buildCodexConfig(path, contentPAT, promptPAT string) (*codexConfig, error) {
	config, err := readCodexConfig(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	if config.MCPServers == nil {
		config.MCPServers = make(map[string]codexMCPServer)
	}

	// Remove only the server types being installed (non-empty PAT means it's being installed)
	removeCodexServersByTiddlyURL(config.MCPServers, tiddlyURLMatcher(contentPAT, promptPAT))

	if contentPAT != "" {
		config.MCPServers[serverNameContent] = codexMCPServer{
			URL:         ContentMCPURL(),
			HTTPHeaders: map[string]string{"Authorization": "Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		config.MCPServers[serverNamePrompts] = codexMCPServer{
			URL:         PromptMCPURL(),
			HTTPHeaders: map[string]string{"Authorization": "Bearer " + promptPAT},
		}
	}

	return config, nil
}

// removeCodexServersByTiddlyURL removes entries whose URL matches the given predicate.
// Returns true if any were removed.
func removeCodexServersByTiddlyURL(servers map[string]codexMCPServer, match func(string) bool) bool {
	removed := false
	for name, server := range servers {
		if match(server.URL) {
			delete(servers, name)
			removed = true
		}
	}
	return removed
}

// configureCodex writes MCP server entries into the Codex config.
func configureCodex(rc ResolvedConfig, contentPAT, promptPAT string) error {
	config, err := buildCodexConfig(rc.Path, contentPAT, promptPAT)
	if err != nil {
		return err
	}
	return writeCodexConfig(rc.Path, config)
}

// removeCodex removes tiddly MCP server entries from the config.
// Identifies servers by URL, not by name, so custom-named entries are also removed.
func removeCodex(rc ResolvedConfig) error {
	config, err := readCodexConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if config.MCPServers == nil {
		return nil
	}

	if !removeCodexServersByTiddlyURL(config.MCPServers, isTiddlyURL) {
		return nil
	}

	return writeCodexConfig(rc.Path, config)
}

// statusCodex returns MCP servers configured in Codex.
// Tiddly servers are identified by URL and listed in Servers; all others go to OtherServers.
// Entries under canonical names are tagged MatchByName; others are tagged MatchByURL.
func statusCodex(rc ResolvedConfig) (StatusResult, error) {
	result := StatusResult{ConfigPath: rc.Path}

	config, err := readCodexConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return result, err
	}

	foundContent := false
	foundPrompts := false

	names := make([]string, 0, len(config.MCPServers))
	for name := range config.MCPServers {
		names = append(names, name)
	}
	canonicalNamesFirst(names)

	for _, name := range names {
		server := config.MCPServers[name]

		method := MatchByURL
		if name == serverNameContent || name == serverNamePrompts {
			method = MatchByName
		}

		matched := false
		if !foundContent && isTiddlyContentURL(server.URL) {
			result.Servers = append(result.Servers, ServerMatch{
				ServerType: "content", Name: name, MatchMethod: method, URL: server.URL,
			})
			foundContent = true
			matched = true
		}
		if !foundPrompts && isTiddlyPromptURL(server.URL) {
			result.Servers = append(result.Servers, ServerMatch{
				ServerType: "prompts", Name: name, MatchMethod: method, URL: server.URL,
			})
			foundPrompts = true
			matched = true
		}
		if !matched && !isTiddlyURL(server.URL) {
			result.OtherServers = append(result.OtherServers, OtherServer{
				Name:      name,
				Transport: "http", // Codex only supports HTTP MCP servers
			})
		}
	}

	result.SortServers()
	sortOtherServers(result.OtherServers)
	return result, nil
}

// dryRunCodex returns the config that would be written without writing it.
func dryRunCodex(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error) {
	// Capture before state
	existing, readErr := readCodexConfig(rc.Path)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", "", readErr
	}
	beforeData, _ := toml.Marshal(existing.rest)
	before = string(beforeData)

	// Build new config
	config, err := buildCodexConfig(rc.Path, contentPAT, promptPAT)
	if err != nil {
		return "", "", err
	}

	// Merge mcp_servers back into rest for marshaling
	afterMap := make(map[string]any)
	for k, v := range config.rest {
		afterMap[k] = v
	}
	afterMap["mcp_servers"] = config.MCPServers

	afterData, _ := toml.Marshal(afterMap)
	after = string(afterData)

	return before, after, nil
}

func readCodexConfig(path string) (*codexConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &codexConfig{rest: make(map[string]any)}, err
		}
		return nil, err
	}

	// Parse into raw map to preserve unknown sections
	var raw map[string]any
	if err := toml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}

	config := &codexConfig{rest: raw}

	// Extract mcp_servers into typed struct
	if mcpRaw, ok := raw["mcp_servers"]; ok {
		if mcpMap, ok := mcpRaw.(map[string]any); ok {
			config.MCPServers = make(map[string]codexMCPServer)
			for name, serverRaw := range mcpMap {
				if serverMap, ok := serverRaw.(map[string]any); ok {
					server := codexMCPServer{}
					if url, ok := serverMap["url"].(string); ok {
						server.URL = url
					}
					if headers, ok := serverMap["http_headers"].(map[string]any); ok {
						server.HTTPHeaders = make(map[string]string)
						for k, v := range headers {
							if s, ok := v.(string); ok {
								server.HTTPHeaders[k] = s
							}
						}
					}
					config.MCPServers[name] = server
				}
			}
		}
	}

	return config, nil
}

func writeCodexConfig(path string, config *codexConfig) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	if err := backupConfigFile(path); err != nil {
		return err
	}

	// Merge mcp_servers back into the raw map
	output := make(map[string]any)
	for k, v := range config.rest {
		if k == "mcp_servers" {
			continue // replaced below
		}
		output[k] = v
	}
	if len(config.MCPServers) > 0 {
		output["mcp_servers"] = config.MCPServers
	}

	data, err := toml.Marshal(output)
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}

	return atomicWriteFile(path, data, 0600)
}
