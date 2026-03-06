package testutil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// MockAPI is a builder for httptest.Server with route-based response matching.
type MockAPI struct {
	t       *testing.T
	routes  map[string]*Route
	mu      sync.Mutex
	server  *httptest.Server
}

// Route holds response configuration for a specific method+path.
type Route struct {
	status         int
	body           []byte
	headers        map[string]string
	assertHeaders  map[string]string
	callCount      int
	expectedCalls  int
	handler        http.HandlerFunc
	mu             sync.Mutex
}

// RouteBuilder configures a route.
type RouteBuilder struct {
	route *Route
	mock  *MockAPI
}

// NewMockAPI creates a new MockAPI and starts the test server.
func NewMockAPI(t *testing.T) *MockAPI {
	m := &MockAPI{
		t:      t,
		routes: make(map[string]*Route),
	}

	m.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		m.mu.Lock()
		route, ok := m.routes[key]
		m.mu.Unlock()

		if !ok {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		route.mu.Lock()
		route.callCount++
		route.mu.Unlock()

		// Check expected headers
		for k, v := range route.assertHeaders {
			got := r.Header.Get(k)
			if got != v {
				t.Errorf("expected header %s=%q, got %q", k, v, got)
			}
		}

		// Use custom handler if set
		if route.handler != nil {
			route.handler(w, r)
			return
		}

		for k, v := range route.headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(route.status)
		if route.body != nil {
			w.Write(route.body)
		}
	}))

	t.Cleanup(func() {
		m.server.Close()
		m.assertCallCounts()
	})

	return m
}

// On registers a route for the given method and path.
func (m *MockAPI) On(method, path string) *RouteBuilder {
	route := &Route{
		status:        200,
		assertHeaders: make(map[string]string),
		headers:       make(map[string]string),
		expectedCalls: -1, // -1 means not checked
	}
	key := method + " " + path
	m.mu.Lock()
	m.routes[key] = route
	m.mu.Unlock()
	return &RouteBuilder{route: route, mock: m}
}

// RespondJSON sets the response status and JSON body.
func (rb *RouteBuilder) RespondJSON(status int, body any) *RouteBuilder {
	data, err := json.Marshal(body)
	if err != nil {
		rb.mock.t.Fatalf("marshaling response: %v", err)
	}
	rb.route.status = status
	rb.route.body = data
	rb.route.headers["Content-Type"] = "application/json"
	return rb
}

// RespondError sets an error response.
func (rb *RouteBuilder) RespondError(status int, message string) *RouteBuilder {
	body := map[string]string{"detail": message}
	return rb.RespondJSON(status, body)
}

// Respond sets a raw response.
func (rb *RouteBuilder) Respond(status int, body []byte) *RouteBuilder {
	rb.route.status = status
	rb.route.body = body
	return rb
}

// WithHeader sets a response header.
func (rb *RouteBuilder) WithHeader(key, value string) *RouteBuilder {
	rb.route.headers[key] = value
	return rb
}

// AssertHeader expects a request header.
func (rb *RouteBuilder) AssertHeader(key, value string) *RouteBuilder {
	rb.route.assertHeaders[key] = value
	return rb
}

// AssertCalled expects the route to be called exactly n times.
func (rb *RouteBuilder) AssertCalled(times int) *RouteBuilder {
	rb.route.expectedCalls = times
	return rb
}

// HandleFunc sets a custom handler for the route.
func (rb *RouteBuilder) HandleFunc(handler http.HandlerFunc) *RouteBuilder {
	rb.route.handler = handler
	return rb
}

// URL returns the base URL of the test server.
func (m *MockAPI) URL() string {
	return m.server.URL
}

func (m *MockAPI) assertCallCounts() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, route := range m.routes {
		if route.expectedCalls >= 0 && route.callCount != route.expectedCalls {
			m.t.Errorf("route %s: expected %d calls, got %d", key, route.expectedCalls, route.callCount)
		}
	}
}
