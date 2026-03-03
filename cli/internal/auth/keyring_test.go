package auth

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFileStore(t *testing.T) {
	tests := []struct {
		name    string
		actions func(t *testing.T, store *fileStore)
	}{
		{
			name: "set and get credential",
			actions: func(t *testing.T, store *fileStore) {
				err := store.Set("test-key", "test-value")
				require.NoError(t, err)

				val, err := store.Get("test-key")
				require.NoError(t, err)
				assert.Equal(t, "test-value", val)
			},
		},
		{
			name: "get non-existent credential returns ErrNotFound",
			actions: func(t *testing.T, store *fileStore) {
				_, err := store.Get("missing")
				assert.ErrorIs(t, err, ErrNotFound)
			},
		},
		{
			name: "delete credential",
			actions: func(t *testing.T, store *fileStore) {
				err := store.Set("to-delete", "value")
				require.NoError(t, err)

				err = store.Delete("to-delete")
				require.NoError(t, err)

				_, err = store.Get("to-delete")
				assert.ErrorIs(t, err, ErrNotFound)
			},
		},
		{
			name: "delete non-existent credential does not error",
			actions: func(t *testing.T, store *fileStore) {
				err := store.Delete("never-existed")
				require.NoError(t, err)
			},
		},
		{
			name: "multiple credentials stored independently",
			actions: func(t *testing.T, store *fileStore) {
				require.NoError(t, store.Set("key1", "val1"))
				require.NoError(t, store.Set("key2", "val2"))

				v1, err := store.Get("key1")
				require.NoError(t, err)
				assert.Equal(t, "val1", v1)

				v2, err := store.Get("key2")
				require.NoError(t, err)
				assert.Equal(t, "val2", v2)
			},
		},
		{
			name: "overwrite existing credential",
			actions: func(t *testing.T, store *fileStore) {
				require.NoError(t, store.Set("key", "original"))
				require.NoError(t, store.Set("key", "updated"))

				val, err := store.Get("key")
				require.NoError(t, err)
				assert.Equal(t, "updated", val)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			store := &fileStore{dir: dir}
			tt.actions(t, store)
		})
	}
}

func TestFileStore__file_permissions(t *testing.T) {
	dir := t.TempDir()
	store := &fileStore{dir: dir}

	err := store.Set("key", "value")
	require.NoError(t, err)

	info, err := os.Stat(filepath.Join(dir, "credentials"))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0600), info.Mode().Perm())
}

func TestKeyringAvailable(t *testing.T) {
	tests := []struct {
		name     string
		display  string
		wayland  string
		expected bool
	}{
		{
			name:     "available when DISPLAY set",
			display:  ":0",
			expected: true,
		},
		{
			name:     "available when WAYLAND_DISPLAY set",
			wayland:  "wayland-0",
			expected: true,
		},
		{
			name:     "unavailable when both unset",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Only test on Linux where this logic applies
			if os.Getenv("GOOS") != "" && os.Getenv("GOOS") != "linux" {
				t.Skip("keyring availability check is Linux-specific")
			}

			t.Setenv("DISPLAY", tt.display)
			t.Setenv("WAYLAND_DISPLAY", tt.wayland)

			result := keyringAvailable()
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestNewCredentialStore__file_mode(t *testing.T) {
	dir := t.TempDir()
	store := NewCredentialStore(KeyringFile, dir)

	// Should be a fileStore
	_, ok := store.(*fileStore)
	assert.True(t, ok, "KeyringFile mode should create fileStore")

	// Should work
	err := store.Set("test", "value")
	require.NoError(t, err)

	val, err := store.Get("test")
	require.NoError(t, err)
	assert.Equal(t, "value", val)
}
