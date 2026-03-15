package cmd

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/shane-kercheval/tiddly/cli/internal/update"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockChecker implements update.Checker for testing.
type mockChecker struct {
	release     *update.ReleaseInfo
	releaseErr  error
	downloads   map[string][]byte
	downloadErr error
}

func (m *mockChecker) LatestRelease(_ context.Context) (*update.ReleaseInfo, error) {
	return m.release, m.releaseErr
}

func (m *mockChecker) Download(_ context.Context, url string) (io.ReadCloser, error) {
	if m.downloadErr != nil {
		return nil, m.downloadErr
	}
	data, ok := m.downloads[url]
	if !ok {
		return nil, fmt.Errorf("not found: %s", url)
	}
	return io.NopCloser(strings.NewReader(string(data))), nil
}

func TestUpdate__already_up_to_date(t *testing.T) {
	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore: creds,
		UpdateChecker: &mockChecker{
			release: &update.ReleaseInfo{Version: "v1.0.0"},
		},
	})
	t.Cleanup(func() { SetDeps(nil) })

	// Set current version to same
	old := cliVersion
	cliVersion = "1.0.0"
	t.Cleanup(func() { cliVersion = old })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "update")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Already up to date")
}

func TestUpdate__successful_update(t *testing.T) {
	// Create a tar.gz with a "tiddly" binary
	archive := testutil.CreateTarGz(t, map[string]string{
		"tiddly": "new-binary-content",
	})

	// Compute checksum
	h := sha256.Sum256(archive)
	checksumHex := fmt.Sprintf("%x", h)
	checksumContent := fmt.Sprintf("%s  tiddly_2.0.0_test_amd64.tar.gz\n", checksumHex)

	checker := &mockChecker{
		release: &update.ReleaseInfo{
			Version:     "v2.0.0",
			AssetURL:    "https://example.com/tiddly_2.0.0_test_amd64.tar.gz",
			ChecksumURL: "https://example.com/checksums.txt",
		},
		downloads: map[string][]byte{
			"https://example.com/tiddly_2.0.0_test_amd64.tar.gz": archive,
			"https://example.com/checksums.txt":                   []byte(checksumContent),
		},
	}

	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore:     creds,
		UpdateChecker: checker,
	})
	t.Cleanup(func() { SetDeps(nil) })

	old := cliVersion
	cliVersion = "1.0.0"
	t.Cleanup(func() { cliVersion = old })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "update")

	// ReplaceBinary will fail because os.Executable() points to the test binary,
	// but we can verify the flow got past download and checksum verification
	// by checking for either success message or a replace error (not a checksum error)
	if result.Err != nil {
		assert.NotContains(t, result.Err.Error(), "checksum mismatch")
		assert.NotContains(t, result.Err.Error(), "downloading")
	}
	assert.Contains(t, result.Stderr, "Downloading v2.0.0")
}

func TestUpdate__checksum_mismatch(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"tiddly": "binary",
	})

	checksumContent := "0000000000000000000000000000000000000000000000000000000000000000  tiddly_2.0.0_test_amd64.tar.gz\n"

	checker := &mockChecker{
		release: &update.ReleaseInfo{
			Version:     "v2.0.0",
			AssetURL:    "https://example.com/tiddly_2.0.0_test_amd64.tar.gz",
			ChecksumURL: "https://example.com/checksums.txt",
		},
		downloads: map[string][]byte{
			"https://example.com/tiddly_2.0.0_test_amd64.tar.gz": archive,
			"https://example.com/checksums.txt":                   []byte(checksumContent),
		},
	}

	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore:     creds,
		UpdateChecker: checker,
	})
	t.Cleanup(func() { SetDeps(nil) })

	old := cliVersion
	cliVersion = "1.0.0"
	t.Cleanup(func() { cliVersion = old })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "update")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "checksum mismatch")
}

func TestUpdate__missing_checksum_entry(t *testing.T) {
	archive := testutil.CreateTarGz(t, map[string]string{
		"tiddly": "binary",
	})

	// Checksum file exists but has no entry for our asset
	checksumContent := "abc123  tiddly_2.0.0_other_os.tar.gz\n"

	checker := &mockChecker{
		release: &update.ReleaseInfo{
			Version:     "v2.0.0",
			AssetURL:    "https://example.com/tiddly_2.0.0_test_amd64.tar.gz",
			ChecksumURL: "https://example.com/checksums.txt",
		},
		downloads: map[string][]byte{
			"https://example.com/tiddly_2.0.0_test_amd64.tar.gz": archive,
			"https://example.com/checksums.txt":                   []byte(checksumContent),
		},
	}

	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore:     creds,
		UpdateChecker: checker,
	})
	t.Cleanup(func() { SetDeps(nil) })

	old := cliVersion
	cliVersion = "1.0.0"
	t.Cleanup(func() { cliVersion = old })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "update")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "no checksum found")
}

func TestUpdate__missing_checksums_url(t *testing.T) {
	checker := &mockChecker{
		release: &update.ReleaseInfo{
			Version:     "v2.0.0",
			AssetURL:    "https://example.com/tiddly_2.0.0_test_amd64.tar.gz",
			ChecksumURL: "", // no checksums.txt in the release
		},
	}

	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore:     creds,
		UpdateChecker: checker,
	})
	t.Cleanup(func() { SetDeps(nil) })

	old := cliVersion
	cliVersion = "1.0.0"
	t.Cleanup(func() { cliVersion = old })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "update")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "cannot verify integrity")
}

func TestUpdate__network_error(t *testing.T) {
	checker := &mockChecker{
		releaseErr: fmt.Errorf("connection refused"),
	}

	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore:     creds,
		UpdateChecker: checker,
	})
	t.Cleanup(func() { SetDeps(nil) })

	old := cliVersion
	cliVersion = "1.0.0"
	t.Cleanup(func() { cliVersion = old })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "update")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "connection refused")
}
