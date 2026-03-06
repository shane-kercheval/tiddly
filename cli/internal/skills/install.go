package skills

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
)

// Scope constants for skills extraction.
const (
	ScopeGlobal  = "global"
	ScopeProject = "project"
)

// ValidScopes is the list of valid scope values.
var ValidScopes = []string{ScopeGlobal, ScopeProject}

// InstallResult holds the outcome of a skills install operation.
type InstallResult struct {
	SkillCount int
	DestPath   string
	// ZipPath is set for claude-desktop when the zip is saved to a temp file.
	ZipPath string
}

// toolPaths maps tool name + scope to the extraction directory.
func toolPath(tool, scope string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("determining home directory: %w", err)
	}

	switch tool {
	case "claude-code":
		if scope == ScopeProject {
			return filepath.Join(".claude", "skills"), nil
		}
		return filepath.Join(home, ".claude", "skills"), nil
	case "codex":
		if scope == ScopeProject {
			return filepath.Join(".agents", "skills"), nil
		}
		return filepath.Join(home, ".codex", "skills"), nil
	case "claude-desktop":
		if scope == ScopeProject {
			return "", fmt.Errorf("claude-desktop does not support --scope project")
		}
		// Claude Desktop gets a temp file; path determined at extraction time
		return "", nil
	default:
		return "", fmt.Errorf("unknown tool: %s", tool)
	}
}

// toolPathOverrides allows tests to override the tool path for a specific tool+scope.
// Production code never sets this.
var toolPathOverrides map[string]string

// SetToolPathOverride sets a path override for testing. Returns a cleanup function.
func SetToolPathOverride(tool, scope, path string) func() {
	if toolPathOverrides == nil {
		toolPathOverrides = make(map[string]string)
	}
	key := tool + ":" + scope
	toolPathOverrides[key] = path
	return func() {
		delete(toolPathOverrides, key)
		if len(toolPathOverrides) == 0 {
			toolPathOverrides = nil
		}
	}
}

func resolveToolPath(tool, scope string) (string, error) {
	key := tool + ":" + scope
	if toolPathOverrides != nil {
		if p, ok := toolPathOverrides[key]; ok {
			return p, nil
		}
	}
	return toolPath(tool, scope)
}

// Install downloads skills from the API and extracts them to the correct directory.
func Install(ctx context.Context, client *api.Client, tool string, tags []string, tagMatch string, scope string) (*InstallResult, error) {
	// Validate scope
	if scope == "" {
		scope = ScopeGlobal
	}

	destPath, err := resolveToolPath(tool, scope)
	if err != nil {
		return nil, err
	}

	// Download archive
	resp, err := client.ExportSkills(ctx, tool, tags, tagMatch)
	if err != nil {
		return nil, fmt.Errorf("installing skills: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	// Read full body into memory (archives are small — prompt content only).
	// Limit to 100MB as a safety net against unexpected server responses.
	// Read limit+1 bytes so we can detect truncation without false positives
	// on a legitimate exactly-100MB archive.
	const maxArchiveSize = 100 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxArchiveSize+1))
	if err != nil {
		return nil, fmt.Errorf("reading skills archive: %w", err)
	}
	if len(data) > maxArchiveSize {
		return nil, fmt.Errorf("skills archive exceeds %d MB size limit", maxArchiveSize/(1024*1024))
	}

	if len(data) == 0 {
		return &InstallResult{SkillCount: 0, DestPath: destPath}, nil
	}

	// Extract based on content type.
	// The server returns different formats per tool:
	//   claude-code, codex  → tar.gz with {name}/SKILL.md structure
	//   claude-desktop      → zip with flat {name}.md files (saved to temp for manual upload)
	contentType := resp.ContentType
	if strings.Contains(contentType, "gzip") || strings.HasSuffix(contentType, "tar+gzip") {
		count, err := extractTarGz(data, destPath)
		if err != nil {
			return nil, err
		}
		return &InstallResult{SkillCount: count, DestPath: destPath}, nil
	}

	if strings.Contains(contentType, "zip") {
		if tool == "claude-desktop" {
			// Save zip to temp file and return path for user instructions
			zipPath, err := saveZipToTemp(data)
			if err != nil {
				return nil, err
			}
			count, err := countZipEntries(data)
			if err != nil {
				return nil, err
			}
			return &InstallResult{SkillCount: count, ZipPath: zipPath}, nil
		}
		count, err := extractZip(data, destPath)
		if err != nil {
			return nil, err
		}
		return &InstallResult{SkillCount: count, DestPath: destPath}, nil
	}

	return nil, fmt.Errorf("unexpected content type: %s", contentType)
}

// extractTarGz extracts a tar.gz archive to destPath.
// Archive structure: {name}/SKILL.md — only SKILL.md files are counted as skills.
func extractTarGz(data []byte, destPath string) (int, error) {
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return 0, fmt.Errorf("opening gzip: %w", err)
	}
	defer gr.Close() //nolint:errcheck

	tr := tar.NewReader(gr)
	count := 0

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("reading tar entry: %w", err)
		}

		// Skip directories
		if header.Typeflag == tar.TypeDir {
			continue
		}

		// Sanitize path to prevent directory traversal (zip-slip)
		target := filepath.Join(destPath, filepath.Clean(header.Name))
		if !strings.HasPrefix(target, destPath+string(filepath.Separator)) {
			continue
		}
		if err := writeFile(target, tr); err != nil {
			return 0, err
		}

		// Count SKILL.md files as skills
		if filepath.Base(target) == "SKILL.md" {
			count++
		}
	}

	return count, nil
}

// extractZip extracts a zip archive to destPath.
// Archive structure: flat {name}.md files — every file is a skill.
func extractZip(data []byte, destPath string) (int, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, fmt.Errorf("opening zip: %w", err)
	}

	count := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}

		// Sanitize path to prevent directory traversal (zip-slip)
		target := filepath.Join(destPath, filepath.Clean(f.Name))
		if !strings.HasPrefix(target, destPath+string(filepath.Separator)) {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			return 0, fmt.Errorf("opening zip entry %s: %w", f.Name, err)
		}

		if err := writeFile(target, rc); err != nil {
			rc.Close() //nolint:errcheck
			return 0, err
		}
		rc.Close() //nolint:errcheck
		count++
	}

	return count, nil
}

// writeFile creates the file at target (including parent dirs) and copies content from r.
func writeFile(target string, r io.Reader) error {
	targetDir := filepath.Dir(target)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("creating directory %s: %w", targetDir, err)
	}

	f, err := os.Create(target)
	if err != nil {
		return fmt.Errorf("creating file %s: %w", target, err)
	}

	if _, err := io.Copy(f, r); err != nil {
		f.Close() //nolint:errcheck
		return fmt.Errorf("writing file %s: %w", target, err)
	}
	return f.Close()
}

// saveZipToTemp writes the zip data to a temporary file and returns the path.
func saveZipToTemp(data []byte) (string, error) {
	f, err := os.CreateTemp("", "tiddly-skills-*.zip")
	if err != nil {
		return "", fmt.Errorf("creating temp file: %w", err)
	}

	if _, err := f.Write(data); err != nil {
		f.Close()            //nolint:errcheck
		os.Remove(f.Name()) //nolint:errcheck
		return "", fmt.Errorf("writing temp file: %w", err)
	}

	if err := f.Close(); err != nil {
		return "", fmt.Errorf("closing temp file: %w", err)
	}

	return f.Name(), nil
}

// countZipEntries counts the number of files in a zip archive.
func countZipEntries(data []byte) (int, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, fmt.Errorf("opening zip: %w", err)
	}
	count := 0
	for _, f := range zr.File {
		if !f.FileInfo().IsDir() {
			count++
		}
	}
	return count, nil
}
