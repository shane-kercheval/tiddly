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

func TestFileStore__set_multiple_writes_atomically(t *testing.T) {
	dir := t.TempDir()
	store := &fileStore{dir: dir}

	err := store.SetMultiple(map[string]string{
		"key1": "val1",
		"key2": "val2",
	})
	require.NoError(t, err)

	v1, err := store.Get("key1")
	require.NoError(t, err)
	assert.Equal(t, "val1", v1)

	v2, err := store.Get("key2")
	require.NoError(t, err)
	assert.Equal(t, "val2", v2)
}

func TestFileStore__set_multiple_preserves_existing(t *testing.T) {
	dir := t.TempDir()
	store := &fileStore{dir: dir}

	require.NoError(t, store.Set("existing", "keep-me"))

	err := store.SetMultiple(map[string]string{"new-key": "new-val"})
	require.NoError(t, err)

	v, err := store.Get("existing")
	require.NoError(t, err)
	assert.Equal(t, "keep-me", v)

	v2, err := store.Get("new-key")
	require.NoError(t, err)
	assert.Equal(t, "new-val", v2)
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

func TestNewCredentialStore__auto_keyring_available(t *testing.T) {
	original := keyringProbe
	keyringProbe = func() bool { return true }
	t.Cleanup(func() { keyringProbe = original })

	dir := t.TempDir()
	store, fallback := NewCredentialStore(KeyringAuto, dir)

	_, ok := store.(*keyringStore)
	assert.True(t, ok, "auto mode with working keyring should create keyringStore")
	assert.False(t, fallback, "should not report as fallback")
}

func TestNewCredentialStore__auto_keyring_unavailable(t *testing.T) {
	original := keyringProbe
	keyringProbe = func() bool { return false }
	t.Cleanup(func() { keyringProbe = original })

	dir := t.TempDir()
	store, fallback := NewCredentialStore(KeyringAuto, dir)

	_, ok := store.(*fileStore)
	assert.True(t, ok, "auto mode with broken keyring should fall back to fileStore")
	assert.True(t, fallback, "should report as fallback")
}

func TestNewCredentialStore__file_mode(t *testing.T) {
	dir := t.TempDir()
	store, fallback := NewCredentialStore(KeyringFile, dir)

	// Should be a fileStore, not a fallback (explicitly requested)
	_, ok := store.(*fileStore)
	assert.True(t, ok, "KeyringFile mode should create fileStore")
	assert.False(t, fallback, "explicit file mode should not report as fallback")

	// Should work
	err := store.Set("test", "value")
	require.NoError(t, err)

	val, err := store.Get("test")
	require.NoError(t, err)
	assert.Equal(t, "value", val)
}
