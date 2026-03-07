package cmd

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/shane-kercheval/tiddly/cli/internal/skills"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSkillsInstall__with_mock_api(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"code-review/SKILL.md": "---\nname: code-review\n---\nReview code",
		"summarize/SKILL.md":   "---\nname: summarize\n---\nSummarize text",
	})

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/export/skills").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "claude-code", r.URL.Query().Get("client"))
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(archive)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	// Override tool path for testing
	destDir := t.TempDir()
	cleanup := skills.SetToolPathOverride("claude-code", "global", filepath.Join(destDir, "skills"))
	defer cleanup()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Installed 2 skill(s)")
}

func TestSkillsInstall__auto_detect_tools(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/export/skills").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(archive)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")

	execLooker := testutil.NewMockExecLooker()
	execLooker.Paths["claude"] = "/usr/bin/claude"

	setupTestDeps(t, store)
	appDeps.ExecLooker = execLooker

	// Set up config path overrides to control detection.
	// Override codex to a nonexistent path so it isn't detected via ~/.codex/ on the host.
	destDir := t.TempDir()
	cleanupConfig := mcp.SetConfigPathOverride("claude-code", filepath.Join(destDir, "claude.json"))
	defer cleanupConfig()
	cleanupCodexConfig := mcp.SetConfigPathOverride("codex", filepath.Join(destDir, "nonexistent", "config.toml"))
	defer cleanupCodexConfig()
	cleanupSkills := skills.SetToolPathOverride("claude-code", "global", filepath.Join(destDir, "skills"))
	defer cleanupSkills()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "claude-code")
}

func TestSkillsInstall__no_tools_detected(t *testing.T) {
	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")

	execLooker := testutil.NewMockExecLooker()

	setupTestDeps(t, store)
	appDeps.ExecLooker = execLooker

	// Override config paths to non-existent dirs so detection finds nothing
	cleanupCD := mcp.SetConfigPathOverride("claude-desktop", "/nonexistent/claude-desktop/config.json")
	defer cleanupCD()
	cleanupCC := mcp.SetConfigPathOverride("claude-code", "/nonexistent/claude-code/config.json")
	defer cleanupCC()
	cleanupCX := mcp.SetConfigPathOverride("codex", "/nonexistent/codex/config.toml")
	defer cleanupCX()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "no supported AI tools detected")
}

func TestSkillsInstall__scope_project(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/export/skills").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(archive)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	destDir := t.TempDir()
	cleanup := skills.SetToolPathOverride("claude-code", "project", filepath.Join(destDir, ".claude", "skills"))
	defer cleanup()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--scope", "project", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Installed 1 skill(s)")
}

func TestSkillsInstall__scope_project_warns_outside_project(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/export/skills").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(archive)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	// Use a temp dir with no .git/.claude/.agents markers
	tempDir := t.TempDir()
	cleanup := skills.SetToolPathOverride("claude-code", "project", filepath.Join(tempDir, ".claude", "skills"))
	defer cleanup()

	// Change to the temp dir so CWD check sees no project markers
	origDir, err := os.Getwd()
	require.NoError(t, err)
	require.NoError(t, os.Chdir(tempDir))
	t.Cleanup(func() { os.Chdir(origDir) }) //nolint:errcheck

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--scope", "project", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stderr, "does not appear to be a project root")
}

func TestSkillsInstall__invalid_scope(t *testing.T) {
	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--scope", "invalid", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
}

func TestSkillsInstall__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not logged in")
}

func TestSkillsInstall__api_error_returns_nonzero(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/export/skills").
		RespondError(500, "internal server error")

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	destDir := t.TempDir()
	cleanup := skills.SetToolPathOverride("claude-code", "global", filepath.Join(destDir, "skills"))
	defer cleanup()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--api-url", mock.URL())

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "skills install failed")
}

func TestSkillsInstall__empty_response(t *testing.T) {
	// Empty tar.gz
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	require.NoError(t, tw.Close())
	require.NoError(t, gw.Close())

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/export/skills").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(buf.Bytes())
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	destDir := t.TempDir()
	cleanup := skills.SetToolPathOverride("claude-code", "global", filepath.Join(destDir, "skills"))
	defer cleanup()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "install", "claude-code", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "No skills to install")
}

func TestSkillsList__shows_prompts(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(api.PromptListResponse{
			Items: []api.PromptInfo{
				{ID: "p1", Name: "code-review", Description: "Review code changes"},
				{ID: "p2", Name: "summarize", Title: "Text Summarizer"},
			},
			Total:   2,
			HasMore: false,
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "list", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "code-review")
	assert.Contains(t, result.Stdout, "Review code changes")
	assert.Contains(t, result.Stdout, "summarize")
	assert.Contains(t, result.Stdout, "Text Summarizer")
	assert.Contains(t, result.Stdout, "2 prompts")
}

func TestSkillsList__empty(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/prompts/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(api.PromptListResponse{
			Items:   []api.PromptInfo{},
			Total:   0,
			HasMore: false,
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set("pat", "bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "list", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "No prompts found")
}

func TestSkillsList__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "list", "--api-url", "http://unused")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not logged in")
}

func TestParseTags(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"", nil},
		{"skill", []string{"skill"}},
		{"skill,test", []string{"skill", "test"}},
		{" skill , test ", []string{"skill", "test"}},
		{"skill,", []string{"skill"}},    // trailing comma → filter empty
		{",", nil},                       // only comma → nil
		{",,skill,,", []string{"skill"}}, // multiple empties filtered
		{"a, ,b", []string{"a", "b"}}, // whitespace-only entry filtered
	}

	for _, tc := range tests {
		result := parseTags(tc.input)
		assert.Equal(t, tc.expected, result, "input: %q", tc.input)
	}
}

func TestSkillsHelp(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "skills", "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "install")
	assert.Contains(t, result.Stdout, "list")
}
