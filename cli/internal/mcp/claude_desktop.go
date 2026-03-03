package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	defaultContentMCPURL = "https://content-mcp.tiddly.me/mcp"
	defaultPromptMCPURL  = "https://prompt-mcp.tiddly.me/mcp"

	serverNameContent = "bookmarks_notes"
	serverNamePrompts = "prompts"
)

// ContentMCPURL returns the content MCP server URL, overridable via TIDDLY_CONTENT_MCP_URL.
func ContentMCPURL() string {
	if url := os.Getenv("TIDDLY_CONTENT_MCP_URL"); url != "" {
		return url
	}
	return defaultContentMCPURL
}

// PromptMCPURL returns the prompt MCP server URL, overridable via TIDDLY_PROMPT_MCP_URL.
func PromptMCPURL() string {
	if url := os.Getenv("TIDDLY_PROMPT_MCP_URL"); url != "" {
		return url
	}
	return defaultPromptMCPURL
}

// mcpServerEntry is a Claude Desktop MCP server config entry.
type mcpServerEntry struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

// buildClaudeDesktopConfig reads the existing config (or creates empty) and adds tiddly MCP servers.
func buildClaudeDesktopConfig(configPath, contentPAT, promptPAT string) (map[string]any, error) {
	config, err := readJSONConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			config = make(map[string]any)
		} else {
			return nil, err
		}
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		servers = make(map[string]any)
	}

	if contentPAT != "" {
		servers[serverNameContent] = mcpServerEntry{
			Command: "npx",
			Args:    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		servers[serverNamePrompts] = mcpServerEntry{
			Command: "npx",
			Args:    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer " + promptPAT},
		}
	}

	config["mcpServers"] = servers
	return config, nil
}

// InstallClaudeDesktop writes MCP server entries into the Claude Desktop config.
// Preserves all existing config and servers.
func InstallClaudeDesktop(configPath, contentPAT, promptPAT string) error {
	config, err := buildClaudeDesktopConfig(configPath, contentPAT, promptPAT)
	if err != nil {
		return err
	}
	return writeJSONConfig(configPath, config)
}

// UninstallClaudeDesktop removes tiddly MCP server entries from the config.
func UninstallClaudeDesktop(configPath string) error {
	config, err := readJSONConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		return nil
	}

	delete(servers, serverNameContent)
	delete(servers, serverNamePrompts)

	config["mcpServers"] = servers
	return writeJSONConfig(configPath, config)
}

// StatusClaudeDesktop returns the names of tiddly MCP servers configured.
func StatusClaudeDesktop(configPath string) ([]string, error) {
	config, err := readJSONConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		return nil, nil
	}

	var found []string
	for _, name := range []string{serverNameContent, serverNamePrompts} {
		if _, exists := servers[name]; exists {
			found = append(found, name)
		}
	}
	return found, nil
}

// DryRunClaudeDesktop returns the config that would be written without writing it.
func DryRunClaudeDesktop(configPath, contentPAT, promptPAT string) (before, after string, err error) {
	// Capture before state
	existing, readErr := readJSONConfig(configPath)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", "", readErr
	}
	if existing == nil {
		existing = make(map[string]any)
	}
	beforeJSON, _ := json.MarshalIndent(existing, "", "  ")
	before = string(beforeJSON)

	// Build new config
	config, err := buildClaudeDesktopConfig(configPath, contentPAT, promptPAT)
	if err != nil {
		return "", "", err
	}
	afterJSON, _ := json.MarshalIndent(config, "", "  ")
	after = string(afterJSON)

	return before, after, nil
}

func readJSONConfig(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return config, nil
}

func writeJSONConfig(path string, config map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}
	data = append(data, '\n')

	return os.WriteFile(path, data, 0644)
}
