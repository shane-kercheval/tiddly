// Tests for the PKCE loopback login flow. The fake "browser" plays the
// provider's role: it receives the real authorize URL, extracts the
// redirect_uri/state/challenge the flow generated, and hits the flow's own
// loopback listener the way Clerk's redirect would — so callback handling,
// state validation, and the code exchange run end-to-end against an httptest
// token endpoint, with the PKCE S256 relationship asserted on the wire.
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// browserFunc adapts a func to the BrowserOpener interface.
type browserFunc func(url string) error

func (f browserFunc) Open(url string) error { return f(url) }

// authorizeParams are the values the flow put in the authorize URL.
type authorizeParams struct {
	redirectURI   string
	state         string
	challenge     string
	clientID      string
	scope         string
	challengeMeth string
}

func parseAuthorizeURL(t *testing.T, raw string) authorizeParams {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	q := u.Query()
	return authorizeParams{
		redirectURI:   q.Get("redirect_uri"),
		state:         q.Get("state"),
		challenge:     q.Get("code_challenge"),
		clientID:      q.Get("client_id"),
		scope:         q.Get("scope"),
		challengeMeth: q.Get("code_challenge_method"),
	}
}

// redirectBack simulates the provider redirecting the user's browser to the
// flow's loopback listener.
func redirectBack(t *testing.T, redirectURI string, query url.Values) {
	t.Helper()
	resp, err := http.Get(redirectURI + "?" + query.Encode())
	require.NoError(t, err)
	defer resp.Body.Close() //nolint:errcheck
	_, _ = io.Copy(io.Discard, resp.Body)
}

// redirectBackStatus is redirectBack returning the listener's status code.
func redirectBackStatus(t *testing.T, redirectURI string, query url.Values) int {
	t.Helper()
	resp, err := http.Get(redirectURI + "?" + query.Encode())
	require.NoError(t, err)
	defer resp.Body.Close() //nolint:errcheck
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

func newTestFlow(tokenServerURL string, browser BrowserOpener) *PKCEFlow {
	return &PKCEFlow{
		Config:       OAuthConfig{Issuer: "https://unused.example.com", ClientID: "test-client"},
		Browser:      browser,
		HTTPClient:   &http.Client{},
		Output:       io.Discard,
		BaseURL:      tokenServerURL,
		UserAgent:    "tiddly-cli-test",
		LoginTimeout: 5 * time.Second,
	}
}

func TestLogin__happy_path_exchanges_code_with_pkce(t *testing.T) {
	var captured authorizeParams
	var tokenRequest url.Values
	var userAgent string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/oauth/token", r.URL.Path)
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		tokenRequest, err = url.ParseQuery(string(body))
		require.NoError(t, err)
		userAgent = r.Header.Get("User-Agent")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(TokenResponse{ //nolint:errcheck
			AccessToken:  "access-123",
			RefreshToken: "refresh-456",
			TokenType:    "bearer",
			ExpiresIn:    86400,
		})
	}))
	defer server.Close()

	browser := browserFunc(func(authorizeURL string) error {
		captured = parseAuthorizeURL(t, authorizeURL)
		go redirectBack(t, captured.redirectURI, url.Values{
			"code":  {"auth-code-789"},
			"state": {captured.state},
		})
		return nil
	})

	flow := newTestFlow(server.URL, browser)
	tokens, err := flow.Login(context.Background())
	require.NoError(t, err)

	assert.Equal(t, "access-123", tokens.AccessToken)
	assert.Equal(t, "refresh-456", tokens.RefreshToken)

	// The authorize request carried a well-formed PKCE challenge...
	assert.Equal(t, "S256", captured.challengeMeth)
	assert.Equal(t, "test-client", captured.clientID)
	assert.Equal(t, oauthScopes, captured.scope)
	assert.True(t, strings.HasPrefix(captured.redirectURI, "http://127.0.0.1:"))

	// ...and the exchange proved possession of the matching verifier:
	// S256(code_verifier) must equal the code_challenge from the authorize URL.
	verifier := tokenRequest.Get("code_verifier")
	require.NotEmpty(t, verifier)
	sum := sha256.Sum256([]byte(verifier))
	assert.Equal(t, captured.challenge, base64.RawURLEncoding.EncodeToString(sum[:]))
	assert.Equal(t, "authorization_code", tokenRequest.Get("grant_type"))
	assert.Equal(t, "auth-code-789", tokenRequest.Get("code"))
	assert.Equal(t, captured.redirectURI, tokenRequest.Get("redirect_uri"))

	// Regression: Clerk's token endpoint bot-blocks default HTTP-library
	// User-Agents (bare 403, no OAuth error body) — the explicit UA must be sent.
	assert.Equal(t, "tiddly-cli-test", userAgent)
}

func TestLogin__denial_maps_to_access_denied(t *testing.T) {
	browser := browserFunc(func(authorizeURL string) error {
		p := parseAuthorizeURL(t, authorizeURL)
		go redirectBack(t, p.redirectURI, url.Values{
			"error":             {"access_denied"},
			"error_description": {"User did not consent"},
			"state":             {p.state},
		})
		return nil
	})

	flow := newTestFlow("http://unused.invalid", browser)
	_, err := flow.Login(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "access denied")
}

func TestLogin__uncorrelated_callbacks_ignored_then_valid_succeeds(t *testing.T) {
	// The local-DoS hardening contract: callbacks that don't carry this
	// flow's state — injected codes, fake denials, anything a local process
	// sprays at the loopback port — are answered 400 and IGNORED, so they
	// neither reach the token endpoint nor abort the login; the genuine
	// callback arriving afterwards still completes it.
	var exchangedCodes []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		form, err := url.ParseQuery(string(body))
		require.NoError(t, err)
		exchangedCodes = append(exchangedCodes, form.Get("code"))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(TokenResponse{ //nolint:errcheck
			AccessToken: "access-123", RefreshToken: "refresh-456", ExpiresIn: 86400,
		})
	}))
	defer server.Close()

	browser := browserFunc(func(authorizeURL string) error {
		p := parseAuthorizeURL(t, authorizeURL)
		go func() {
			// 1. Fake denial with no state: must be ignored (400), not abort.
			status := redirectBackStatus(t, p.redirectURI, url.Values{
				"error": {"access_denied"},
			})
			assert.Equal(t, http.StatusBadRequest, status)
			// 2. Injected code under the wrong state: ignored too.
			status = redirectBackStatus(t, p.redirectURI, url.Values{
				"code":  {"attacker-injected-code"},
				"state": {"not-the-state-we-sent"},
			})
			assert.Equal(t, http.StatusBadRequest, status)
			// 3. The genuine callback still wins.
			redirectBack(t, p.redirectURI, url.Values{
				"code":  {"real-code"},
				"state": {p.state},
			})
		}()
		return nil
	})

	flow := newTestFlow(server.URL, browser)
	tokens, err := flow.Login(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "access-123", tokens.AccessToken)
	assert.Equal(t, []string{"real-code"}, exchangedCodes,
		"only the state-correlated code may reach the token endpoint")
}

func TestLogin__timeout_names_the_pat_alternative(t *testing.T) {
	// Browser "opens" but the user never completes sign-in (or the machine is
	// headless and nothing could open) — the timeout error must point at the
	// PAT path, the accepted headless story.
	flow := newTestFlow("http://unused.invalid", browserFunc(func(string) error { return nil }))
	flow.LoginTimeout = 50 * time.Millisecond

	_, err := flow.Login(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "tiddly login --token")
}

func TestLogin__browser_open_failure_is_nonfatal(t *testing.T) {
	// Open failing (headless) must not abort the flow — the URL was printed,
	// and the wait continues until the timeout.
	flow := newTestFlow("http://unused.invalid", browserFunc(func(string) error {
		return assert.AnError
	}))
	flow.LoginTimeout = 50 * time.Millisecond

	_, err := flow.Login(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timed out")
}

func TestLogin__ctrl_c_cancels_cleanly(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	browser := browserFunc(func(string) error {
		cancel() // simulate Ctrl+C while waiting for the callback
		return nil
	})

	flow := newTestFlow("http://unused.invalid", browser)
	_, err := flow.Login(ctx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "login cancelled")
}

func TestRefreshAccessToken__returns_rotated_tokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, err := url.ParseQuery(string(body))
		require.NoError(t, err)
		assert.Equal(t, "refresh_token", form.Get("grant_type"))
		assert.Equal(t, "old-refresh", form.Get("refresh_token"))
		assert.NotEmpty(t, r.Header.Get("User-Agent"))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(TokenResponse{ //nolint:errcheck
			AccessToken:  "new-access",
			RefreshToken: "new-refresh", // Clerk rotates on every refresh
			ExpiresIn:    86400,
		})
	}))
	defer server.Close()

	flow := newTestFlow(server.URL, nil)
	tokens, err := flow.RefreshAccessToken("old-refresh")
	require.NoError(t, err)
	assert.Equal(t, "new-access", tokens.AccessToken)
	assert.Equal(t, "new-refresh", tokens.RefreshToken)
}

func TestRefreshAccessToken__invalid_grant_maps_to_relogin_message(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"invalid_grant","error_description":"Refresh token is invalid"}`)) //nolint:errcheck
	}))
	defer server.Close()

	flow := newTestFlow(server.URL, nil)
	_, err := flow.RefreshAccessToken("rotated-away-token")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Run 'tiddly login' to re-authenticate")
}

// loginWithTokenResponse runs a full Login against a token endpoint that
// returns the given body/status, driving a genuine state-correlated callback.
func loginWithTokenResponse(t *testing.T, status int, body string) (*TokenResponse, error) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(body)) //nolint:errcheck
	}))
	defer server.Close()

	browser := browserFunc(func(authorizeURL string) error {
		p := parseAuthorizeURL(t, authorizeURL)
		go redirectBack(t, p.redirectURI, url.Values{
			"code": {"auth-code"}, "state": {p.state},
		})
		return nil
	})
	return newTestFlow(server.URL, browser).Login(context.Background())
}

func TestLogin__empty_200_token_response_fails_loudly(t *testing.T) {
	// A 200 with no access token must fail AT LOGIN, not surface later as
	// baffling 401s from an empty stored credential.
	_, err := loginWithTokenResponse(t, http.StatusOK, `{}`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no access token")
}

func TestLogin__missing_refresh_token_fails_loudly(t *testing.T) {
	// offline_access is always requested; a login without a refresh token
	// means the OAuth app is misconfigured — fail now, not in 24 hours.
	_, err := loginWithTokenResponse(t, http.StatusOK, `{"access_token":"a"}`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "offline_access")
}

func TestLogin__invalid_grant_wording_fits_initial_login(t *testing.T) {
	// RFC 6749 §5.2: invalid_grant on the exchange means the authorization
	// code expired or was reused — "session expired" would be wrong for a
	// user who never had a session.
	_, err := loginWithTokenResponse(t, http.StatusBadRequest,
		`{"error":"invalid_grant","error_description":"authorization code expired"}`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sign-in attempt expired")
	assert.NotContains(t, err.Error(), "session expired")
}

func TestLogin__partial_connection_cannot_hang_shutdown(t *testing.T) {
	// A half-open local connection (headers never completed) must not defeat
	// Ctrl+C: Login's deferred cleanup uses a bounded Shutdown with a hard
	// Close fallback, so cancellation returns promptly regardless.
	ctx, cancel := context.WithCancel(context.Background())
	browser := browserFunc(func(authorizeURL string) error {
		p := parseAuthorizeURL(t, authorizeURL)
		u, err := url.Parse(p.redirectURI)
		require.NoError(t, err)
		conn, err := net.Dial("tcp", u.Host)
		require.NoError(t, err)
		_, err = conn.Write([]byte("GET /call")) // partial request, held open
		require.NoError(t, err)
		// Leak the connection deliberately; cancel the login while it's open.
		go func() {
			time.Sleep(100 * time.Millisecond)
			cancel()
		}()
		return nil
	})

	flow := newTestFlow("http://unused.invalid", browser)
	start := time.Now()
	_, err := flow.Login(ctx)
	elapsed := time.Since(start)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "login cancelled")
	assert.Less(t, elapsed, 4*time.Second,
		"Login must return promptly even with a half-open connection holding the listener")
}

func TestRefreshAccessToken__missing_refresh_token_tolerated(t *testing.T) {
	// Standard OAuth semantics: a refresh response without a replacement
	// refresh token means "keep using the current one" — TokenManager
	// preserves the stored token in that case, so this must not error.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"access_token":"new-access","expires_in":86400}`)) //nolint:errcheck
	}))
	defer server.Close()

	flow := newTestFlow(server.URL, nil)
	tokens, err := flow.RefreshAccessToken("still-valid-token")
	require.NoError(t, err)
	assert.Equal(t, "new-access", tokens.AccessToken)
	assert.Empty(t, tokens.RefreshToken)
}

func TestRefreshAccessToken__empty_access_token_fails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`)) //nolint:errcheck
	}))
	defer server.Close()

	flow := newTestFlow(server.URL, nil)
	_, err := flow.RefreshAccessToken("some-token")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no access token")
}

func TestNewPKCEPair__verifier_entropy_and_challenge_relation(t *testing.T) {
	verifier, challenge, err := newPKCEPair()
	require.NoError(t, err)

	// 32 random bytes → 43-char unpadded base64url (RFC 7636 minimum entropy).
	assert.Len(t, verifier, 43)
	sum := sha256.Sum256([]byte(verifier))
	assert.Equal(t, base64.RawURLEncoding.EncodeToString(sum[:]), challenge)

	// Two pairs must differ (crypto/rand, not a fixed seed).
	verifier2, _, err := newPKCEPair()
	require.NoError(t, err)
	assert.NotEqual(t, verifier, verifier2)
}

func TestDefaultOAuthConfig__env_overrides(t *testing.T) {
	t.Setenv("TIDDLY_OAUTH_ISSUER", "https://relevant-test.clerk.accounts.dev")
	t.Setenv("TIDDLY_OAUTH_CLIENT_ID", "devClientID")

	cfg := DefaultOAuthConfig()
	assert.Equal(t, "https://relevant-test.clerk.accounts.dev", cfg.Issuer)
	assert.Equal(t, "devClientID", cfg.ClientID)
}

func TestDefaultOAuthConfig__prod_defaults(t *testing.T) {
	t.Setenv("TIDDLY_OAUTH_ISSUER", "")
	t.Setenv("TIDDLY_OAUTH_CLIENT_ID", "")

	cfg := DefaultOAuthConfig()
	assert.Equal(t, "https://clerk.tiddly.me", cfg.Issuer)
	assert.NotEmpty(t, cfg.ClientID)
}
