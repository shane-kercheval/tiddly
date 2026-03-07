package update

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLatestRelease__parses_github_response(t *testing.T) {
	osName := runtime.GOOS
	archName := runtime.GOARCH

	// Tag has monorepo prefix "cli/v1.2.3" — should be stripped to "v1.2.3"
	body := fmt.Sprintf(`{
		"tag_name": "cli/v1.2.3",
		"assets": [
			{"name": "tiddly_1.2.3_%s_%s.tar.gz", "browser_download_url": "https://example.com/binary.tar.gz"},
			{"name": "checksums.txt", "browser_download_url": "https://example.com/checksums.txt"}
		]
	}`, osName, archName)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	checker := &GitHubChecker{
		Client: srv.Client(),
		Owner:  "test",
		Repo:   "test",
	}
	// Override the URL by using a custom transport
	checker.Client.Transport = rewriteTransport{base: srv.URL}

	info, err := checker.LatestRelease(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "v1.2.3", info.Version)
	assert.Contains(t, info.AssetURL, "binary.tar.gz")
	assert.Contains(t, info.ChecksumURL, "checksums.txt")
}

func TestLatestRelease__no_matching_asset(t *testing.T) {
	body := `{
		"tag_name": "v1.0.0",
		"assets": [
			{"name": "tiddly_1.0.0_plan9_mips.tar.gz", "browser_download_url": "https://example.com/nope.tar.gz"}
		]
	}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	checker := &GitHubChecker{
		Client: srv.Client(),
		Owner:  "test",
		Repo:   "test",
	}
	checker.Client.Transport = rewriteTransport{base: srv.URL}

	_, err := checker.LatestRelease(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no release asset found")
}

func TestLatestRelease__skips_non_tarball_assets(t *testing.T) {
	osName := runtime.GOOS
	archName := runtime.GOARCH

	// Include a .sbom.json file that matches the OS/arch pattern but isn't a tarball
	body := fmt.Sprintf(`{
		"tag_name": "v1.0.0",
		"assets": [
			{"name": "tiddly_1.0.0_%s_%s.sbom.json", "browser_download_url": "https://example.com/sbom.json"},
			{"name": "tiddly_1.0.0_%s_%s.tar.gz", "browser_download_url": "https://example.com/binary.tar.gz"},
			{"name": "checksums.txt", "browser_download_url": "https://example.com/checksums.txt"}
		]
	}`, osName, archName, osName, archName)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	checker := &GitHubChecker{
		Client: srv.Client(),
		Owner:  "test",
		Repo:   "test",
	}
	checker.Client.Transport = rewriteTransport{base: srv.URL}

	info, err := checker.LatestRelease(context.Background())
	require.NoError(t, err)
	assert.Contains(t, info.AssetURL, "binary.tar.gz")
}

func TestParseChecksums__valid(t *testing.T) {
	input := "abc123  tiddly_1.0.0_linux_amd64.tar.gz\ndef456  tiddly_1.0.0_darwin_arm64.tar.gz\n"
	checksums, err := ParseChecksums(strings.NewReader(input))
	require.NoError(t, err)
	assert.Equal(t, "abc123", checksums["tiddly_1.0.0_linux_amd64.tar.gz"])
	assert.Equal(t, "def456", checksums["tiddly_1.0.0_darwin_arm64.tar.gz"])
}

func TestParseChecksums__empty(t *testing.T) {
	_, err := ParseChecksums(strings.NewReader(""))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no checksums found")
}

func TestVerifyChecksum__match(t *testing.T) {
	data := []byte("hello world")
	// SHA256 of "hello world"
	expected := "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
	err := VerifyChecksum(data, expected)
	require.NoError(t, err)
}

func TestVerifyChecksum__mismatch(t *testing.T) {
	data := []byte("hello world")
	err := VerifyChecksum(data, "0000000000000000000000000000000000000000000000000000000000000000")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "checksum mismatch")
}

func TestIsNewer__various(t *testing.T) {
	tests := []struct {
		name     string
		current  string
		latest   string
		expected bool
	}{
		{"newer patch", "v1.0.0", "v1.0.1", true},
		{"newer minor", "v1.0.0", "v1.1.0", true},
		{"newer major", "v1.0.0", "v2.0.0", true},
		{"same version", "v1.0.0", "v1.0.0", false},
		{"older version", "v1.1.0", "v1.0.0", false},
		{"no v prefix current", "1.0.0", "v1.0.1", true},
		{"no v prefix latest", "v1.0.0", "1.0.1", true},
		{"no v prefix both", "1.0.0", "1.0.1", true},
		{"dev is not valid semver", "dev", "v1.0.0", false},
		{"pre-release newer", "v1.0.0", "v1.1.0-rc.1", true},
		{"pre-release older than release", "v1.1.0", "v1.1.0-rc.1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsNewer(tt.current, tt.latest)
			assert.Equal(t, tt.expected, result, "IsNewer(%q, %q)", tt.current, tt.latest)
		})
	}
}

func TestNeedsCheck__within_24h(t *testing.T) {
	assert.False(t, NeedsCheck(time.Now().Add(-23*time.Hour)))
}

func TestNeedsCheck__after_24h(t *testing.T) {
	assert.True(t, NeedsCheck(time.Now().Add(-25*time.Hour)))
}

func TestNeedsCheck__zero_time(t *testing.T) {
	assert.True(t, NeedsCheck(time.Time{}))
}

func TestExtractBinary__valid_tarball(t *testing.T) {
	content := "fake-binary-content"
	archive := testutil.CreateTarGz(t, map[string]string{
		"tiddly": content,
	})

	data, err := ExtractBinary(bytes.NewReader(archive))
	require.NoError(t, err)
	assert.Equal(t, content, string(data))
}

func TestExtractBinary__missing_binary(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"README.md": "hello",
	})

	_, err := ExtractBinary(bytes.NewReader(archive))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found in archive")
}

func TestReplaceBinaryAt__success(t *testing.T) {
	// Create a fake "current binary" in a temp dir
	dir := t.TempDir()
	binPath := filepath.Join(dir, "tiddly")
	err := os.WriteFile(binPath, []byte("old-binary"), 0755)
	require.NoError(t, err)

	newContent := []byte("new-binary-content")
	err = ReplaceBinaryAt(newContent, binPath)
	require.NoError(t, err)

	// Verify replacement
	data, err := os.ReadFile(binPath)
	require.NoError(t, err)
	assert.Equal(t, "new-binary-content", string(data))

	// Verify permissions preserved
	info, err := os.Stat(binPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0755), info.Mode().Perm())
}

func TestReplaceBinaryAt__no_temp_files_on_error(t *testing.T) {
	dir := t.TempDir()
	binPath := filepath.Join(dir, "nonexistent")

	err := ReplaceBinaryAt([]byte("data"), binPath)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "stat")

	// Ensure no temp files left behind
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

// rewriteTransport rewrites all request URLs to point at the test server.
type rewriteTransport struct {
	base string
}

func (t rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req.URL.Scheme = "http"
	req.URL.Host = strings.TrimPrefix(t.base, "http://")
	return http.DefaultTransport.RoundTrip(req)
}
