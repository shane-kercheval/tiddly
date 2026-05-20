package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// antigravityHTTPEntry is the JSON structure for an HTTP MCP server in
// Antigravity's mcp_config.json. Antigravity uses "serverUrl" (not "url" like
// Claude Code/Desktop) and does not require a "type" field for HTTP transport
// — empirically confirmed against agy 1.0.0, where a bare serverUrl + headers
// entry loads and connects. Defined for clarity at the write site only; reads
// go through the shared map[string]any round-trip so non-canonical user
// entries (including stdio servers) survive untouched.
type antigravityHTTPEntry struct {
	ServerURL string            `json:"serverUrl"`
	Headers   map[string]string `json:"headers,omitempty"`
}

// readAntigravityConfig reads mcp_config.json. A missing OR empty/whitespace
// file yields an empty config: agy creates empty mcp_config.json files (M1
// observed this), so an empty file is a valid "no servers configured yet"
// state, not an error. This is a deliberate asymmetry from the Claude handlers,
// which hard-fail on unreadable files — they don't create empty ones, so the
// tolerance isn't warranted there. Non-empty malformed JSON still returns a
// parse error so status/configure/dry-run fail closed rather than silently
// treating a corrupt file as empty.
func readAntigravityConfig(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]any{}, nil
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return config, nil
}

// extractAntigravityServerURL returns the HTTP URL agy actually loads from an
// entry. agy 1.0.0 reads only the "serverUrl" field for HTTP MCP servers (M1
// confirmed it silently ignores "url"/"httpUrl"). Reading serverUrl-only keeps
// status and PAT extraction honest about what Antigravity will use, instead of
// over-reporting a mis-keyed entry agy won't load.
func extractAntigravityServerURL(serverMap map[string]any) string {
	u, _ := serverMap["serverUrl"].(string)
	return u
}

// extractAntigravityPATFromServer reads the Bearer token from an Antigravity
// MCP server entry's headers.Authorization. Returns "" when absent/malformed.
func extractAntigravityPATFromServer(server map[string]any) string {
	headers, _ := server["headers"].(map[string]any)
	if headers == nil {
		return ""
	}
	authVal, _ := headers["Authorization"].(string)
	return extractBearerToken(authVal)
}

// extractAllAntigravityTiddlyPATs returns every Bearer token from a tiddly-URL
// entry in the Antigravity config, in canonical-first order. Entries without an
// extractable PAT (missing/malformed headers) are filtered out. Read errors are
// swallowed (returns nil), mirroring the other handlers' AllTiddlyPATs. URL
// classification is serverUrl-only so token deletion targets only entries agy
// actually loads.
func extractAllAntigravityTiddlyPATs(configPath string) []TiddlyPAT {
	config, err := readAntigravityConfig(configPath)
	if err != nil {
		return nil
	}
	servers, _ := config["mcpServers"].(map[string]any)
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
		urlStr := extractAntigravityServerURL(serverMap)
		pat := extractAntigravityPATFromServer(serverMap)
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

// extractAntigravityPATs returns PATs attached to canonical-named entries only.
func extractAntigravityPATs(configPath string) PATExtraction {
	return canonicalEntryPATs(extractAllAntigravityTiddlyPATs(configPath))
}

// buildAntigravityConfig reads the existing config (or creates empty) and writes
// the CLI-managed entries under canonical names. Non-canonical entries —
// including those pointing at Tiddly URLs under custom key names, and stdio
// entries with command/args/env — are preserved as-is via the map round-trip.
func buildAntigravityConfig(configPath, contentPAT, promptPAT string) (map[string]any, error) {
	config, err := readAntigravityConfig(configPath)
	if err != nil {
		return nil, err
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		servers = make(map[string]any)
	}

	if contentPAT != "" {
		servers[serverNameContent] = antigravityHTTPEntry{
			ServerURL: ContentMCPURL(),
			Headers:   map[string]string{"Authorization": "Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		servers[serverNamePrompts] = antigravityHTTPEntry{
			ServerURL: PromptMCPURL(),
			Headers:   map[string]string{"Authorization": "Bearer " + promptPAT},
		}
	}

	config["mcpServers"] = servers
	return config, nil
}

// configureAntigravity writes MCP server entries into the Antigravity config.
// Returns the timestamped backup path (empty if no prior config existed).
func configureAntigravity(configPath, contentPAT, promptPAT string) (backupPath string, err error) {
	config, err := buildAntigravityConfig(configPath, contentPAT, promptPAT)
	if err != nil {
		return "", err
	}
	return writeJSONConfig(configPath, config)
}

// removeAntigravity deletes CLI-managed entries (canonical key names only) from
// the Antigravity config. Non-canonical entries are preserved. A CLI-managed
// entry is deleted regardless of what URL it currently points at; a user who
// repurposed the slot gets the recovery backup instead.
func removeAntigravity(configPath string, serverFilter []string) (*RemoveResult, error) {
	result := &RemoveResult{}

	// Malformed (non-empty unparseable) config surfaces an error rather than
	// risking a clobbering write; missing/empty yields no servers to remove.
	config, err := readAntigravityConfig(configPath)
	if err != nil {
		return result, err
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		return result, nil
	}

	targetNames := canonicalNamesForServers(serverFilter)
	var removed []string
	for name := range servers {
		if targetNames[name] {
			removed = append(removed, name)
		}
	}
	if len(removed) == 0 {
		return result, nil
	}
	sort.Strings(removed)
	for _, name := range removed {
		delete(servers, name)
	}

	config["mcpServers"] = servers
	backupPath, werr := writeJSONConfig(configPath, config)
	result.BackupPath = backupPath
	if werr != nil {
		return result, werr
	}
	result.RemovedEntries = removed
	return result, nil
}

// statusAntigravity returns MCP servers configured in Antigravity.
// Tiddly servers are identified by URL and listed in Servers; all others go to
// OtherServers. Entries under canonical names are tagged MatchByName; others
// MatchByURL.
func statusAntigravity(configPath string) (StatusResult, error) {
	result := StatusResult{ConfigPath: configPath}

	// Surface malformed-file errors (matches statusClaudeDesktop); missing or
	// empty files read as an empty config and report "not configured".
	config, err := readAntigravityConfig(configPath)
	if err != nil {
		return result, err
	}
	servers, _ := config["mcpServers"].(map[string]any)
	if servers == nil {
		return result, nil
	}

	for name, entry := range servers {
		serverMap, _ := entry.(map[string]any)
		if serverMap == nil {
			continue
		}
		urlStr := extractAntigravityServerURL(serverMap)
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

// dryRunAntigravity returns the config that would be written without writing it.
func dryRunAntigravity(configPath, contentPAT, promptPAT string) (before, after string, err error) {
	existing, readErr := readAntigravityConfig(configPath)
	if readErr != nil {
		return "", "", readErr
	}
	beforeJSON, _ := json.MarshalIndent(existing, "", "  ")
	before = string(beforeJSON)

	config, err := buildAntigravityConfig(configPath, contentPAT, promptPAT)
	if err != nil {
		return "", "", err
	}
	afterJSON, _ := json.MarshalIndent(config, "", "  ")
	after = string(afterJSON)

	return before, after, nil
}
