package mcp

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBackupConfigFile__existing_file_creates_backup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	content := `{"key": "value"}`
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))

	err := backupConfigFile(path)
	require.NoError(t, err)

	backupData, err := os.ReadFile(path + ".bak")
	require.NoError(t, err)
	assert.Equal(t, content, string(backupData))
}

func TestBackupConfigFile__nonexistent_file_noop(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent.json")

	err := backupConfigFile(path)
	require.NoError(t, err)

	_, statErr := os.Stat(path + ".bak")
	assert.True(t, os.IsNotExist(statErr), "no backup should be created for nonexistent file")
}

func TestBackupConfigFile__preserves_permissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	require.NoError(t, os.WriteFile(path, []byte(`{}`), 0640))

	err := backupConfigFile(path)
	require.NoError(t, err)

	info, err := os.Stat(path + ".bak")
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0640), info.Mode().Perm())
}
