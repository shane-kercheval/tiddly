package mcp

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// classifyServer is the shared routing primitive for all three detectors.
// Direct tests here guard against regressions propagating symmetrically
// across claude-desktop/claude-code/codex (the reason the helper was
// extracted in the first place).
func TestClassifyServer__routes_by_url(t *testing.T) {
	cases := []struct {
		name       string
		inputName  string
		url        string
		transport  string
		wantMatch  bool        // true → expect *ServerMatch, false → expect *OtherServer
		wantType   string      // only checked when wantMatch
		wantMethod MatchMethod // only checked when wantMatch
	}{
		{
			name:       "content URL with canonical name",
			inputName:  serverNameContent,
			url:        ContentMCPURL(),
			wantMatch:  true,
			wantType:   ServerContent,
			wantMethod: MatchByName,
		},
		{
			name:       "content URL with custom name",
			inputName:  "my_bookmarks",
			url:        ContentMCPURL(),
			wantMatch:  true,
			wantType:   ServerContent,
			wantMethod: MatchByURL,
		},
		{
			name:       "prompts URL with canonical name",
			inputName:  serverNamePrompts,
			url:        PromptMCPURL(),
			wantMatch:  true,
			wantType:   ServerPrompts,
			wantMethod: MatchByName,
		},
		{
			name:       "prompts URL with custom name",
			inputName:  "work_prompts",
			url:        PromptMCPURL(),
			wantMatch:  true,
			wantType:   ServerPrompts,
			wantMethod: MatchByURL,
		},
		{
			name:      "non-tiddly URL",
			inputName: "github",
			url:       "https://github.example.com/mcp",
			transport: "http",
			wantMatch: false,
		},
		{
			name:      "empty URL (stdio with no tiddly target)",
			inputName: "some-other-server",
			url:       "",
			transport: "stdio",
			wantMatch: false,
		},
		{
			// Security-adjacent invariant: a config entry named
			// "tiddly_notes_bookmarks" pointing at an arbitrary URL must NOT
			// be classified as a Tiddly server. URL is authoritative; the
			// name is only a hint for MatchByName tagging. Classifying by
			// name alone would let a hostile or misconfigured entry
			// impersonate a Tiddly route.
			name:      "canonical name with non-tiddly URL — URL wins over name",
			inputName: serverNameContent,
			url:       "https://somewhere-else.example.com/mcp",
			transport: "http",
			wantMatch: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			match, other := classifyServer(tc.inputName, tc.url, tc.transport)

			if tc.wantMatch {
				require.NotNil(t, match, "expected a ServerMatch")
				require.Nil(t, other, "should not also produce an OtherServer")
				assert.Equal(t, tc.wantType, match.ServerType)
				assert.Equal(t, tc.inputName, match.Name)
				assert.Equal(t, tc.wantMethod, match.MatchMethod)
				assert.Equal(t, tc.url, match.URL)
			} else {
				require.Nil(t, match, "should not produce a ServerMatch")
				require.NotNil(t, other, "expected an OtherServer")
				assert.Equal(t, tc.inputName, other.Name)
				assert.Equal(t, tc.url, other.URL,
					"URL must round-trip to OtherServer so preflight can name the offending URL")
				assert.Equal(t, tc.transport, other.Transport,
					"transport should be passed through to OtherServer")
			}
		})
	}
}

func TestClassifyServer__canonical_name_at_non_tiddly_url_records_url(t *testing.T) {
	// Specific coverage for the preflight path: when a CLI-managed key
	// (tiddly_prompts) points at a non-Tiddly URL, it lands in OtherServers
	// and OtherServer.URL must hold the mismatched URL so preflight can
	// surface it in the error.
	const badURL = "https://example.com/my-prompts"
	_, other := classifyServer(serverNamePrompts, badURL, "http")
	require.NotNil(t, other)
	assert.Equal(t, serverNamePrompts, other.Name)
	assert.Equal(t, badURL, other.URL)
}

func TestClassifyServer__transport_ignored_for_tiddly_matches(t *testing.T) {
	// Transport is only surfaced on OtherServer; it must not appear on
	// ServerMatch (which has no Transport field). This test documents
	// the caller contract: pass transport freely, the classifier picks
	// what to keep.
	match, other := classifyServer("my_content", ContentMCPURL(), "stdio")
	require.NotNil(t, match)
	require.Nil(t, other)
	assert.Equal(t, ContentMCPURL(), match.URL, "transport is absent from ServerMatch — URL alone identifies a tiddly server")
}
