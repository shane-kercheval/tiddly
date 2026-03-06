package update

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

const (
	defaultOwner = "shane-kercheval"
	defaultRepo  = "tiddly"
)

// ReleaseInfo describes a GitHub release with the matching asset for this OS/arch.
type ReleaseInfo struct {
	Version     string
	AssetURL    string
	ChecksumURL string
}

// Checker abstracts release checking and downloading for testability.
type Checker interface {
	LatestRelease(ctx context.Context) (*ReleaseInfo, error)
	Download(ctx context.Context, url string) (io.ReadCloser, error)
}

// GitHubChecker implements Checker using the GitHub Releases API.
type GitHubChecker struct {
	Client *http.Client
	Owner  string
	Repo   string
}

// NewGitHubChecker returns a Checker configured for the tiddly repo.
func NewGitHubChecker() *GitHubChecker {
	return &GitHubChecker{
		Client: &http.Client{Timeout: 10 * time.Second},
		Owner:  defaultOwner,
		Repo:   defaultRepo,
	}
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// LatestRelease fetches the latest GitHub release and finds matching assets for
// the current OS and architecture.
func (g *GitHubChecker) LatestRelease(ctx context.Context) (*ReleaseInfo, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", g.Owner, g.Repo)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching latest release: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck // HTTP response body close on read path

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decoding release: %w", err)
	}

	osName := runtime.GOOS
	archName := runtime.GOARCH

	// Find matching binary asset by OS/arch pattern
	pattern := fmt.Sprintf("_%s_%s.", osName, archName)
	var assetURL string
	for _, a := range release.Assets {
		if strings.Contains(a.Name, pattern) && !strings.HasSuffix(a.Name, ".txt") {
			assetURL = a.BrowserDownloadURL
			break
		}
	}
	if assetURL == "" {
		return nil, fmt.Errorf("no release asset found for %s/%s", osName, archName)
	}

	// Find checksums file
	var checksumURL string
	for _, a := range release.Assets {
		if a.Name == "checksums.txt" {
			checksumURL = a.BrowserDownloadURL
			break
		}
	}

	// Strip monorepo tag prefix (e.g. "cli/v1.0.0" → "v1.0.0")
	version := release.TagName
	if _, after, ok := strings.Cut(version, "/"); ok {
		version = after
	}

	return &ReleaseInfo{
		Version:     version,
		AssetURL:    assetURL,
		ChecksumURL: checksumURL,
	}, nil
}

// Download fetches a URL and returns the response body.
func (g *GitHubChecker) Download(ctx context.Context, url string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("downloading %s: %w", url, err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close() //nolint:errcheck // best-effort close on error path
		return nil, fmt.Errorf("download returned %d", resp.StatusCode)
	}

	return resp.Body, nil
}

// ParseChecksums parses a GoReleaser checksums.txt file into a map of filename→hex hash.
func ParseChecksums(r io.Reader) (map[string]string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}

	result := make(map[string]string)
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			continue
		}
		// Format: "<hash>  <filename>" (GoReleaser default)
		result[parts[1]] = parts[0]
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("no checksums found")
	}

	return result, nil
}

// VerifyChecksum checks that the SHA256 of data matches the expected hex hash.
func VerifyChecksum(data []byte, expected string) error {
	h := sha256.Sum256(data)
	actual := hex.EncodeToString(h[:])
	if actual != expected {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expected, actual)
	}
	return nil
}

// ExtractBinary extracts the "tiddly" binary from a tar.gz archive.
func ExtractBinary(tarGzReader io.Reader) ([]byte, error) {
	gr, err := gzip.NewReader(tarGzReader)
	if err != nil {
		return nil, fmt.Errorf("decompressing archive: %w", err)
	}
	defer gr.Close() //nolint:errcheck // gzip reader close after full read

	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading archive: %w", err)
		}

		// Match the binary name (may be at root or in a subdirectory)
		name := filepath.Base(hdr.Name)
		if name == "tiddly" && hdr.Typeflag == tar.TypeReg {
			const maxBinarySize = 200 * 1024 * 1024 // 200MB
			if hdr.Size > maxBinarySize {
				return nil, fmt.Errorf("binary too large (%d bytes, max %d)", hdr.Size, maxBinarySize)
			}
			data, err := io.ReadAll(tr)
			if err != nil {
				return nil, fmt.Errorf("reading binary from archive: %w", err)
			}
			return data, nil
		}
	}

	return nil, fmt.Errorf("binary 'tiddly' not found in archive")
}

// ReplaceBinary atomically replaces the running binary with newBinary.
// On Windows, returns an error with a download URL suggestion.
func ReplaceBinary(newBinary []byte) error {
	if runtime.GOOS == "windows" {
		return fmt.Errorf("automatic upgrade not supported on Windows. Download the latest release from https://github.com/%s/%s/releases", defaultOwner, defaultRepo)
	}

	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving executable path: %w", err)
	}

	// Follow symlinks to get the real path
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("resolving symlinks: %w", err)
	}

	return ReplaceBinaryAt(newBinary, execPath)
}

// ReplaceBinaryAt atomically replaces the binary at execPath with newBinary.
// The temp file is written in the same directory to ensure atomic rename works
// (same filesystem requirement).
func ReplaceBinaryAt(newBinary []byte, execPath string) error {
	// Get permissions from existing binary
	info, err := os.Stat(execPath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", execPath, err)
	}

	// Write to temp file in same directory (required for atomic rename on same filesystem)
	dir := filepath.Dir(execPath)
	tmp, err := os.CreateTemp(dir, "tiddly-upgrade-*")
	if err != nil {
		if os.IsPermission(err) {
			return fmt.Errorf("permission denied writing to %s. Run: sudo tiddly upgrade", execPath)
		}
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	// Clean up temp file on any error
	defer func() {
		if tmpPath != "" {
			os.Remove(tmpPath) //nolint:errcheck // best-effort cleanup
		}
	}()

	if _, err := tmp.Write(newBinary); err != nil {
		tmp.Close() //nolint:errcheck // closing before cleanup
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Chmod(info.Mode()); err != nil {
		tmp.Close() //nolint:errcheck // closing before cleanup
		return fmt.Errorf("setting permissions: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("closing temp file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, execPath); err != nil {
		if os.IsPermission(err) {
			return fmt.Errorf("permission denied writing to %s. Run: sudo tiddly upgrade", execPath)
		}
		return fmt.Errorf("replacing binary: %w", err)
	}

	tmpPath = "" // prevent deferred cleanup
	return nil
}

// IsNewer returns true if latest is a newer semver than current.
func IsNewer(current, latest string) bool {
	c := normalize(current)
	l := normalize(latest)
	if !semver.IsValid(c) || !semver.IsValid(l) {
		return false
	}
	return semver.Compare(l, c) > 0
}

// NeedsCheck returns true if the last check was more than 24 hours ago.
func NeedsCheck(lastCheck time.Time) bool {
	return time.Since(lastCheck) > 24*time.Hour
}

// DisplayVersion formats a version for display, ensuring a "v" prefix.
func DisplayVersion(v string) string {
	return normalize(v)
}

// normalize ensures a version string has a "v" prefix for semver compatibility.
func normalize(v string) string {
	if !strings.HasPrefix(v, "v") {
		v = "v" + v
	}
	return v
}
