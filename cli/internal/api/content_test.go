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

func TestListContent__bookmarks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		assert.Equal(t, "/bookmarks/", r.URL.Path)
		assert.Equal(t, "0", r.URL.Query().Get("offset"))
		assert.Equal(t, "50", r.URL.Query().Get("limit"))
		// Default: no view param (server defaults to active)
		assert.Empty(t, r.URL.Query()["view"])

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ContentListResponse{
			Items: []map[string]any{
				{"id": "b1", "title": "Example", "url": "https://example.com"},
			},
			Total:   1,
			Offset:  0,
			Limit:   50,
			HasMore: false,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	resp, err := client.ListContent(context.Background(), "bookmark", 0, 50, false)

	require.NoError(t, err)
	assert.Len(t, resp.Items, 1)
	assert.Equal(t, "b1", resp.Items[0]["id"])
	assert.Equal(t, 1, resp.Total)
	assert.False(t, resp.HasMore)
}

func TestListContent__include_archived(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		views := r.URL.Query()["view"]
		assert.Contains(t, views, "active")
		assert.Contains(t, views, "archived")

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ContentListResponse{
			Items:   []map[string]any{},
			Total:   0,
			HasMore: false,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	_, err := client.ListContent(context.Background(), "note", 0, 50, true)
	require.NoError(t, err)
}

func TestListContent__pagination(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		offset := r.URL.Query().Get("offset")

		w.Header().Set("Content-Type", "application/json")
		if offset == "0" {
			_ = json.NewEncoder(w).Encode(ContentListResponse{
				Items:   []map[string]any{{"id": "b1"}},
				Total:   2,
				Offset:  0,
				Limit:   1,
				HasMore: true,
			})
		} else {
			_ = json.NewEncoder(w).Encode(ContentListResponse{
				Items:   []map[string]any{{"id": "b2"}},
				Total:   2,
				Offset:  1,
				Limit:   1,
				HasMore: false,
			})
		}
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	resp, err := client.ListContent(context.Background(), "bookmark", 0, 1, false)
	require.NoError(t, err)
	assert.True(t, resp.HasMore)

	resp2, err := client.ListContent(context.Background(), "bookmark", 1, 1, false)
	require.NoError(t, err)
	assert.False(t, resp2.HasMore)
	assert.Equal(t, 2, callCount)
}

func TestGetContent__bookmark(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		assert.Equal(t, "/bookmarks/b1", r.URL.Path)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "b1",
			"title":   "Example",
			"url":     "https://example.com",
			"content": "Full page content here",
			"tags":    []string{"test"},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	item, err := client.GetContent(context.Background(), "bookmark", "b1")

	require.NoError(t, err)
	assert.Equal(t, "b1", item["id"])
	assert.Equal(t, "Full page content here", item["content"])
}

func TestGetContent__note(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/notes/n1", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "n1",
			"title":   "My Note",
			"content": "# Heading\nNote content",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	item, err := client.GetContent(context.Background(), "note", "n1")

	require.NoError(t, err)
	assert.Equal(t, "# Heading\nNote content", item["content"])
}

func TestGetContent__api_error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"detail": "not found"})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token", "pat")
	_, err := client.GetContent(context.Background(), "bookmark", "nonexistent")

	require.Error(t, err)
	apiErr, ok := err.(*APIError)
	require.True(t, ok)
	assert.Equal(t, 404, apiErr.StatusCode)
}
