package mcp

import (
	"net/url"
	"sort"
	"strings"
)

// Server name constants used across CLI flags, config keys, and token naming.
const (
	ServerContent = "content"
	ServerPrompts = "prompts"
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
	URL       string // MCP server URL (may be empty for stdio entries whose args don't carry one)
	Transport string // "http", "stdio", or "" if unknown
}

// StatusResult holds the outcome of a status check for a single tool.
type StatusResult struct {
	Servers      []ServerMatch // tiddly servers
	OtherServers []OtherServer // non-tiddly servers
	ConfigPath   string
}

// SortServers sorts the Servers slice so "content" comes before "prompts",
// with secondary sort by config key name so multiple entries of the same
// type (e.g. work_prompts and personal_prompts) render in stable order.
func (sr *StatusResult) SortServers() {
	sort.Slice(sr.Servers, func(i, j int) bool {
		if sr.Servers[i].ServerType != sr.Servers[j].ServerType {
			return sr.Servers[i].ServerType < sr.Servers[j].ServerType
		}
		return sr.Servers[i].Name < sr.Servers[j].Name
	})
}

// sortOtherServers sorts OtherServer entries alphabetically by name.
func sortOtherServers(servers []OtherServer) {
	sort.Slice(servers, func(i, j int) bool {
		return servers[i].Name < servers[j].Name
	})
}

// classifyServer routes a single config entry to the Tiddly servers list or
// the "other" list based on its URL. Used by all three tool detectors to keep
// classification logic in one place and prevent parallel bugs across handlers.
//
// Returns exactly one non-nil pointer: either a *ServerMatch (tiddly content or
// prompts URL) or an *OtherServer (any other URL). transport is used only when
// building the OtherServer; ignored for tiddly matches.
func classifyServer(name, urlStr, transport string) (*ServerMatch, *OtherServer) {
	method := MatchByURL
	if name == serverNameContent || name == serverNamePrompts {
		method = MatchByName
	}
	switch {
	case isTiddlyContentURL(urlStr):
		return &ServerMatch{ServerType: ServerContent, Name: name, MatchMethod: method, URL: urlStr}, nil
	case isTiddlyPromptURL(urlStr):
		return &ServerMatch{ServerType: ServerPrompts, Name: name, MatchMethod: method, URL: urlStr}, nil
	default:
		return nil, &OtherServer{Name: name, URL: urlStr, Transport: transport}
	}
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

// sortCanonicalFirst sorts keys in place so that canonical server names
// (serverNameContent, serverNamePrompts) come before other keys, then
// alphabetically within each group. Used by the extractors so a canonical
// entry's PAT wins over custom entries when multiple tiddly-URL entries
// exist — and the alphabetical tiebreaker makes the selection deterministic
// when no canonical entry is present.
//
// Status no longer uses this ordering (it surfaces every entry), but
// ExtractPATs / AllTiddlyPATs must pick a deterministic order, and the
// consolidation warning's "PAT from X will be reused" disclosure has to
// match whatever the extractors actually do. Deleting this function would
// silently diverge those — don't.
func sortCanonicalFirst(keys []string) {
	sort.SliceStable(keys, func(i, j int) bool {
		iCanonical := keys[i] == serverNameContent || keys[i] == serverNamePrompts
		jCanonical := keys[j] == serverNameContent || keys[j] == serverNamePrompts
		if iCanonical != jCanonical {
			return iCanonical
		}
		return strings.Compare(keys[i], keys[j]) < 0
	})
}
