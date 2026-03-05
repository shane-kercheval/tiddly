package cmd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockExportAPI sets up a mock API that responds to list and get endpoints for export.
func mockExportAPI(t *testing.T) *testutil.MockAPI {
	t.Helper()
	mock := testutil.NewMockAPI(t)

	// Bookmarks list
	mock.On("GET", "/bookmarks/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":    []map[string]any{{"id": "b1", "title": "Bookmark 1"}},
			"total":    1,
			"offset":   0,
			"limit":    100,
			"has_more": false,
		})
	})
	// Bookmark detail
	mock.On("GET", "/bookmarks/b1").
		RespondJSON(200, map[string]any{
			"id":      "b1",
			"title":   "Bookmark 1",
			"url":     "https://example.com",
			"content": "Page content",
			"tags":    []string{"test"},
		})

	// Notes list
	mock.On("GET", "/notes/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":    []map[string]any{{"id": "n1", "title": "Note 1"}},
			"total":    1,
			"offset":   0,
			"limit":    100,
			"has_more": false,
		})
	})
	mock.On("GET", "/notes/n1").
		RespondJSON(200, map[string]any{
			"id":      "n1",
			"title":   "Note 1",
			"content": "Note content",
			"tags":    []string{"notes"},
		})

	// Prompts list
	mock.On("GET", "/prompts/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":    []map[string]any{{"id": "p1", "name": "my-prompt"}},
			"total":    1,
			"offset":   0,
			"limit":    100,
			"has_more": false,
		})
	})
	mock.On("GET", "/prompts/p1").
		RespondJSON(200, map[string]any{
			"id":      "p1",
			"name":    "my-prompt",
			"content": "Prompt template",
			"tags":    []string{"prompts"},
		})

	return mock
}

func TestExport__all_types_to_stdout(t *testing.T) {
	mock := mockExportAPI(t)
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--api-url", mock.URL())

	require.NoError(t, result.Err)

	// Parse the JSON output
	var exported map[string]any
	err := json.Unmarshal([]byte(result.Stdout), &exported)
	require.NoError(t, err, "output should be valid JSON: %s", result.Stdout)

	assert.Contains(t, exported, "exported_at")
	assert.Contains(t, exported, "bookmarks")
	assert.Contains(t, exported, "notes")
	assert.Contains(t, exported, "prompts")

	bookmarks := exported["bookmarks"].([]any)
	assert.Len(t, bookmarks, 1)
	bm := bookmarks[0].(map[string]any)
	assert.Equal(t, "b1", bm["id"])
	assert.Equal(t, "Page content", bm["content"])

	notes := exported["notes"].([]any)
	assert.Len(t, notes, 1)

	prompts := exported["prompts"].([]any)
	assert.Len(t, prompts, 1)
}

func TestExport__single_type(t *testing.T) {
	mock := mockExportAPI(t)
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark", "--api-url", mock.URL())

	require.NoError(t, result.Err)

	var exported map[string]any
	err := json.Unmarshal([]byte(result.Stdout), &exported)
	require.NoError(t, err)

	assert.Contains(t, exported, "bookmarks")
	assert.NotContains(t, exported, "notes")
	assert.NotContains(t, exported, "prompts")
}

func TestExport__output_to_file(t *testing.T) {
	mock := mockExportAPI(t)
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	outFile := filepath.Join(t.TempDir(), "export.json")

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark", "--output", outFile, "--api-url", mock.URL())

	require.NoError(t, result.Err)

	// stdout should be empty (JSON goes to file)
	assert.Empty(t, result.Stdout)

	// stderr should have progress and summary
	assert.Contains(t, result.Stderr, "Exporting bookmarks")
	assert.Contains(t, result.Stderr, "Exported 1 bookmarks")

	// File should contain valid JSON
	data, err := os.ReadFile(outFile)
	require.NoError(t, err)

	var exported map[string]any
	require.NoError(t, json.Unmarshal(data, &exported))
	assert.Contains(t, exported, "bookmarks")
}

func TestExport__empty_results(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/bookmarks/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":    []map[string]any{},
			"total":    0,
			"offset":   0,
			"limit":    100,
			"has_more": false,
		})
	})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark", "--api-url", mock.URL())

	require.NoError(t, result.Err)

	var exported map[string]any
	err := json.Unmarshal([]byte(result.Stdout), &exported)
	require.NoError(t, err)

	bookmarks := exported["bookmarks"].([]any)
	assert.Empty(t, bookmarks)
}

func TestExport__pagination(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	var callCount atomic.Int32
	mock.On("GET", "/notes/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		offset := r.URL.Query().Get("offset")
		w.Header().Set("Content-Type", "application/json")
		if offset == "0" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items":    []map[string]any{{"id": "n1"}, {"id": "n2"}},
				"total":    3,
				"offset":   0,
				"limit":    2,
				"has_more": true,
			})
		} else {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items":    []map[string]any{{"id": "n3"}},
				"total":    3,
				"offset":   2,
				"limit":    2,
				"has_more": false,
			})
		}
	})
	for _, id := range []string{"n1", "n2", "n3"} {
		id := id
		mock.On("GET", fmt.Sprintf("/notes/%s", id)).
			RespondJSON(200, map[string]any{"id": id, "title": "Note " + id, "content": "Content " + id})
	}

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "note", "--api-url", mock.URL())

	require.NoError(t, result.Err)

	var exported map[string]any
	require.NoError(t, json.Unmarshal([]byte(result.Stdout), &exported))

	notes := exported["notes"].([]any)
	assert.Len(t, notes, 3)
	assert.True(t, callCount.Load() >= 2, "should have made at least 2 list calls for pagination")
}

func TestExport__include_archived(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/bookmarks/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		views := r.URL.Query()["view"]
		assert.Contains(t, views, "active")
		assert.Contains(t, views, "archived")

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":    []map[string]any{},
			"total":    0,
			"has_more": false,
		})
	})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark", "--include-archived", "--api-url", mock.URL())

	require.NoError(t, result.Err)
}

func TestExport__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not logged in")
}

func TestExport__invalid_type(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "invalid", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid type")
}

func TestExport__empty_types(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "--types flag requires at least one value")
}

func TestExport__progress_to_stderr_not_stdout(t *testing.T) {
	mock := mockExportAPI(t)
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	outFile := filepath.Join(t.TempDir(), "export.json")

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark", "--output", outFile, "--api-url", mock.URL())

	require.NoError(t, result.Err)

	// Progress goes to stderr
	assert.Contains(t, result.Stderr, "Exporting")

	// File should be valid JSON (no progress messages mixed in)
	data, err := os.ReadFile(outFile)
	require.NoError(t, err)
	var exported map[string]any
	require.NoError(t, json.Unmarshal(data, &exported), "file should be valid JSON without progress messages")
}

func TestExport__duplicate_types_deduped(t *testing.T) {
	mock := mockExportAPI(t)
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark,bookmark", "--api-url", mock.URL())

	require.NoError(t, result.Err)

	var exported map[string]any
	require.NoError(t, json.Unmarshal([]byte(result.Stdout), &exported))

	// Should only have one bookmarks array, not duplicated
	assert.Contains(t, exported, "bookmarks")
	bookmarks := exported["bookmarks"].([]any)
	assert.Len(t, bookmarks, 1)
}

func TestExport__missing_id_in_list_response(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/bookmarks/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":    []map[string]any{{"title": "No ID"}},
			"total":    1,
			"has_more": false,
		})
	})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--types", "bookmark", "--api-url", mock.URL())

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "missing id field")
}

func TestExportHelp(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "export", "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "--types")
	assert.Contains(t, result.Stdout, "--output")
	assert.Contains(t, result.Stdout, "--include-archived")
}
