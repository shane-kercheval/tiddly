package testutil

// UserMeResponse returns a typical /users/me response body.
func UserMeResponse(email string) map[string]any {
	return map[string]any{
		"id":    "user-123",
		"email": email,
		"name":  "Test User",
	}
}

// HealthResponse returns a typical /health response body.
func HealthResponse() map[string]any {
	return map[string]any{
		"status": "ok",
	}
}

// Error451Response returns a 451 consent-required response.
func Error451Response() map[string]any {
	return map[string]any{
		"error":       "consent_required",
		"message":     "You must accept the Terms of Service",
		"consent_url": "https://tiddly.me/terms",
	}
}

// Error402Response returns a 402 quota-exceeded response.
func Error402Response(resource string, current, limit int) map[string]any {
	return map[string]any{
		"detail":     "Quota exceeded",
		"error_code": "QUOTA_EXCEEDED",
		"resource":   resource,
		"current":    current,
		"limit":      limit,
	}
}
