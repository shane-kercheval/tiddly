package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	defaultContentMCPURL = "https://content-mcp.tiddly.me/mcp"
	defaultPromptMCPURL  = "https://prompts-mcp.tiddly.me/mcp"

	serverNameContent = "tiddly_notes_bookmarks"
	serverNamePrompts = "tiddly_prompts"
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
// Removes any existing entries pointing to tiddly URLs (regardless of key name) before adding
// new entries under canonical names.
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

	// Remove only the server types being configured (non-empty PAT means it's being configured)
	removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(contentPAT, promptPAT))

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

// configureClaudeDesktop writes MCP server entries into the Claude Desktop config.
// Preserves all existing config and servers. Returns the timestamped backup
// path (empty if no prior config existed).
func configureClaudeDesktop(configPath, contentPAT, promptPAT string) (backupPath string, err error) {
	config, err := buildClaudeDesktopConfig(configPath, contentPAT, promptPAT)
	if err != nil {
		return "", err
	}
	return writeJSONConfig(configPath, config)
}

// removeClaudeDesktop removes tiddly MCP server entries from the config.
// Identifies servers by URL in args, not by name, so custom-named entries are
// also removed. Returns the timestamped backup path (empty if nothing changed
// or no prior config existed).
func removeClaudeDesktop(configPath string, serverFilter []string) (backupPath string, err error) {
	config, err := readJSONConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		return "", nil
	}

	if !removeJSONServersByTiddlyURL(servers, serverURLMatcher(serverFilter)) {
		return "", nil
	}

	config["mcpServers"] = servers
	return writeJSONConfig(configPath, config)
}

// statusClaudeDesktop returns MCP servers configured in Claude Desktop.
// Tiddly servers are identified by URL and listed in Servers; all others go to OtherServers.
// Entries under canonical names are tagged MatchByName; others are tagged MatchByURL.
func statusClaudeDesktop(configPath string) (StatusResult, error) {
	result := StatusResult{ConfigPath: configPath}

	config, err := readJSONConfig(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return result, err
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		return result, nil
	}

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

// dryRunClaudeDesktop returns the config that would be written without writing it.
func dryRunClaudeDesktop(configPath, contentPAT, promptPAT string) (before, after string, err error) {
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

// extractClaudeDesktopPATs reads the Claude Desktop config and extracts the Bearer tokens
// for the tiddly MCP servers. Identifies servers by URL in args, not by name.
// Returns empty strings on any parse error (best-effort).
func extractClaudeDesktopPATs(configPath string) (contentPAT, promptPAT string) {
	config, err := readJSONConfig(configPath)
	if err != nil {
		return "", ""
	}

	servers, _ := config["mcpServers"].(map[string]any)
	if servers == nil {
		return "", ""
	}

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	// Prefer canonical-named entries so ExtractPATs returns a deterministic
	// "primary" PAT per server type when the config has multiple tiddly
	// entries (e.g. work_prompts + personal_prompts). Status removed this
	// ordering because it renders every entry; ExtractPATs still needs to
	// pick one survivor and canonical-first matches the consolidation
	// warning's disclosed survivor.
	canonicalNamesFirst(names)

	for _, name := range names {
		serverMap, _ := servers[name].(map[string]any)
		if serverMap == nil {
			continue
		}
		args, _ := serverMap["args"].([]any)

		hasContent := false
		hasPrompts := false
		for _, arg := range args {
			s, _ := arg.(string)
			if isTiddlyContentURL(s) {
				hasContent = true
			}
			if isTiddlyPromptURL(s) {
				hasPrompts = true
			}
		}

		if (hasContent && contentPAT == "") || (hasPrompts && promptPAT == "") {
			pat := extractPATFromDesktopArgs(args)
			if hasContent && contentPAT == "" {
				contentPAT = pat
			}
			if hasPrompts && promptPAT == "" {
				promptPAT = pat
			}
		}
	}
	return contentPAT, promptPAT
}

// extractPATFromDesktopArgs scans args for "--header" and extracts the Bearer token.
func extractPATFromDesktopArgs(args []any) string {
	for i, arg := range args {
		s, _ := arg.(string)
		if s == "--header" && i+1 < len(args) {
			headerVal, _ := args[i+1].(string)
			if token := extractBearerToken(headerVal); token != "" {
				return token
			}
		}
	}
	return ""
}

// extractBearerToken extracts the token from a string like "Bearer <token>" or
// "Authorization: Bearer <token>". Returns empty string if the format doesn't match.
func extractBearerToken(s string) string {
	s = strings.TrimSpace(s)
	// Handle "Authorization: Bearer <token>"
	if strings.HasPrefix(s, "Authorization:") {
		s = strings.TrimPrefix(s, "Authorization:")
		s = strings.TrimSpace(s)
	}
	// Handle "Bearer <token>"
	if strings.HasPrefix(s, "Bearer ") {
		return strings.TrimPrefix(s, "Bearer ")
	}
	return ""
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

// writeJSONConfig writes config to path atomically, creating a timestamped
// backup of any existing file at path first. Returns the backup path (empty
// if no prior file existed) so callers can surface it to the user.
func writeJSONConfig(path string, config map[string]any) (backupPath string, err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", fmt.Errorf("creating config directory: %w", err)
	}

	backupPath, err = backupConfigFile(path)
	if err != nil {
		return "", err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encoding config: %w", err)
	}
	data = append(data, '\n')

	if err := atomicWriteFile(path, data, 0600); err != nil {
		return "", err
	}
	return backupPath, nil
}

