package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthStatus__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Not logged in")
}

func TestAuthStatus__logged_in_with_pat(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com"))

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Auth method: pat")
	assert.Contains(t, result.Stdout, "User: user@example.com")
}

func TestAuthStatus__logged_in_with_oauth(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("oauth@example.com"))

	store := testutil.CredsWithOAuth("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjo5OTk5OTk5OTk5fQ.sig", "")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Auth method: oauth")
	assert.Contains(t, result.Stdout, "User: oauth@example.com")
}

func TestAuthStatus__api_error_shows_graceful_message(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").RespondError(500, "server error")

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status", "--api-url", mock.URL())

	require.NoError(t, result.Err) // Should not error, just show info
	assert.Contains(t, result.Stdout, "Auth method: pat")
	assert.Contains(t, result.Stdout, "unknown")
}
