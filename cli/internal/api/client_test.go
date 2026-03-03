package api

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClient__headers_set_correctly(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/users/me").
		AssertHeader("Authorization", "Bearer test-token").
		AssertHeader("X-Request-Source", "cli").
		AssertHeader("Content-Type", "application/json").
		RespondJSON(200, map[string]any{"email": "test@example.com"}).
		AssertCalled(1)

	client := NewClient(mock.URL(), "test-token", "pat")
	var result map[string]any
	err := client.Do("GET", "/users/me", nil, &result)
	require.NoError(t, err)
	assert.Equal(t, "test@example.com", result["email"])
}

func TestClient__error_handling(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       any
		wantMsg    string
		wantStatus int
	}{
		{
			name:       "401 returns session expired message",
			status:     401,
			body:       map[string]string{"detail": "invalid token"},
			wantMsg:    "Session expired. Run 'tiddly login' to re-authenticate.",
			wantStatus: 401,
		},
		{
			name:   "402 parses quota error",
			status: 402,
			body: map[string]any{
				"detail":     "Quota exceeded",
				"error_code": "QUOTA_EXCEEDED",
				"resource":   "bookmarks",
				"current":    100,
				"limit":      100,
			},
			wantMsg:    "Quota exceeded: bookmarks (100/100). Upgrade at https://tiddly.me/pricing",
			wantStatus: 402,
		},
		{
			name:       "403 returns browser login message",
			status:     403,
			body:       map[string]string{"detail": "forbidden"},
			wantMsg:    "This action requires browser login. Run 'tiddly login' (without --token).",
			wantStatus: 403,
		},
		{
			name:   "451 returns consent message with URL",
			status: 451,
			body: map[string]any{
				"error":       "consent_required",
				"message":     "Accept TOS",
				"consent_url": "https://tiddly.me/terms",
			},
			wantMsg:    "Please accept Terms of Service at https://tiddly.me/terms",
			wantStatus: 451,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := testutil.NewMockAPI(t)
			mock.On("GET", "/test").RespondJSON(tt.status, tt.body)

			client := NewClient(mock.URL(), "token", "pat")
			err := client.Do("GET", "/test", nil, nil)
			require.Error(t, err)

			apiErr, ok := err.(*APIError)
			require.True(t, ok, "expected APIError, got %T", err)
			assert.Equal(t, tt.wantStatus, apiErr.StatusCode)
			assert.Contains(t, apiErr.Message, tt.wantMsg)
		})
	}
}

func TestClient__429_retry_then_success(t *testing.T) {
	mock := testutil.NewMockAPI(t)

	callCount := 0
	mock.On("GET", "/test").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			w.Write([]byte(`{"detail":"rate limited"}`))
			return
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"ok":true}`))
	})

	stderr := &bytes.Buffer{}
	client := NewClient(mock.URL(), "token", "pat")
	client.Stderr = stderr

	var result map[string]any
	err := client.Do("GET", "/test", nil, &result)
	require.NoError(t, err)
	assert.Equal(t, true, result["ok"])
	assert.Equal(t, 2, callCount)
	assert.Contains(t, stderr.String(), "Rate limited, retrying")
}

func TestClient__429_gives_up_after_max_retries(t *testing.T) {
	mock := testutil.NewMockAPI(t)

	mock.On("GET", "/test").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(429)
		w.Write([]byte(`{"detail":"rate limited"}`))
	})

	client := NewClient(mock.URL(), "token", "pat")
	err := client.Do("GET", "/test", nil, nil)
	require.Error(t, err)

	apiErr, ok := err.(*APIError)
	require.True(t, ok)
	assert.Equal(t, 429, apiErr.StatusCode)
	assert.Contains(t, apiErr.Message, "Rate limited")
}

func TestClient__429_retry_message_to_stderr(t *testing.T) {
	mock := testutil.NewMockAPI(t)

	mock.On("GET", "/test").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(429)
		w.Write([]byte(`{"detail":"rate limited"}`))
	})

	stderr := &bytes.Buffer{}
	client := NewClient(mock.URL(), "token", "pat")
	client.Stderr = stderr

	_ = client.Do("GET", "/test", nil, nil)
	assert.Contains(t, stderr.String(), "Rate limited, retrying")
}

func TestClient__successful_json_deserialization(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/health").RespondJSON(200, map[string]string{"status": "ok"})

	client := NewClient(mock.URL(), "token", "pat")
	var result HealthResponse
	err := client.Do("GET", "/health", nil, &result)
	require.NoError(t, err)
	assert.Equal(t, "ok", result.Status)
}

func TestClient__402_without_structured_body(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/test").RespondJSON(402, map[string]string{"detail": "payment required"})

	client := NewClient(mock.URL(), "token", "pat")
	err := client.Do("GET", "/test", nil, nil)
	require.Error(t, err)

	apiErr, ok := err.(*APIError)
	require.True(t, ok)
	assert.Equal(t, 402, apiErr.StatusCode)
	assert.Contains(t, apiErr.Message, "Quota exceeded")
}
