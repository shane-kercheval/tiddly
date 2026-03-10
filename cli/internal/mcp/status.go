package mcp

import (
	"net/url"
	"sort"
	"strings"
)

// MatchMethod indicates how a server entry was identified as a tiddly MCP server.
type MatchMethod int

const (
	// MatchByName means the entry was found under the canonical key name.
	MatchByName MatchMethod = iota
	// MatchByURL means the entry was found by matching its URL against tiddly server hosts.
	MatchByURL
)

// ServerMatch describes a detected tiddly MCP server entry.
type ServerMatch struct {
	ServerType  string      // "content" or "prompts"
	Name        string      // actual key name in config
	MatchMethod MatchMethod // how it was matched
	URL         string      // the MCP server URL
}

// OtherServer describes a non-tiddly MCP server entry.
type OtherServer struct {
	Name      string // config key name
	Transport string // "http", "stdio", or "" if unknown
}

// StatusResult holds the outcome of a status check for a single tool.
type StatusResult struct {
	Servers      []ServerMatch // tiddly servers
	OtherServers []OtherServer // non-tiddly servers
	ConfigPath   string
}

// SortServers sorts the Servers slice so "content" comes before "prompts",
// ensuring deterministic output regardless of map iteration order.
func (sr *StatusResult) SortServers() {
	sort.Slice(sr.Servers, func(i, j int) bool {
		return sr.Servers[i].ServerType < sr.Servers[j].ServerType
	})
}

// sortOtherServers sorts OtherServer entries alphabetically by name.
func sortOtherServers(servers []OtherServer) {
	sort.Slice(servers, func(i, j int) bool {
		return servers[i].Name < servers[j].Name
	})
}

// urlPrefix returns scheme + host + path (without query/fragment) for a URL.
// Returns the raw string on parse error.
func urlPrefix(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return rawURL
	}
	return u.Scheme + "://" + u.Host + strings.TrimSuffix(u.Path, "/")
}

// urlMatchesPrefix parses candidateURL and checks if its scheme+host+path
// matches the patternPrefix exactly.
func urlMatchesPrefix(candidateURL, patternPrefix string) bool {
	return urlPrefix(candidateURL) == patternPrefix
}

// isTiddlyContentURL returns true if the URL points to the tiddly content MCP server.
func isTiddlyContentURL(rawURL string) bool {
	return urlMatchesPrefix(rawURL, urlPrefix(ContentMCPURL()))
}

// isTiddlyPromptURL returns true if the URL points to the tiddly prompt MCP server.
func isTiddlyPromptURL(rawURL string) bool {
	return urlMatchesPrefix(rawURL, urlPrefix(PromptMCPURL()))
}

// isTiddlyURL returns true if the URL points to either tiddly MCP server.
func isTiddlyURL(rawURL string) bool {
	return isTiddlyContentURL(rawURL) || isTiddlyPromptURL(rawURL)
}

// extractServerURL returns the MCP URL from a server entry, checking both
// the HTTP format ("url" field) and the stdio/npx mcp-remote format ("args" array).
// For stdio format, it finds "mcp-remote" anywhere in args and returns the next element.
// This handles variants like ["mcp-remote", "<url>"] and ["-y", "mcp-remote", "<url>"]
// since users may manually configure servers with different npx flag orderings.
func extractServerURL(serverMap map[string]any) string {
	if urlStr, _ := serverMap["url"].(string); urlStr != "" {
		return urlStr
	}
	args, _ := serverMap["args"].([]any)
	for i, arg := range args {
		s, _ := arg.(string)
		if s == "mcp-remote" && i+1 < len(args) {
			if urlStr, _ := args[i+1].(string); urlStr != "" {
				return urlStr
			}
		}
	}
	return ""
}

// detectTransport returns the transport type for a JSON MCP server entry.
// Returns "http" if a url field or type:"http" is present, "stdio" if a command
// field is present, or "" if the format is unrecognized.
// When both url/type and command fields exist, http takes precedence.
func detectTransport(serverMap map[string]any) string {
	if _, ok := serverMap["url"].(string); ok {
		return "http"
	}
	if t, _ := serverMap["type"].(string); t == "http" {
		return "http"
	}
	if _, ok := serverMap["command"].(string); ok {
		return "stdio"
	}
	return ""
}

// serverURLMatcher returns a predicate that matches tiddly MCP URLs based on
// the requested server names. Used by Remove to selectively remove content,
// prompts, or both servers.
func serverURLMatcher(servers []string) func(string) bool {
	wantContent, wantPrompts := false, false
	for _, s := range servers {
		switch s {
		case "content":
			wantContent = true
		case "prompts":
			wantPrompts = true
		}
	}
	switch {
	case wantContent && wantPrompts:
		return isTiddlyURL
	case wantContent:
		return isTiddlyContentURL
	case wantPrompts:
		return isTiddlyPromptURL
	default:
		return isTiddlyURL // empty/nil = match all (safe zero value)
	}
}

// removeJSONServersByTiddlyURL removes entries from a JSON mcpServers map
// whose URL matches the given predicate (checking both HTTP and stdio/npx formats).
func removeJSONServersByTiddlyURL(servers map[string]any, match func(string) bool) bool {
	removed := false
	for name, entry := range servers {
		serverMap, _ := entry.(map[string]any)
		if serverMap == nil {
			continue
		}
		urlStr := extractServerURL(serverMap)
		if match(urlStr) {
			delete(servers, name)
			removed = true
		}
	}
	return removed
}

// canonicalNamesFirst returns keys sorted so that canonical server names
// (serverNameContent, serverNamePrompts) come before other keys, ensuring
// deterministic match selection when both canonical and custom entries exist.
func canonicalNamesFirst(keys []string) []string {
	sort.SliceStable(keys, func(i, j int) bool {
		iCanonical := keys[i] == serverNameContent || keys[i] == serverNamePrompts
		jCanonical := keys[j] == serverNameContent || keys[j] == serverNamePrompts
		if iCanonical != jCanonical {
			return iCanonical
		}
		return strings.Compare(keys[i], keys[j]) < 0
	})
	return keys
}
