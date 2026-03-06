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

	// Remove any existing entries pointing to tiddly URLs (handles custom names)
	removeDesktopServersByTiddlyURL(servers)

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

// removeDesktopServersByTiddlyURL removes entries from a JSON mcpServers map
// whose args contain a tiddly MCP server URL.
func removeDesktopServersByTiddlyURL(servers map[string]any) {
	for name, entry := range servers {
		serverMap, _ := entry.(map[string]any)
		if serverMap == nil {
			continue
		}
		args, _ := serverMap["args"].([]any)
		for _, arg := range args {
			s, _ := arg.(string)
			if isTiddlyURL(s) {
				delete(servers, name)
				break
			}
		}
	}
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
// Identifies servers by URL in args, not by name, so custom-named entries are also removed.
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

	removeDesktopServersByTiddlyURL(servers)

	config["mcpServers"] = servers
	return writeJSONConfig(configPath, config)
}

// StatusClaudeDesktop returns tiddly MCP servers configured in Claude Desktop.
// Identifies servers by URL in args. Entries under canonical names are tagged MatchByName;
// entries under other names are tagged MatchByURL.
func StatusClaudeDesktop(configPath string) (StatusResult, error) {
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

	foundContent := false
	foundPrompts := false

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	canonicalNamesFirst(names)

	for _, name := range names {
		serverMap, _ := servers[name].(map[string]any)
		if serverMap == nil {
			continue
		}

		method := MatchByURL
		if name == serverNameContent || name == serverNamePrompts {
			method = MatchByName
		}

		args, _ := serverMap["args"].([]any)
		for _, arg := range args {
			s, _ := arg.(string)
			if !foundContent && isTiddlyContentURL(s) {
				result.Servers = append(result.Servers, ServerMatch{
					ServerType: "content", Name: name, MatchMethod: method,
				})
				foundContent = true
			}
			if !foundPrompts && isTiddlyPromptURL(s) {
				result.Servers = append(result.Servers, ServerMatch{
					ServerType: "prompts", Name: name, MatchMethod: method,
				})
				foundPrompts = true
			}
		}
	}

	result.SortServers()
	return result, nil
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

// ExtractClaudeDesktopPATs reads the Claude Desktop config and extracts the Bearer tokens
// for the tiddly MCP servers. Identifies servers by URL in args, not by name.
// Returns empty strings on any parse error (best-effort).
func ExtractClaudeDesktopPATs(configPath string) (contentPAT, promptPAT string) {
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

func writeJSONConfig(path string, config map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}
	data = append(data, '\n')

	return atomicWriteFile(path, data, 0600)
}

// atomicWriteFile writes data to a temp file in the same directory and renames it to path.
// This prevents corruption if the process is killed mid-write.
// If the file already exists, its permissions are preserved. Otherwise defaultPerm is used.
func atomicWriteFile(path string, data []byte, defaultPerm os.FileMode) error {
	// Preserve existing file permissions if the file already exists
	perm := defaultPerm
	if info, err := os.Stat(path); err == nil {
		perm = info.Mode().Perm()
	}

	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	closed := false
	cleanup := func() {
		if !closed {
			_ = tmp.Close()
		}
		_ = os.Remove(tmpPath)
	}

	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Chmod(perm); err != nil {
		cleanup()
		return fmt.Errorf("setting file permissions: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	closed = true

	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("renaming temp file: %w", err)
	}
	return nil
}
