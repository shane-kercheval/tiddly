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
}

// StatusResult holds the outcome of a status check for a single tool.
type StatusResult struct {
	Servers    []ServerMatch
	ConfigPath string
}

// SortServers sorts the Servers slice so "content" comes before "prompts",
// ensuring deterministic output regardless of map iteration order.
func (sr *StatusResult) SortServers() {
	sort.Slice(sr.Servers, func(i, j int) bool {
		return sr.Servers[i].ServerType < sr.Servers[j].ServerType
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
