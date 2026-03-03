package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogout__clears_all_credentials(t *testing.T) {
	store := testutil.CredsWithOAuth("access-token", "refresh-token")
	_ = store.Set(auth.AccountPAT, "bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "logout")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Logged out successfully")

	// Verify all cleared
	_, err := store.Get(auth.AccountOAuthAccess)
	assert.ErrorIs(t, err, auth.ErrNotFound)
	_, err = store.Get(auth.AccountOAuthRefresh)
	assert.ErrorIs(t, err, auth.ErrNotFound)
	_, err = store.Get(auth.AccountPAT)
	assert.ErrorIs(t, err, auth.ErrNotFound)
}

func TestLogout__when_not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "logout")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Logged out successfully")
}
