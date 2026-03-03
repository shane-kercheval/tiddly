package api

import "fmt"

// TokenCreateRequest is the body for POST /tokens/.
type TokenCreateRequest struct {
	Name          string `json:"name"`
	ExpiresInDays *int   `json:"expires_in_days,omitempty"`
}

// TokenCreateResponse is the response from POST /tokens/.
type TokenCreateResponse struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Token       string  `json:"token"` // plaintext, shown once
	TokenPrefix string  `json:"token_prefix"`
	ExpiresAt   *string `json:"expires_at"`
}

// TokenInfo is the metadata for a PAT (no plaintext token).
type TokenInfo struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	TokenPrefix string  `json:"token_prefix"`
	LastUsedAt  *string `json:"last_used_at"`
	ExpiresAt   *string `json:"expires_at"`
	CreatedAt   string  `json:"created_at"`
}

// CreateToken creates a new PAT. Requires OAuth auth (403 for PATs).
func (c *Client) CreateToken(name string, expiresInDays *int) (*TokenCreateResponse, error) {
	req := TokenCreateRequest{Name: name, ExpiresInDays: expiresInDays}
	var resp TokenCreateResponse
	if err := c.Do("POST", "/tokens/", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ListTokens returns all PATs for the current user. Requires OAuth auth.
func (c *Client) ListTokens() ([]TokenInfo, error) {
	var resp []TokenInfo
	if err := c.Do("GET", "/tokens/", nil, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// DeleteToken revokes a PAT by ID. Requires OAuth auth.
func (c *Client) DeleteToken(id string) error {
	return c.Do("DELETE", fmt.Sprintf("/tokens/%s", id), nil, nil)
}
