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

	if preferOAuth {
		// 3. OAuth first when preferred
		if result, err := tm.resolveOAuth(); err == nil {
			return result, nil
		}
		// 4. Fall back to PAT
		if result, err := tm.resolvePAT(); err == nil {
			return result, nil
		}
	} else {
		// 3. PAT first (default)
		if result, err := tm.resolvePAT(); err == nil {
			return result, nil
		}
		// 4. Fall back to OAuth
		if result, err := tm.resolveOAuth(); err == nil {
			return result, nil
		}
	}

	return nil, fmt.Errorf("not logged in. Run 'tiddly login' to authenticate")
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

	// Store BOTH new tokens (Auth0 rotation invalidates old refresh token)
	if err := tm.Store.Set(AccountOAuthAccess, result.AccessToken); err != nil {
		return "", fmt.Errorf("storing refreshed access token: %w", err)
	}
	if result.RefreshToken != "" {
		if err := tm.Store.Set(AccountOAuthRefresh, result.RefreshToken); err != nil {
			return "", fmt.Errorf("storing refreshed refresh token: %w", err)
		}
	}

	return result.AccessToken, nil
}

// StorePAT stores a PAT in the credential store.
func (tm *TokenManager) StorePAT(token string) error {
	return tm.Store.Set(AccountPAT, token)
}

// StoreOAuthTokens stores OAuth access and refresh tokens.
func (tm *TokenManager) StoreOAuthTokens(accessToken, refreshToken string) error {
	if err := tm.Store.Set(AccountOAuthAccess, accessToken); err != nil {
		return err
	}
	if refreshToken != "" {
		return tm.Store.Set(AccountOAuthRefresh, refreshToken)
	}
	return nil
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
		return fmt.Errorf("clearing credentials: %v", errs)
	}
	return nil
}

// GetStoredAuthType returns what type of credentials are stored.
func (tm *TokenManager) GetStoredAuthType() string {
	if _, err := tm.Store.Get(AccountOAuthAccess); err == nil {
		return "oauth"
	}
	if _, err := tm.Store.Get(AccountPAT); err == nil {
		return "pat"
	}
	return "none"
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
