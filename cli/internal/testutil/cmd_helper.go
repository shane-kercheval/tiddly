package testutil

import (
	"bytes"
	"os"
	"testing"

	"github.com/spf13/cobra"
)

// CmdResult captures the output of a command execution.
type CmdResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Err      error
}

// ExecuteCmd runs a cobra.Command with the given args and captures output.
// This executes the command in-process (not as a subprocess).
func ExecuteCmd(t *testing.T, cmd *cobra.Command, args ...string) *CmdResult {
	t.Helper()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	cmd.SetOut(stdout)
	cmd.SetErr(stderr)
	cmd.SetArgs(args)

	// Prevent os.Exit
	cmd.SilenceErrors = true
	cmd.SilenceUsage = true

	err := cmd.Execute()

	result := &CmdResult{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
		Err:    err,
	}

	if err != nil {
		result.ExitCode = 1
	}

	return result
}

// WriteFile creates a file with the given content in a directory.
func WriteFile(t *testing.T, dir, filename, content string) string {
	t.Helper()
	path := dir + "/" + filename
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("creating directory %s: %v", dir, err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writing file %s: %v", path, err)
	}
	return path
}
