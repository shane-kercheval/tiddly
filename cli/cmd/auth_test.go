package cmd

import (
	"fmt"
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

func TestAuthStatus__token_flag_overrides(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("flag@example.com"))

	store := testutil.NewMockCredStore() // no stored credentials
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status", "--token", "bm_flag123", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Auth method: flag")
	assert.Contains(t, result.Stdout, "User: flag@example.com")
	assert.NotContains(t, result.Stdout, "Not logged in")
}

func TestAuthStatus__env_token_overrides(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("env@example.com"))

	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	t.Setenv("TIDDLY_TOKEN", "bm_env456")

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Auth method: env")
	assert.Contains(t, result.Stdout, "User: env@example.com")
}

func TestAuthStatus__store_error_surfaced(t *testing.T) {
	store := testutil.NewMockCredStore()
	store.GetErr = fmt.Errorf("credentials file corrupt")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "auth", "status")

	require.NoError(t, result.Err) // command itself doesn't fail
	assert.Contains(t, result.Stdout, "Auth error:")
	assert.Contains(t, result.Stdout, "credentials file corrupt")
	assert.NotContains(t, result.Stdout, "Not logged in")
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
