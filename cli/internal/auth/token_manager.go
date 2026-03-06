package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// TokenResult holds the resolved token and its source.
type TokenResult struct {
	Token    string
	AuthType string // "flag", "env", "pat", "oauth"
}

// TokenManager resolves and manages authentication tokens.
type TokenManager struct {
	Store       CredentialStore
	DeviceFlow  *DeviceFlow
}

// NewTokenManager creates a TokenManager.
func NewTokenManager(store CredentialStore, df *DeviceFlow) *TokenManager {
	return &TokenManager{
		Store:      store,
		DeviceFlow: df,
	}
}

// ResolveToken returns the active token following the resolution chain.
// Default order (preferOAuth=false): flag > env > PAT > OAuth
// OAuth-preferred (preferOAuth=true): flag > env > OAuth > PAT
func (tm *TokenManager) ResolveToken(flagToken string, preferOAuth bool) (*TokenResult, error) {
	// 1. Flag token always takes precedence
	if flagToken != "" {
		cleaned := cleanToken(flagToken)
		if cleaned == "" {
			return nil, fmt.Errorf("invalid token: contains only whitespace")
		}
		return &TokenResult{Token: cleaned, AuthType: "flag"}, nil
	}

	// 2. Environment variable
	if envToken := os.Getenv("TIDDLY_TOKEN"); envToken != "" {
		cleaned := cleanToken(envToken)
		if cleaned == "" {
			return nil, fmt.Errorf("invalid TIDDLY_TOKEN: contains only whitespace")
		}
		return &TokenResult{Token: cleaned, AuthType: "env"}, nil
	}

	type resolver struct {
		name string
		fn   func() (*TokenResult, error)
	}

	var chain []resolver
	if preferOAuth {
		chain = []resolver{
			{"OAuth", tm.resolveOAuth},
			{"PAT", tm.resolvePAT},
		}
	} else {
		chain = []resolver{
			{"PAT", tm.resolvePAT},
			{"OAuth", tm.resolveOAuth},
		}
	}

	for _, r := range chain {
		result, err := r.fn()
		if err == nil {
			return result, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, fmt.Errorf("%s: %w", r.name, err)
		}
	}

	return nil, ErrNotLoggedIn
}

func (tm *TokenManager) resolvePAT() (*TokenResult, error) {
	pat, err := tm.Store.Get(AccountPAT)
	if err != nil {
		return nil, err
	}
	return &TokenResult{Token: pat, AuthType: "pat"}, nil
}

func (tm *TokenManager) resolveOAuth() (*TokenResult, error) {
	token, err := tm.Store.Get(AccountOAuthAccess)
	if err != nil {
		return nil, err
	}

	// Check if token is expired
	if isJWTExpired(token) {
		// Try to refresh
		refreshed, err := tm.refreshOAuthToken()
		if err != nil {
			return nil, err
		}
		return &TokenResult{Token: refreshed, AuthType: "oauth"}, nil
	}

	return &TokenResult{Token: token, AuthType: "oauth"}, nil
}

func (tm *TokenManager) refreshOAuthToken() (string, error) {
	refreshToken, err := tm.Store.Get(AccountOAuthRefresh)
	if err != nil {
		return "", fmt.Errorf("no refresh token available: %w", err)
	}

	if tm.DeviceFlow == nil {
		return "", fmt.Errorf("session expired. Run 'tiddly login' to re-authenticate")
	}

	result, err := tm.DeviceFlow.RefreshAccessToken(refreshToken)
	if err != nil {
		return "", err
	}

	// Store BOTH new tokens atomically (Auth0 rotation invalidates old refresh token).
	// Using SetMultiple ensures fileStore does a single read-modify-write,
	// preventing a state where the new access token is stored but the old
	// (now-invalidated) refresh token remains.
	entries := map[string]string{AccountOAuthAccess: result.AccessToken}
	if result.RefreshToken != "" {
		entries[AccountOAuthRefresh] = result.RefreshToken
	}
	if err := tm.Store.SetMultiple(entries); err != nil {
		return "", fmt.Errorf("storing refreshed tokens: %w", err)
	}

	return result.AccessToken, nil
}

// StorePAT stores a PAT in the credential store.
func (tm *TokenManager) StorePAT(token string) error {
	return tm.Store.Set(AccountPAT, token)
}

// StoreOAuthTokens stores OAuth access and refresh tokens atomically.
func (tm *TokenManager) StoreOAuthTokens(accessToken, refreshToken string) error {
	entries := map[string]string{AccountOAuthAccess: accessToken}
	if refreshToken != "" {
		entries[AccountOAuthRefresh] = refreshToken
	}
	return tm.Store.SetMultiple(entries)
}

// ClearAll removes all stored credentials.
func (tm *TokenManager) ClearAll() error {
	var errs []error
	for _, account := range []string{AccountOAuthAccess, AccountOAuthRefresh, AccountPAT} {
		if err := tm.Store.Delete(account); err != nil && !errors.Is(err, ErrNotFound) {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("clearing credentials: %w", errors.Join(errs...))
	}
	return nil
}

// cleanToken trims whitespace and rejects tokens with embedded spaces/newlines.
func cleanToken(token string) string {
	trimmed := strings.TrimSpace(token)
	if strings.ContainsAny(trimmed, " \t\n\r") {
		return ""
	}
	return trimmed
}

// ValidatePATFormat checks that a token has the bm_ prefix.
func ValidatePATFormat(token string) error {
	if !strings.HasPrefix(token, "bm_") {
		return fmt.Errorf("invalid token format: must start with 'bm_'")
	}
	return nil
}

// isJWTExpired checks if a JWT's exp claim is in the past.
// Returns false if the token can't be parsed (treat as valid, let the server decide).
func isJWTExpired(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}

	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return false
	}

	if claims.Exp == 0 {
		return false
	}

	// Add 30-second buffer to avoid edge cases
	return time.Now().Unix() > claims.Exp-30
}
