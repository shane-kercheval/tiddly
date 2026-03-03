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

// InstallCodex writes MCP server entries into the Codex config.
func InstallCodex(configPath, contentPAT, promptPAT string) error {
	config, err := readCodexConfig(configPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	if config.MCPServers == nil {
		config.MCPServers = make(map[string]codexMCPServer)
	}

	if contentPAT != "" {
		config.MCPServers[serverNameContent] = codexMCPServer{
			URL:         contentMCPURL,
			HTTPHeaders: map[string]string{"Authorization": "Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		config.MCPServers[serverNamePrompts] = codexMCPServer{
			URL:         promptMCPURL,
			HTTPHeaders: map[string]string{"Authorization": "Bearer " + promptPAT},
		}
	}

	return writeCodexConfig(configPath, config)
}

// UninstallCodex removes tiddly MCP server entries from the config.
func UninstallCodex(configPath string) error {
	config, err := readCodexConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if config.MCPServers == nil {
		return nil
	}

	delete(config.MCPServers, serverNameContent)
	delete(config.MCPServers, serverNamePrompts)

	return writeCodexConfig(configPath, config)
}

// StatusCodex returns the names of tiddly MCP servers configured.
func StatusCodex(configPath string) ([]string, error) {
	config, err := readCodexConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var found []string
	for _, name := range []string{serverNameContent, serverNamePrompts} {
		if _, exists := config.MCPServers[name]; exists {
			found = append(found, name)
		}
	}
	return found, nil
}

// DryRunCodex returns the config that would be written without writing it.
func DryRunCodex(configPath, contentPAT, promptPAT string) (before, after string, err error) {
	config, readErr := readCodexConfig(configPath)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", "", readErr
	}

	beforeData, _ := toml.Marshal(config.rest)
	before = string(beforeData)

	if config.MCPServers == nil {
		config.MCPServers = make(map[string]codexMCPServer)
	}
	if contentPAT != "" {
		config.MCPServers[serverNameContent] = codexMCPServer{
			URL:         contentMCPURL,
			HTTPHeaders: map[string]string{"Authorization": "Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		config.MCPServers[serverNamePrompts] = codexMCPServer{
			URL:         promptMCPURL,
			HTTPHeaders: map[string]string{"Authorization": "Bearer " + promptPAT},
		}
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
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
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

	return os.WriteFile(path, data, 0644)
}
