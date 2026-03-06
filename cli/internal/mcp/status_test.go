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
	assert.False(t, urlMatchesPrefix("https://content-mcp.tiddly.me/other", pattern))
	assert.False(t, urlMatchesPrefix("https://content-mcp.tiddly.me.evil.com/mcp", pattern))
	assert.False(t, urlMatchesPrefix("http://content-mcp.tiddly.me/mcp", pattern), "scheme mismatch")
}

func TestCanonicalNamesFirst(t *testing.T) {
	keys := []string{"zebra", serverNamePrompts, "alpha", serverNameContent}
	sorted := canonicalNamesFirst(keys)

	assert.Equal(t, serverNameContent, sorted[0])
	assert.Equal(t, serverNamePrompts, sorted[1])
	assert.Equal(t, "alpha", sorted[2])
	assert.Equal(t, "zebra", sorted[3])
}
