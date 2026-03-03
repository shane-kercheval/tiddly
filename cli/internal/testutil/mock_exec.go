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

// MockCommandRunner implements CommandRunner for tests.
type MockCommandRunner struct {
	Calls   []MockCall
	Results map[string]MockCallResult
}

type MockCall struct {
	Name string
	Args []string
}

type MockCallResult struct {
	Stdout string
	Stderr string
	Err    error
}

func NewMockCommandRunner() *MockCommandRunner {
	return &MockCommandRunner{Results: make(map[string]MockCallResult)}
}

func (m *MockCommandRunner) Run(name string, args ...string) (string, string, error) {
	m.Calls = append(m.Calls, MockCall{Name: name, Args: args})
	if result, ok := m.Results[name]; ok {
		return result.Stdout, result.Stderr, result.Err
	}
	return "", "", nil
}
