package mcp

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockRunner struct {
	calls   []mockCall
	results map[string]mockResult
}

type mockCall struct {
	name string
	args []string
}

type mockResult struct {
	stdout string
	stderr string
	err    error
}

func newMockRunner() *mockRunner {
	return &mockRunner{results: make(map[string]mockResult)}
}

func (m *mockRunner) Run(name string, args ...string) (string, string, error) {
	m.calls = append(m.calls, mockCall{name: name, args: args})
	// Match on full command string for specific results
	key := name
	for _, a := range args {
		key += " " + a
	}
	if result, ok := m.results[key]; ok {
		return result.stdout, result.stderr, result.err
	}
	// Default: success
	return "", "", nil
}

func TestInstallClaudeCode__calls_correct_commands(t *testing.T) {
	runner := newMockRunner()

	err := InstallClaudeCode(runner, "bm_content", "bm_prompts", "user")
	require.NoError(t, err)

	require.Len(t, runner.calls, 2)

	// First call: content server
	call := runner.calls[0]
	assert.Equal(t, "claude", call.name)
	assert.Contains(t, call.args, "bookmarks_notes")
	assert.Contains(t, call.args, ContentMCPURL())
	assert.Contains(t, call.args, "--scope")
	assert.Contains(t, call.args, "user")

	// Second call: prompts server
	call = runner.calls[1]
	assert.Equal(t, "claude", call.name)
	assert.Contains(t, call.args, "prompts")
	assert.Contains(t, call.args, PromptMCPURL())
}

func TestInstallClaudeCode__default_scope_is_user(t *testing.T) {
	runner := newMockRunner()

	err := InstallClaudeCode(runner, "bm_content", "", "")
	require.NoError(t, err)

	require.Len(t, runner.calls, 1)
	assert.Contains(t, runner.calls[0].args, "user")
}

func TestInstallClaudeCode__local_scope(t *testing.T) {
	runner := newMockRunner()

	err := InstallClaudeCode(runner, "bm_content", "", "local")
	require.NoError(t, err)

	assert.Contains(t, runner.calls[0].args, "local")
}

func TestInstallClaudeCode__error_propagates(t *testing.T) {
	failRunner := &failingRunner{stderr: "command failed", err: fmt.Errorf("exit 1")}
	err := InstallClaudeCode(failRunner, "bm_content", "", "user")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "bookmarks_notes")
}

type failingRunner struct {
	stderr string
	err    error
}

func (f *failingRunner) Run(name string, args ...string) (string, string, error) {
	return "", f.stderr, f.err
}

func TestUninstallClaudeCode__calls_remove(t *testing.T) {
	runner := newMockRunner()

	err := UninstallClaudeCode(runner)
	require.NoError(t, err)

	require.Len(t, runner.calls, 2)
	assert.Equal(t, []string{"mcp", "remove", "bookmarks_notes"}, runner.calls[0].args)
	assert.Equal(t, []string{"mcp", "remove", "prompts"}, runner.calls[1].args)
}

func TestStatusClaudeCode__finds_servers(t *testing.T) {
	runner := newMockRunner()
	// Simulate claude mcp list output
	runner.results["claude mcp list"] = mockResult{
		stdout: "bookmarks_notes  http  https://content-mcp.tiddly.me/mcp\nprompts  http  https://prompt-mcp.tiddly.me/mcp\n",
	}

	servers, err := StatusClaudeCode(runner)
	require.NoError(t, err)
	assert.Equal(t, []string{"bookmarks_notes", "prompts"}, servers)
}

func TestStatusClaudeCode__no_servers(t *testing.T) {
	runner := newMockRunner()

	servers, err := StatusClaudeCode(runner)
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestDryRunClaudeCode__generates_commands(t *testing.T) {
	cmds := DryRunClaudeCode("bm_content", "bm_prompts", "user")

	assert.Len(t, cmds, 2)
	assert.Contains(t, cmds[0], "bookmarks_notes")
	assert.Contains(t, cmds[0], "--scope user")
	assert.Contains(t, cmds[0], "bm_content")
	assert.Contains(t, cmds[1], "prompts")
}

func TestShellQuote(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", "'simple'"},
		{"has space", "'has space'"},
		{"has'quote", `'has'\''quote'`},
	}

	for _, tt := range tests {
		assert.Equal(t, tt.expected, shellQuote(tt.input))
	}
}
