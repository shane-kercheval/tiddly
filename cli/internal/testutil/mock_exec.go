package testutil

// MockExecLooker implements ExecLooker for tests.
type MockExecLooker struct {
	Paths map[string]string // binary name -> path
}

func NewMockExecLooker() *MockExecLooker {
	return &MockExecLooker{Paths: make(map[string]string)}
}

func (m *MockExecLooker) LookPath(file string) (string, error) {
	if path, ok := m.Paths[file]; ok {
		return path, nil
	}
	return "", &lookPathError{file: file}
}

type lookPathError struct {
	file string
}

func (e *lookPathError) Error() string {
	return "executable file not found: " + e.file
}
