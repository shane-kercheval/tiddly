package api

// UserInfo represents the response from GET /users/me.
type UserInfo struct {
	ID      string `json:"id"`
	Auth0ID string `json:"auth0_id"`
	Email   string `json:"email"`
}

// HealthResponse represents the response from GET /health.
type HealthResponse struct {
	Status string `json:"status"`
}

// GetMe returns the current user info.
func (c *Client) GetMe() (*UserInfo, error) {
	var user UserInfo
	if err := c.Do("GET", "/users/me", nil, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

// GetHealth checks API health.
func (c *Client) GetHealth() (*HealthResponse, error) {
	var health HealthResponse
	if err := c.Do("GET", "/health", nil, &health); err != nil {
		return nil, err
	}
	return &health, nil
}
