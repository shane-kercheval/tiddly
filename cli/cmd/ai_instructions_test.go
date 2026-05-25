package cmd

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAIInstructions__prints_fetched_body(t *testing.T) {
	const body = "# Tiddly CLI Instructions\n\nDo the thing.\n"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/llms-cli-instructions.txt", r.URL.Path)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	t.Setenv("TIDDLY_WEB_URL", srv.URL)

	result := testutil.ExecuteCmd(t, newRootCmd(), "ai-instructions")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Do the thing.")
	assert.Empty(t, result.Stderr)
}

func TestAIInstructions__falls_back_on_non_200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()
	t.Setenv("TIDDLY_WEB_URL", srv.URL)

	result := testutil.ExecuteCmd(t, newRootCmd(), "ai-instructions")

	// Never fails: exits 0 with the fallback on stdout and a note on stderr.
	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "https://tiddly.me/llms-cli-instructions.txt")
	assert.Contains(t, result.Stdout, "tiddly mcp configure")
	assert.Contains(t, result.Stderr, "could not fetch")
}

func TestAIInstructions__falls_back_on_network_failure(t *testing.T) {
	// A server we immediately close → connection refused on fetch.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()
	t.Setenv("TIDDLY_WEB_URL", url)

	result := testutil.ExecuteCmd(t, newRootCmd(), "ai-instructions")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "offline fallback")
	assert.Contains(t, result.Stderr, "could not fetch")
}

func TestAIInstructions__help_advertises_agent_first(t *testing.T) {
	result := testutil.ExecuteCmd(t, newRootCmd(), "ai-instructions", "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "run this first")
	assert.Contains(t, result.Stdout, "https://tiddly.me/llms-cli-instructions.txt")
}

func TestAIInstructions__default_fetch_url(t *testing.T) {
	assert.Equal(t, "https://tiddly.me", config.DefaultWebURL)
	assert.Equal(t, "https://tiddly.me/llms-cli-instructions.txt", config.DefaultWebURL+llmsCLIInstructionsPath)
}

func TestAIInstructions__skips_dep_init_and_needs_no_auth(t *testing.T) {
	// Proves the command does no credential/config init and starts no update check:
	// with deps cleared, a normal command would initialize them in PersistentPreRunE,
	// but ai-instructions short-circuits before that block — so appDeps stays nil.
	SetDeps(nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("instructions"))
	}))
	defer srv.Close()
	t.Setenv("TIDDLY_WEB_URL", srv.URL)

	result := testutil.ExecuteCmd(t, newRootCmd(), "ai-instructions")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "instructions")
	assert.Nil(t, appDeps, "ai-instructions must not initialize deps (no auth/config side effects)")
	assert.Nil(t, updateCheckResult, "ai-instructions must not start a background update check")
}
