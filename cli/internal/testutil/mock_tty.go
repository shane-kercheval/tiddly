package testutil

// MockTTYDetector implements TTYDetector for tests.
type MockTTYDetector struct {
	IsTTYValue bool
}

func (m *MockTTYDetector) IsTerminal(fd uintptr) bool {
	return m.IsTTYValue
}
