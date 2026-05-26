package mcp

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"

	toml "github.com/pelletier/go-toml/v2"
)

// codexConfig holds the entire parsed Codex config.toml as a raw tree. We keep
// it raw (rather than a typed struct) so that servers we don't manage — HTTP
// *and* stdio/command servers like Codex's built-in node_repl — round-trip
// untouched. An earlier typed model only understood HTTP servers (url +
// http_headers) and silently destroyed command/args/env on any stdio server it
// rewrote; keeping everything raw is what prevents that.
type codexConfig struct {
	raw map[string]any
}

// servers returns the mcp_servers sub-table, creating it if absent.
func (c *codexConfig) servers() map[string]any {
	m, ok := c.raw["mcp_servers"].(map[string]any)
	if !ok {
		m = make(map[string]any)
		c.raw["mcp_servers"] = m
	}
	return m
}

// codexServerURL / codexServerAuth read fields from a raw server entry without
// assuming its shape (a stdio server has neither).
func codexServerURL(server any) string {
	if m, ok := server.(map[string]any); ok {
		if u, ok := m["url"].(string); ok {
			return u
		}
	}
	return ""
}

func codexServerAuth(server any) string {
	if m, ok := server.(map[string]any); ok {
		if h, ok := m["http_headers"].(map[string]any); ok {
			if a, ok := h["Authorization"].(string); ok {
				return a
			}
		}
	}
	return ""
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

// extractAllCodexTiddlyPATs returns every Bearer token from a tiddly-URL
// entry in the Codex config, in canonical-first order. Entries without an
// extractable PAT (missing/malformed http_headers.Authorization) are
// filtered out.
func extractAllCodexTiddlyPATs(rc ResolvedConfig) []TiddlyPAT {
	config, err := readCodexConfig(rc.Path)
	if err != nil {
		return nil
	}
	servers := config.servers()

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sortCanonicalFirst(names)

	var out []TiddlyPAT
	for _, name := range names {
		server := servers[name]
		pat := extractBearerToken(codexServerAuth(server))
		if pat == "" {
			continue
		}
		url := codexServerURL(server)
		switch {
		case isTiddlyContentURL(url):
			out = append(out, TiddlyPAT{ServerType: ServerContent, Name: name, PAT: pat})
		case isTiddlyPromptURL(url):
			out = append(out, TiddlyPAT{ServerType: ServerPrompts, Name: name, PAT: pat})
		}
	}
	return out
}

// extractCodexPATs returns PATs attached to canonical-named entries only.
func extractCodexPATs(rc ResolvedConfig) PATExtraction {
	return canonicalEntryPATs(extractAllCodexTiddlyPATs(rc))
}

// buildCodexConfig reads the existing config (or creates empty) and sets the
// CLI-managed entries under canonical names. Every other server entry —
// including HTTP/stdio servers and tiddly entries under custom key names — is
// left exactly as read (raw), so nothing of the user's is lost or rewritten.
func buildCodexConfig(path, contentPAT, promptPAT string) (*codexConfig, error) {
	config, err := readCodexConfig(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	servers := config.servers()
	if contentPAT != "" {
		servers[serverNameContent] = map[string]any{
			"url":          ContentMCPURL(),
			"http_headers": map[string]any{"Authorization": "Bearer " + contentPAT},
		}
	}
	if promptPAT != "" {
		servers[serverNamePrompts] = map[string]any{
			"url":          PromptMCPURL(),
			"http_headers": map[string]any{"Authorization": "Bearer " + promptPAT},
		}
	}
	return config, nil
}

// configureCodex writes MCP server entries into the Codex config.
// Returns the timestamped backup path (empty if no prior config existed).
func configureCodex(rc ResolvedConfig, contentPAT, promptPAT string) (backupPath string, err error) {
	config, err := buildCodexConfig(rc.Path, contentPAT, promptPAT)
	if err != nil {
		return "", err
	}
	return writeCodexConfig(rc.Path, config)
}

// removeCodex deletes CLI-managed entries (canonical key names only) from
// the Codex config. Non-canonical entries are preserved. A CLI-managed
// entry is deleted regardless of what URL it currently points at.
func removeCodex(rc ResolvedConfig, serverFilter []string) (*RemoveResult, error) {
	result := &RemoveResult{}

	config, err := readCodexConfig(rc.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return result, err
	}

	servers := config.servers()
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

	backupPath, werr := writeCodexConfig(rc.Path, config)
	result.BackupPath = backupPath
	if werr != nil {
		return result, werr
	}
	result.RemovedEntries = removed
	return result, nil
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

	for name, server := range config.servers() {
		url := codexServerURL(server)
		// HTTP servers have a url; stdio servers (e.g. node_repl) don't.
		transport := "http"
		if url == "" {
			transport = "stdio"
		}
		if match, other := classifyServer(name, url, transport); match != nil {
			result.Servers = append(result.Servers, *match)
		} else {
			result.OtherServers = append(result.OtherServers, *other)
		}
	}

	result.SortServers()
	sortOtherServers(result.OtherServers)
	return result, nil
}

// dryRunCodex returns the config that would be written without writing it.
func dryRunCodex(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error) {
	existing, readErr := readCodexConfig(rc.Path)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", "", readErr
	}
	beforeData, _ := toml.Marshal(existing.raw)
	before = string(beforeData)

	config, err := buildCodexConfig(rc.Path, contentPAT, promptPAT)
	if err != nil {
		return "", "", err
	}
	afterData, _ := toml.Marshal(config.raw)
	after = string(afterData)

	return before, after, nil
}

func readCodexConfig(path string) (*codexConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &codexConfig{raw: map[string]any{}}, err
		}
		return nil, err
	}

	var raw map[string]any
	if err := toml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if raw == nil {
		raw = map[string]any{}
	}
	return &codexConfig{raw: raw}, nil
}

// writeCodexConfig writes config to path atomically, creating a timestamped
// backup first, then verifies the written file is valid and preserved every
// non-managed server — restoring the backup and erroring out if not, so a
// writer bug can't leave the user's config corrupted. Returns the backup path
// (empty if no prior file existed).
func writeCodexConfig(path string, config *codexConfig) (backupPath string, err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", fmt.Errorf("creating config directory: %w", err)
	}

	backupPath, err = backupConfigFile(path)
	if err != nil {
		return "", err
	}

	// Drop an empty mcp_servers table so we never emit a bare `[mcp_servers]`.
	if s, ok := config.raw["mcp_servers"].(map[string]any); ok && len(s) == 0 {
		delete(config.raw, "mcp_servers")
	}

	data, err := toml.Marshal(config.raw)
	if err != nil {
		return "", fmt.Errorf("encoding config: %w", err)
	}

	if err := atomicWriteFileFunc(path, data, 0600); err != nil {
		// See writeJSONConfig: return the backup path on write failure
		// so callers can surface the recovery copy to the user.
		return backupPath, err
	}

	if verr := verifyCodexIntegrity(path, backupPath); verr != nil {
		return backupPath, restoreAfterIntegrityFailure(path, backupPath, verr)
	}
	return backupPath, nil
}

// validateCodexConfig parses bytes and checks every mcp_servers entry is a
// usable Codex server: an HTTP server has a non-empty "url"; a stdio server has
// a non-empty "command". An entry with neither (e.g. url = "" with no command)
// is the corruption signature this guards against.
func validateCodexConfig(data []byte) error {
	var raw map[string]any
	if err := toml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("invalid TOML: %w", err)
	}
	servers, ok := raw["mcp_servers"].(map[string]any)
	if !ok {
		return nil // no servers section is valid
	}
	for name, s := range servers {
		m, ok := s.(map[string]any)
		if !ok {
			return fmt.Errorf("mcp_servers.%s is not a table", name)
		}
		url, _ := m["url"].(string)
		command, _ := m["command"].(string)
		if url == "" && command == "" {
			return fmt.Errorf("mcp_servers.%s has neither a url (HTTP) nor a command (stdio) — config looks corrupted", name)
		}
	}
	return nil
}

// verifyCodexIntegrity re-reads the just-written file and asserts it (1) parses
// and validates, and (2) preserved every non-CLI-managed server entry byte-for-
// byte from the pre-write backup. CLI-managed (canonical) entries are allowed to
// change. Returns an error describing the breach if either check fails.
func verifyCodexIntegrity(path, backupPath string) error {
	newData, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("re-reading written config: %w", err)
	}
	if err := validateCodexConfig(newData); err != nil {
		return err
	}
	if backupPath == "" {
		return nil // no prior file — nothing to preserve
	}
	oldData, err := os.ReadFile(backupPath)
	if err != nil {
		return nil // can't compare; validity already confirmed
	}

	canonical := map[string]bool{serverNameContent: true, serverNamePrompts: true}
	oldServers := codexServersFromBytes(oldData)
	newServers := codexServersFromBytes(newData)
	for name, oldVal := range oldServers {
		if canonical[name] {
			continue // CLI-managed entries may be added/updated/removed
		}
		newVal, ok := newServers[name]
		if !ok {
			return fmt.Errorf("non-managed server %q was dropped", name)
		}
		if !reflect.DeepEqual(oldVal, newVal) {
			return fmt.Errorf("non-managed server %q was modified", name)
		}
	}
	return nil
}

func codexServersFromBytes(data []byte) map[string]any {
	var raw map[string]any
	if err := toml.Unmarshal(data, &raw); err != nil {
		return nil
	}
	s, _ := raw["mcp_servers"].(map[string]any)
	return s
}
