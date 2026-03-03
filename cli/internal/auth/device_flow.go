package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// BrowserOpener opens URLs in the user's browser.
type BrowserOpener interface {
	Open(url string) error
}

// DefaultBrowserOpener opens URLs using the platform-specific command.
type DefaultBrowserOpener struct{}

func (o *DefaultBrowserOpener) Open(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "linux":
		cmd = "xdg-open"
		args = []string{url}
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}

	return exec.Command(cmd, args...).Start()
}

// Auth0Config holds Auth0 application configuration.
// These are public values (not secrets) for the first-party CLI app.
type Auth0Config struct {
	Domain   string
	ClientID string
	Audience string
}

// DefaultAuth0Config returns the production Auth0 configuration,
// with env var overrides for dev/staging testing.
func DefaultAuth0Config() Auth0Config {
	cfg := Auth0Config{
		Domain:   "tiddly.us.auth0.com",
		ClientID: "Gpv1ZrySgEeoTHlPyq3vSqHdFkS1vPwI",
		Audience: "tiddly-api",
	}

	if v := os.Getenv("TIDDLY_AUTH0_DOMAIN"); v != "" {
		cfg.Domain = v
	}
	if v := os.Getenv("TIDDLY_AUTH0_CLIENT_ID"); v != "" {
		cfg.ClientID = v
	}
	if v := os.Getenv("TIDDLY_AUTH0_AUDIENCE"); v != "" {
		cfg.Audience = v
	}

	return cfg
}

// DeviceCodeResponse is the response from the device authorization endpoint.
type DeviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// TokenResponse is the response from the token endpoint.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

// DeviceFlow handles the OAuth 2.0 Device Authorization flow.
type DeviceFlow struct {
	Auth0Config Auth0Config
	Browser     BrowserOpener
	HTTPClient  *http.Client
	// Output is where user-facing messages are written (defaults to os.Stderr).
	Output io.Writer
	// BaseURL overrides the default https://{domain} base for token endpoints.
	// Used in tests to point at httptest servers.
	BaseURL string
}

// tokenBaseURL returns the base URL for Auth0 token endpoints.
func (d *DeviceFlow) tokenBaseURL() string {
	if d.BaseURL != "" {
		return d.BaseURL
	}
	return fmt.Sprintf("https://%s", d.Auth0Config.Domain)
}

// NewDeviceFlow creates a DeviceFlow with default settings.
func NewDeviceFlow(cfg Auth0Config) *DeviceFlow {
	return &DeviceFlow{
		Auth0Config: cfg,
		Browser:     &DefaultBrowserOpener{},
		HTTPClient:  &http.Client{Timeout: 10 * time.Second},
		Output:      os.Stderr,
	}
}

// Login performs the full device flow: request code, show URL, poll for token.
// The context should be cancelled on Ctrl+C for clean exit.
func (d *DeviceFlow) Login(ctx context.Context) (*TokenResponse, error) {
	code, err := d.requestDeviceCode()
	if err != nil {
		return nil, fmt.Errorf("requesting device code: %w", err)
	}

	// Display the verification URL and code
	fmt.Fprintf(d.Output, "\nOpen this URL in your browser:\n  %s\n\n", code.VerificationURI)
	fmt.Fprintf(d.Output, "Enter code: %s\n\n", code.UserCode)

	// Try to open browser automatically
	if d.Browser != nil {
		uri := code.VerificationURIComplete
		if uri == "" {
			uri = code.VerificationURI
		}
		if err := d.Browser.Open(uri); err != nil {
			// Non-fatal; user can open manually
			fmt.Fprintf(d.Output, "(Could not open browser automatically)\n")
		}
	}

	fmt.Fprintf(d.Output, "Waiting for authorization...\n")

	return d.pollForToken(ctx, code)
}

func (d *DeviceFlow) requestDeviceCode() (*DeviceCodeResponse, error) {
	endpoint := d.tokenBaseURL() + "/oauth/device/code"
	data := url.Values{
		"client_id": {d.Auth0Config.ClientID},
		"scope":     {"openid profile email offline_access"},
		"audience":  {d.Auth0Config.Audience},
	}

	resp, err := d.HTTPClient.PostForm(endpoint, data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("device code request failed (%d): %s", resp.StatusCode, string(body))
	}

	var code DeviceCodeResponse
	if err := json.Unmarshal(body, &code); err != nil {
		return nil, fmt.Errorf("parsing device code response: %w", err)
	}

	if code.Interval == 0 {
		code.Interval = 5
	}

	return &code, nil
}

func (d *DeviceFlow) pollForToken(ctx context.Context, code *DeviceCodeResponse) (*TokenResponse, error) {
	endpoint := d.tokenBaseURL() + "/oauth/token"
	data := url.Values{
		"client_id":   {d.Auth0Config.ClientID},
		"device_code": {code.DeviceCode},
		"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
	}

	interval := time.Duration(code.Interval) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	expiry := time.After(time.Duration(code.ExpiresIn) * time.Second)

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("login cancelled")
		case <-expiry:
			return nil, fmt.Errorf("device code expired; please try again")
		case <-ticker.C:
			token, done, slowDown, err := d.tryTokenExchange(endpoint, data)
			if err != nil {
				return nil, err
			}
			if done {
				return token, nil
			}
			if slowDown {
				// RFC 8628 §3.5: increase interval by 5 seconds on slow_down
				interval += 5 * time.Second
				ticker.Reset(interval)
			}
		}
	}
}

func (d *DeviceFlow) tryTokenExchange(endpoint string, data url.Values) (token *TokenResponse, done bool, slowDown bool, err error) {
	resp, err := d.HTTPClient.PostForm(endpoint, data)
	if err != nil {
		return nil, false, false, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false, false, fmt.Errorf("reading token response: %w", err)
	}

	if resp.StatusCode == http.StatusOK {
		var tok TokenResponse
		if err := json.Unmarshal(body, &tok); err != nil {
			return nil, false, false, fmt.Errorf("parsing token response: %w", err)
		}
		return &tok, true, false, nil
	}

	var errResp struct {
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if json.Unmarshal(body, &errResp) != nil {
		return nil, false, false, fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, string(body))
	}

	switch errResp.Error {
	case "authorization_pending":
		return nil, false, false, nil
	case "slow_down":
		return nil, false, true, nil
	case "expired_token":
		return nil, false, false, fmt.Errorf("device code expired; please try again")
	case "access_denied":
		return nil, false, false, fmt.Errorf("access denied: %s", errResp.ErrorDescription)
	default:
		return nil, false, false, fmt.Errorf("auth error: %s — %s", errResp.Error, errResp.ErrorDescription)
	}
}

// RefreshAccessToken uses a refresh token to get new access and refresh tokens.
// Auth0 with rotation enabled invalidates the old refresh token, so both tokens
// returned must be stored.
func (d *DeviceFlow) RefreshAccessToken(refreshToken string) (*TokenResponse, error) {
	endpoint := d.tokenBaseURL() + "/oauth/token"
	data := url.Values{
		"client_id":     {d.Auth0Config.ClientID},
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}

	resp, err := d.HTTPClient.PostForm(endpoint, data)
	if err != nil {
		return nil, fmt.Errorf("refresh request failed: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading refresh response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Error            string `json:"error"`
			ErrorDescription string `json:"error_description"`
		}
		if json.Unmarshal(body, &errResp) == nil {
			if strings.Contains(errResp.ErrorDescription, "revoked") ||
				strings.Contains(errResp.ErrorDescription, "invalid") ||
				errResp.Error == "invalid_grant" {
				return nil, fmt.Errorf("session expired. Run 'tiddly login' to re-authenticate")
			}
		}
		return nil, fmt.Errorf("token refresh failed (%d): %s", resp.StatusCode, string(body))
	}

	var token TokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, fmt.Errorf("parsing refresh response: %w", err)
	}

	return &token, nil
}
