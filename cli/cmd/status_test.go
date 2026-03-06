package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatus__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly CLI vdev")
	assert.Contains(t, result.Stdout, "Not logged in")
}

func TestStatus__with_pat(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/health").
		RespondJSON(200, testutil.HealthResponse())
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com"))
	mock.On("GET", "/bookmarks/").
		RespondJSON(200, map[string]any{"items": []any{}, "total": 10, "offset": 0, "limit": 1, "has_more": true})
	mock.On("GET", "/notes/").
		RespondJSON(200, map[string]any{"items": []any{}, "total": 5, "offset": 0, "limit": 1, "has_more": true})
	mock.On("GET", "/prompts/").
		RespondJSON(200, map[string]any{"items": []any{}, "total": 3, "offset": 0, "limit": 1, "has_more": false})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Logged in")
	assert.Contains(t, result.Stdout, "pat")
	assert.Contains(t, result.Stdout, "user@example.com")
	// Content counts should appear
	assert.Contains(t, result.Stdout, "bookmarks:")
	assert.Contains(t, result.Stdout, "10")
	assert.Contains(t, result.Stdout, "notes:")
	assert.Contains(t, result.Stdout, "5")
	assert.Contains(t, result.Stdout, "prompts:")
	assert.Contains(t, result.Stdout, "3")
}

func TestStatus__api_unreachable(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/health").RespondError(500, "internal server error")
	// /users/me should NOT be called when API is unreachable
	// (no route registered — mock will fail the test if it's called)

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--api-url", mock.URL())

	require.NoError(t, result.Err) // Command itself doesn't error
	assert.Contains(t, result.Stdout, "Logged in")
	assert.Contains(t, result.Stdout, "Unreachable")
}

func TestStatus__shows_version(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly CLI vdev")
}
