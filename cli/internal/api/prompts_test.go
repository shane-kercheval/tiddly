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

func TestListPrompts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		assert.Equal(t, "/prompts/", r.URL.Path)
		assert.Equal(t, "0", r.URL.Query().Get("offset"))
		assert.Equal(t, "50", r.URL.Query().Get("limit"))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(PromptListResponse{
			Items: []PromptInfo{
				{ID: "p1", Name: "code-review", Title: "Code Review", Description: "Review code"},
				{ID: "p2", Name: "summarize", Title: "Summarize", Description: "Summarize text"},
			},
			Total:   2,
			Offset:  0,
			Limit:   50,
			HasMore: false,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	resp, err := client.ListPrompts(context.Background(), nil, "", 0, 50)

	require.NoError(t, err)
	assert.Len(t, resp.Items, 2)
	assert.Equal(t, "code-review", resp.Items[0].Name)
	assert.Equal(t, 2, resp.Total)
}

func TestListPrompts__with_tags(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, []string{"python", "skill"}, r.URL.Query()["tags"])
		assert.Equal(t, "any", r.URL.Query().Get("tag_match"))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(PromptListResponse{
			Items:   []PromptInfo{{ID: "p1", Name: "py-helper"}},
			Total:   1,
			HasMore: false,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	resp, err := client.ListPrompts(context.Background(), []string{"python", "skill"}, "any", 0, 50)

	require.NoError(t, err)
	assert.Len(t, resp.Items, 1)
}

func TestExportSkills__success(t *testing.T) {
	archiveData := []byte("fake-tar-gz-data")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		assert.Equal(t, "/prompts/export/skills", r.URL.Path)
		assert.Equal(t, "claude-code", r.URL.Query().Get("client"))
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		assert.Equal(t, "cli", r.Header.Get("X-Request-Source"))

		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(archiveData)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	resp, err := client.ExportSkills(context.Background(), "claude-code", nil, "")

	require.NoError(t, err)
	defer resp.Body.Close() //nolint:errcheck
	assert.Equal(t, "application/gzip", resp.ContentType)
}

func TestExportSkills__with_tags(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, []string{"python", "skill"}, r.URL.Query()["tags"])
		assert.Equal(t, "any", r.URL.Query().Get("tag_match"))

		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("data"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	resp, err := client.ExportSkills(context.Background(), "claude-code", []string{"python", "skill"}, "any")

	require.NoError(t, err)
	resp.Body.Close() //nolint:errcheck
}

func TestExportSkills__api_error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"detail": "invalid token"})
	}))
	defer server.Close()

	client := NewClient(server.URL, "bad-token", "pat")
	_, err := client.ExportSkills(context.Background(), "claude-code", nil, "")

	require.Error(t, err)
	apiErr, ok := err.(*APIError)
	require.True(t, ok)
	assert.Equal(t, 401, apiErr.StatusCode)
}
