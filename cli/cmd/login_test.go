package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestDeps(t *testing.T, store *testutil.MockCredStore) {
	t.Helper()
	if store == nil {
		store = testutil.NewMockCredStore()
	}
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   testutil.NewMockExecLooker(),
		CmdRunner:    testutil.NewMockCommandRunner(),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})
}

func TestLogin__pat_valid(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com")).
		AssertCalled(1)

	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "bm_test123", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Logged in as user@example.com")

	// Verify PAT was stored
	pat, err := store.Get(auth.AccountPAT)
	require.NoError(t, err)
	assert.Equal(t, "bm_test123", pat)
}

func TestLogin__pat_with_trailing_whitespace(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com"))

	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "bm_test123\n", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stderr, "Trimmed whitespace")
	assert.Contains(t, result.Stdout, "Logged in as")
}

func TestLogin__pat_with_embedded_space_rejected(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "bm_bad token")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "embedded whitespace")
}

func TestLogin__pat_invalid_prefix(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "invalid_token")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "must start with 'bm_'")
}

func TestLogin__pat_warns_on_file_store_fallback(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com"))

	store := testutil.NewMockCredStore()
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	SetDeps(&AppDeps{
		CredStore:         store,
		TokenManager:      tm,
		ConfigDir:         "/tmp/test-config",
		ExecLooker:        testutil.NewMockExecLooker(),
		CmdRunner:         testutil.NewMockCommandRunner(),
		FileStoreFallback: true,
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "bm_test123", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Logged in as")
	assert.Contains(t, result.Stderr, "System keyring unavailable")
	assert.Contains(t, result.Stderr, "plaintext")
}

func TestLogin__pat_no_warning_when_keyring_available(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com"))

	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "bm_test123", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.NotContains(t, result.Stderr, "keyring unavailable")
}

func TestLogin__pat_api_error(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").RespondError(401, "invalid token")

	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--token", "bm_badtoken", "--api-url", mock.URL())

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "token verification failed")
}
