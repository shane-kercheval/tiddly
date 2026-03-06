package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/tokens/", r.URL.Path)

		var req TokenCreateRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "test-token", req.Name)
		assert.Nil(t, req.ExpiresInDays)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(TokenCreateResponse{
			ID:          "tok-123",
			Name:        "test-token",
			Token:       "bm_created_token",
			TokenPrefix: "bm_cre",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "oauth-token", "oauth")
	resp, err := client.CreateToken(context.Background(), "test-token", nil)

	require.NoError(t, err)
	assert.Equal(t, "tok-123", resp.ID)
	assert.Equal(t, "bm_created_token", resp.Token)
}

func TestCreateToken__with_expiration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req TokenCreateRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, 90, *req.ExpiresInDays)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		expires := "2026-06-01T00:00:00Z"
		_ = json.NewEncoder(w).Encode(TokenCreateResponse{
			ID:        "tok-456",
			Token:     "bm_expiring",
			ExpiresAt: &expires,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "oauth-token", "oauth")
	days := 90
	resp, err := client.CreateToken(context.Background(), "expiring-token", &days)

	require.NoError(t, err)
	assert.Equal(t, "bm_expiring", resp.Token)
	assert.NotNil(t, resp.ExpiresAt)
}

func TestListTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		assert.Equal(t, "/tokens/", r.URL.Path)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]TokenInfo{
			{ID: "tok-1", Name: "mcp-content", TokenPrefix: "bm_abc"},
			{ID: "tok-2", Name: "mcp-prompts", TokenPrefix: "bm_def"},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "oauth-token", "oauth")
	tokens, err := client.ListTokens(context.Background())

	require.NoError(t, err)
	assert.Len(t, tokens, 2)
	assert.Equal(t, "mcp-content", tokens[0].Name)
}

func TestDeleteToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "DELETE", r.Method)
		assert.Equal(t, "/tokens/tok-123", r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewClient(server.URL, "oauth-token", "oauth")
	err := client.DeleteToken(context.Background(), "tok-123")

	require.NoError(t, err)
}

func TestCreateToken__403_for_pat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"detail": "PAT access not allowed",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "bm_test", "pat")
	_, err := client.CreateToken(context.Background(), "test", nil)

	require.Error(t, err)
	apiErr, ok := err.(*APIError)
	require.True(t, ok)
	assert.Equal(t, 403, apiErr.StatusCode)
}

func TestGetContentCount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		assert.Equal(t, "/bookmarks/", r.URL.Path)
		assert.Equal(t, "1", r.URL.Query().Get("limit"))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ContentListResponse{
			Items:   []map[string]any{{"id": "1"}},
			Total:   42,
			Offset:  0,
			Limit:   1,
			HasMore: true,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	count, err := client.GetContentCount(context.Background(), "bookmark")

	require.NoError(t, err)
	assert.Equal(t, 42, count)
}
