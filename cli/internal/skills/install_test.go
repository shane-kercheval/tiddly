package skills

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createZip builds a zip archive with the given files (path -> content).
func createZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	for name, content := range files {
		fw, err := zw.Create(name)
		require.NoError(t, err)
		_, err = fw.Write([]byte(content))
		require.NoError(t, err)
	}

	require.NoError(t, zw.Close())
	return buf.Bytes()
}

func newMockSkillsServer(t *testing.T, contentType string, data []byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/prompts/export/skills":
			w.Header().Set("Content-Type", contentType)
			w.WriteHeader(http.StatusOK)
			w.Write(data)
		default:
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"detail": "not found"})
		}
	}))
}

func TestInstall__tar_gz_extraction(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"code-review/SKILL.md": "---\nname: code-review\n---\nReview code",
		"summarize/SKILL.md":   "---\nname: summarize\n---\nSummarize text",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, filepath.Join(destDir, "skills"))
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, 2, result.SkillCount)
	assert.Contains(t, result.DestPath, "skills")

	// Verify files exist
	content, err := os.ReadFile(filepath.Join(result.DestPath, "code-review", "SKILL.md"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "code-review")

	content, err = os.ReadFile(filepath.Join(result.DestPath, "summarize", "SKILL.md"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "summarize")
}

func TestInstall__zip_extraction_claude_desktop(t *testing.T) {
	archive := createZip(t, map[string]string{
		"code-review.md": "# Code Review\nReview code",
		"summarize.md":   "# Summarize\nSummarize text",
	})

	server := newMockSkillsServer(t, "application/zip", archive)
	defer server.Close()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-desktop", nil, "", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, 2, result.SkillCount)
	assert.NotEmpty(t, result.ZipPath)

	// Verify zip was saved
	_, err = os.Stat(result.ZipPath)
	require.NoError(t, err)

	// Clean up temp file
	os.Remove(result.ZipPath) //nolint:errcheck
}

func TestInstall__global_paths_claude_code(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	expectedPath := filepath.Join(destDir, "claude-skills")
	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, expectedPath)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, expectedPath, result.DestPath)
}

func TestInstall__global_paths_codex(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	expectedPath := filepath.Join(destDir, "codex-skills")
	cleanup := SetToolPathOverride("codex", ScopeGlobal, expectedPath)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "codex", nil, "", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, expectedPath, result.DestPath)
}

func TestInstall__project_paths_claude_code(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	expectedPath := filepath.Join(destDir, "project-skills")
	cleanup := SetToolPathOverride("claude-code", ScopeProject, expectedPath)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", ScopeProject)

	require.NoError(t, err)
	assert.Equal(t, expectedPath, result.DestPath)
}

func TestInstall__project_paths_codex(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	expectedPath := filepath.Join(destDir, "agents-skills")
	cleanup := SetToolPathOverride("codex", ScopeProject, expectedPath)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "codex", nil, "", ScopeProject)

	require.NoError(t, err)
	assert.Equal(t, expectedPath, result.DestPath)
}

func TestInstall__default_scope_is_global(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"my-skill/SKILL.md": "skill content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	globalPath := filepath.Join(destDir, "global-skills")
	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, globalPath)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", "")

	require.NoError(t, err)
	assert.Equal(t, globalPath, result.DestPath)
}

func TestInstall__empty_archive(t *testing.T) {
	// Empty tar.gz
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	require.NoError(t, tw.Close())
	require.NoError(t, gw.Close())

	server := newMockSkillsServer(t, "application/gzip", buf.Bytes())
	defer server.Close()

	destDir := t.TempDir()
	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, filepath.Join(destDir, "skills"))
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, 0, result.SkillCount)
}

func TestInstall__existing_skills_overwritten(t *testing.T) {
	// Create initial skill
	destDir := t.TempDir()
	skillsDir := filepath.Join(destDir, "skills")
	skillDir := filepath.Join(skillsDir, "code-review")
	require.NoError(t, os.MkdirAll(skillDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("old content"), 0644))

	// Download with new content
	archive := testutil.CreateTarGz(t, map[string]string{
		"code-review/SKILL.md": "new content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, skillsDir)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, 1, result.SkillCount)

	content, err := os.ReadFile(filepath.Join(skillsDir, "code-review", "SKILL.md"))
	require.NoError(t, err)
	assert.Equal(t, "new content", string(content))
}

func TestInstall__tag_filtering_passes_query_params(t *testing.T) {
	var capturedTags []string
	var capturedTagMatch string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTags = r.URL.Query()["tags"]
		capturedTagMatch = r.URL.Query().Get("tag_match")

		archive := testutil.CreateTarGz(t, map[string]string{
			"skill1/SKILL.md": "content",
		})
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(archive)
	}))
	defer server.Close()

	destDir := t.TempDir()
	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, filepath.Join(destDir, "skills"))
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	_, err := Install(context.Background(), client, "claude-code", []string{"python", "skill"}, "any", ScopeGlobal)

	require.NoError(t, err)
	assert.Equal(t, []string{"python", "skill"}, capturedTags)
	assert.Equal(t, "any", capturedTagMatch)
}

func TestInstall__claude_desktop_project_scope_error(t *testing.T) {
	client := api.NewClient("http://unused", "test-token", "pat")
	_, err := Install(context.Background(), client, "claude-desktop", nil, "", ScopeProject)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not support --scope project")
}

func TestExtractTarGz__skips_symlinks(t *testing.T) {
	// Build a tar.gz with a symlink entry and a regular file
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	// Add a symlink entry
	require.NoError(t, tw.WriteHeader(&tar.Header{
		Name:     "evil-link",
		Typeflag: tar.TypeSymlink,
		Linkname: "/etc/passwd",
	}))

	// Add a regular file
	content := []byte("safe content")
	require.NoError(t, tw.WriteHeader(&tar.Header{
		Name:     "safe-skill/SKILL.md",
		Mode:     0644,
		Size:     int64(len(content)),
		Typeflag: tar.TypeReg,
	}))
	_, err := tw.Write(content)
	require.NoError(t, err)

	require.NoError(t, tw.Close())
	require.NoError(t, gw.Close())

	destDir := t.TempDir()
	count, err := extractTarGz(buf.Bytes(), destDir)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "should only count the regular file")

	// Verify no symlink was created
	_, err = os.Lstat(filepath.Join(destDir, "evil-link"))
	assert.True(t, os.IsNotExist(err), "symlink should not be extracted")

	// Verify regular file was extracted
	data, err := os.ReadFile(filepath.Join(destDir, "safe-skill", "SKILL.md"))
	require.NoError(t, err)
	assert.Equal(t, "safe content", string(data))
}

func TestInstall__directory_traversal_prevented(t *testing.T) {
	// Archive with path traversal attempt
	archive := testutil.CreateTarGz(t, map[string]string{
		"../../../etc/passwd":  "malicious content",
		"safe-skill/SKILL.md": "safe content",
	})

	server := newMockSkillsServer(t, "application/gzip", archive)
	defer server.Close()

	destDir := t.TempDir()
	skillsDir := filepath.Join(destDir, "skills")
	cleanup := SetToolPathOverride("claude-code", ScopeGlobal, skillsDir)
	defer cleanup()

	client := api.NewClient(server.URL, "test-token", "pat")
	result, err := Install(context.Background(), client, "claude-code", nil, "", ScopeGlobal)

	require.NoError(t, err)
	// Only the safe skill should be extracted
	assert.Equal(t, 1, result.SkillCount)

	// Verify the safe skill was created
	_, err = os.Stat(filepath.Join(skillsDir, "safe-skill", "SKILL.md"))
	require.NoError(t, err)

	// Verify no "etc" directory was created inside the skills dir
	_, err = os.Stat(filepath.Join(skillsDir, "etc"))
	assert.True(t, os.IsNotExist(err))
}
