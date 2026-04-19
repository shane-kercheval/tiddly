package mcp

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBackupConfigFile__existing_file_creates_backup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	content := `{"key": "value"}`
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))

	backupPath, err := backupConfigFile(path)
	require.NoError(t, err)
	require.NotEmpty(t, backupPath, "backup path should be returned")
	assert.True(t, strings.HasPrefix(backupPath, path+".bak."),
		"backup filename should be <path>.bak.<timestamp>; got %q", backupPath)

	backupData, err := os.ReadFile(backupPath)
	require.NoError(t, err)
	assert.Equal(t, content, string(backupData))
}

func TestBackupConfigFile__nonexistent_file_noop(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent.json")

	backupPath, err := backupConfigFile(path)
	require.NoError(t, err)
	assert.Empty(t, backupPath, "no backup path should be returned for missing source")

	matches, _ := filepath.Glob(path + ".bak.*")
	assert.Empty(t, matches, "no backup should be created for nonexistent file")
}

func TestBackupConfigFile__preserves_permissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	require.NoError(t, os.WriteFile(path, []byte(`{}`), 0640))

	backupPath, err := backupConfigFile(path)
	require.NoError(t, err)

	info, err := os.Stat(backupPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0640), info.Mode().Perm())
}

func TestBackupConfigFile__uses_timestamp_in_filename(t *testing.T) {
	// Use an injected clock so we can assert the exact filename.
	fixed := time.Date(2026, 4, 19, 10, 30, 45, 0, time.UTC)
	prev := backupClock
	backupClock = func() time.Time { return fixed }
	t.Cleanup(func() { backupClock = prev })

	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	require.NoError(t, os.WriteFile(path, []byte(`{}`), 0600))

	backupPath, err := backupConfigFile(path)
	require.NoError(t, err)
	assert.Equal(t, path+".bak.20260419T103045Z", backupPath,
		"backup filename should use UTC ISO 8601 basic format")
}

func TestBackupConfigFile__collision_retry_preserves_both(t *testing.T) {
	// Two backups in the same UTC second must not overwrite each other.
	// Pin the clock so both calls produce the same base timestamp; the
	// second call should land on <base>.1 with the second file's contents.
	fixed := time.Date(2026, 4, 19, 10, 30, 45, 0, time.UTC)
	prev := backupClock
	backupClock = func() time.Time { return fixed }
	t.Cleanup(func() { backupClock = prev })

	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	// First backup: source contains "first".
	require.NoError(t, os.WriteFile(path, []byte("first"), 0600))
	firstBackup, err := backupConfigFile(path)
	require.NoError(t, err)
	assert.Equal(t, path+".bak.20260419T103045Z", firstBackup)

	// Source changes. Second backup (same UTC second) must go to a distinct
	// file so "first" is preserved.
	require.NoError(t, os.WriteFile(path, []byte("second"), 0600))
	secondBackup, err := backupConfigFile(path)
	require.NoError(t, err)
	assert.Equal(t, path+".bak.20260419T103045Z.1", secondBackup,
		"second backup in the same second must land on .1 suffix")

	// Both backups survive with their respective contents.
	firstData, err := os.ReadFile(firstBackup)
	require.NoError(t, err)
	assert.Equal(t, "first", string(firstData), "first backup must not have been overwritten")

	secondData, err := os.ReadFile(secondBackup)
	require.NoError(t, err)
	assert.Equal(t, "second", string(secondData))
}
