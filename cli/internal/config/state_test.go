package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadState__missing_file(t *testing.T) {
	dir := t.TempDir()
	state, err := ReadState(dir)
	require.NoError(t, err)
	assert.True(t, state.LastUpdateCheck.IsZero())
}

func TestWriteState__round_trip(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().Truncate(time.Second)

	err := WriteState(dir, &State{LastUpdateCheck: now})
	require.NoError(t, err)

	state, err := ReadState(dir)
	require.NoError(t, err)
	assert.True(t, state.LastUpdateCheck.Equal(now))
}

func TestReadState__corrupt_file(t *testing.T) {
	dir := t.TempDir()

	err := os.WriteFile(filepath.Join(dir, stateFile), []byte("not-json"), 0600)
	require.NoError(t, err)

	state, err := ReadState(dir)
	require.NoError(t, err)
	assert.True(t, state.LastUpdateCheck.IsZero())
}
