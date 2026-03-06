package cmd

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTokensList__shows_tokens(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").RespondJSON(200, []map[string]any{
		{
			"id":           "tok-1",
			"name":         "MCP Content",
			"token_prefix": "bm_abc",
			"last_used_at": "2026-03-01T10:00:00Z",
			"expires_at":   nil,
			"created_at":   "2026-02-01T10:00:00Z",
		},
		{
			"id":           "tok-2",
			"name":         "CI Pipeline",
			"token_prefix": "bm_def",
			"last_used_at": nil,
			"expires_at":   "2026-06-01T00:00:00Z",
			"created_at":   "2026-03-01T10:00:00Z",
		},
	})

	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "list", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "MCP Content")
	assert.Contains(t, result.Stdout, "bm_abc")
	assert.Contains(t, result.Stdout, "CI Pipeline")
	assert.Contains(t, result.Stdout, "bm_def")
	assert.Contains(t, result.Stdout, "2026-03-01")
}

func TestTokensList__empty(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").RespondJSON(200, []map[string]any{})

	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "list", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "No tokens found.")
}

func TestTokensList__403_pat_auth(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(403)
		_ = json.NewEncoder(w).Encode(map[string]string{"detail": "PAT access not allowed"})
	})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "list", "--api-url", mock.URL())

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "browser login")
}

func TestTokensCreate__displays_token(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("POST", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		assert.Equal(t, "My Token", req["name"])
		assert.Nil(t, req["expires_in_days"])

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           "tok-new",
			"name":         "My Token",
			"token":        "bm_created_secret_token",
			"token_prefix": "bm_cre",
			"expires_at":   nil,
		})
	})

	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "My Token", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "bm_created_secret_token")
	assert.Contains(t, result.Stdout, "Token created successfully.")
	assert.Contains(t, result.Stderr, "will not be shown again")
}

func TestTokensCreate__with_expires(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("POST", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		assert.Equal(t, float64(90), req["expires_in_days"])

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           "tok-exp",
			"name":         "CI Token",
			"token":        "bm_expiring_token",
			"token_prefix": "bm_exp",
			"expires_at":   "2026-06-01T00:00:00Z",
		})
	})

	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "CI Token", "--expires", "90", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "bm_expiring_token")
	assert.Contains(t, result.Stdout, "Expires:")
}

func TestTokensCreate__expires_zero(t *testing.T) {
	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "Test", "--expires", "0", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "--expires must be between 1 and 365")
}

func TestTokensCreate__expires_negative(t *testing.T) {
	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "Test", "--expires", "-1", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "--expires must be between 1 and 365")
}

func TestTokensCreate__expires_too_large(t *testing.T) {
	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "Test", "--expires", "366", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "--expires must be between 1 and 365")
}

func TestTokensCreate__missing_name(t *testing.T) {
	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "accepts 1 arg")
}

func TestTokensCreate__403_pat_auth(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("POST", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(403)
		_ = json.NewEncoder(w).Encode(map[string]string{"detail": "PAT access not allowed"})
	})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "create", "Test", "--api-url", mock.URL())

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "browser login")
}

func TestTokensDelete__with_force(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("DELETE", "/tokens/tok-123").Respond(204, nil).AssertCalled(1)

	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "delete", "tok-123", "--force", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Token deleted.")
}

func TestTokensDelete__no_force_non_tty(t *testing.T) {
	// In test, stdin is not a TTY, so without --force it should error
	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "delete", "tok-123", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "--force")
}

func TestTokensDelete__403_pat_auth(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("DELETE", "/tokens/tok-123").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(403)
		_ = json.NewEncoder(w).Encode(map[string]string{"detail": "PAT access not allowed"})
	})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "delete", "tok-123", "--force", "--api-url", mock.URL())

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "browser login")
}

func TestTokensDelete__missing_id(t *testing.T) {
	store := testutil.CredsWithOAuth("oauth-access", "oauth-refresh")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "delete", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "accepts 1 arg")
}

func TestTokens__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "list", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not logged in")
}

func TestTokensHelp(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "tokens", "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "tokens list")
	assert.Contains(t, result.Stdout, "tokens create")
	assert.Contains(t, result.Stdout, "tokens delete")
}
