package mcp

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUrlPrefix(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"full URL", "https://content-mcp.tiddly.me/mcp", "https://content-mcp.tiddly.me/mcp"},
		{"URL with query", "https://content-mcp.tiddly.me/mcp?key=val", "https://content-mcp.tiddly.me/mcp"},
		{"URL with fragment", "https://content-mcp.tiddly.me/mcp#section", "https://content-mcp.tiddly.me/mcp"},
		{"different path", "https://content-mcp.tiddly.me/other", "https://content-mcp.tiddly.me/other"},
		{"no path", "https://content-mcp.tiddly.me", "https://content-mcp.tiddly.me"},
		{"invalid URL", "not-a-url", "not-a-url"},
		{"trailing slash stripped", "https://content-mcp.tiddly.me/mcp/", "https://content-mcp.tiddly.me/mcp"},
		{"root trailing slash", "https://content-mcp.tiddly.me/", "https://content-mcp.tiddly.me"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, urlPrefix(tt.input))
		})
	}
}

func TestUrlMatchesPrefix(t *testing.T) {
	pattern := urlPrefix("https://content-mcp.tiddly.me/mcp")

	assert.True(t, urlMatchesPrefix("https://content-mcp.tiddly.me/mcp", pattern))
	assert.True(t, urlMatchesPrefix("https://content-mcp.tiddly.me/mcp?key=val", pattern))
	assert.True(t, urlMatchesPrefix("https://content-mcp.tiddly.me/mcp/", pattern), "trailing slash should match")
	assert.False(t, urlMatchesPrefix("https://content-mcp.tiddly.me/other", pattern))
	assert.False(t, urlMatchesPrefix("https://content-mcp.tiddly.me.evil.com/mcp", pattern))
	assert.False(t, urlMatchesPrefix("http://content-mcp.tiddly.me/mcp", pattern), "scheme mismatch")
}

func TestExtractServerURL__http_url_field(t *testing.T) {
	m := map[string]any{"url": "https://example.com/mcp"}
	assert.Equal(t, "https://example.com/mcp", extractServerURL(m))
}

func TestExtractServerURL__stdio_mcp_remote(t *testing.T) {
	m := map[string]any{
		"command": "npx",
		"args":    []any{"mcp-remote", "https://example.com/mcp", "--header", "Authorization: Bearer tok"},
	}
	assert.Equal(t, "https://example.com/mcp", extractServerURL(m))
}

func TestExtractServerURL__stdio_mcp_remote_with_prefix_flags(t *testing.T) {
	m := map[string]any{
		"command": "npx",
		"args":    []any{"-y", "mcp-remote", "https://example.com/mcp", "--header", "Authorization: Bearer tok"},
	}
	assert.Equal(t, "https://example.com/mcp", extractServerURL(m))
}

func TestExtractServerURL__stdio_non_mcp_remote(t *testing.T) {
	m := map[string]any{
		"command": "node",
		"args":    []any{"server.js", "https://example.com/mcp"},
	}
	assert.Equal(t, "", extractServerURL(m))
}

func TestExtractServerURL__empty_map(t *testing.T) {
	assert.Equal(t, "", extractServerURL(map[string]any{}))
}

func TestDetectTransport__url_field(t *testing.T) {
	assert.Equal(t, "http", detectTransport(map[string]any{"url": "https://example.com"}))
}

func TestDetectTransport__type_http(t *testing.T) {
	assert.Equal(t, "http", detectTransport(map[string]any{"type": "http", "command": "npx"}))
}

func TestDetectTransport__command_field(t *testing.T) {
	assert.Equal(t, "stdio", detectTransport(map[string]any{"command": "npx", "args": []any{"server"}}))
}

func TestDetectTransport__url_takes_precedence(t *testing.T) {
	assert.Equal(t, "http", detectTransport(map[string]any{"url": "https://x.com", "command": "npx"}))
}

func TestDetectTransport__empty_map(t *testing.T) {
	assert.Equal(t, "", detectTransport(map[string]any{}))
}

func TestSortOtherServers(t *testing.T) {
	servers := []OtherServer{
		{Name: "zebra", Transport: "stdio"},
		{Name: "alpha", Transport: "http"},
		{Name: "middle", Transport: ""},
	}
	sortOtherServers(servers)
	assert.Equal(t, "alpha", servers[0].Name)
	assert.Equal(t, "middle", servers[1].Name)
	assert.Equal(t, "zebra", servers[2].Name)
}

func TestServerURLMatcher__content_only(t *testing.T) {
	match := serverURLMatcher([]string{"content"})
	assert.True(t, match(ContentMCPURL()), "should match content URL")
	assert.False(t, match(PromptMCPURL()), "should not match prompts URL")
	assert.False(t, match("https://other.example.com"), "should not match non-tiddly URL")
}

func TestServerURLMatcher__prompts_only(t *testing.T) {
	match := serverURLMatcher([]string{"prompts"})
	assert.False(t, match(ContentMCPURL()), "should not match content URL")
	assert.True(t, match(PromptMCPURL()), "should match prompts URL")
	assert.False(t, match("https://other.example.com"), "should not match non-tiddly URL")
}

func TestServerURLMatcher__both(t *testing.T) {
	match := serverURLMatcher([]string{"content", "prompts"})
	assert.True(t, match(ContentMCPURL()), "should match content URL")
	assert.True(t, match(PromptMCPURL()), "should match prompts URL")
	assert.False(t, match("https://other.example.com"), "should not match non-tiddly URL")
}

func TestServerURLMatcher__nil_matches_all(t *testing.T) {
	match := serverURLMatcher(nil)
	assert.True(t, match(ContentMCPURL()), "nil should match content URL")
	assert.True(t, match(PromptMCPURL()), "nil should match prompts URL")
	assert.False(t, match("https://other.example.com"), "nil should not match non-tiddly URL")
}

func TestServerURLMatcher__empty_matches_all(t *testing.T) {
	match := serverURLMatcher([]string{})
	assert.True(t, match(ContentMCPURL()), "empty should match content URL")
	assert.True(t, match(PromptMCPURL()), "empty should match prompts URL")
	assert.False(t, match("https://other.example.com"), "empty should not match non-tiddly URL")
}

func TestCanonicalNamesFirst(t *testing.T) {
	keys := []string{"zebra", serverNamePrompts, "alpha", serverNameContent}
	sorted := canonicalNamesFirst(keys)

	assert.Equal(t, serverNameContent, sorted[0])
	assert.Equal(t, serverNamePrompts, sorted[1])
	assert.Equal(t, "alpha", sorted[2])
	assert.Equal(t, "zebra", sorted[3])
}
