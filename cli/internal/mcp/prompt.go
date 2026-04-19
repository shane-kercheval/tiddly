package mcp

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
)

// isStdinTerminal reports whether stdin is connected to an interactive
// terminal. Overridable in tests to simulate interactive vs piped/CI stdin
// without requiring a real TTY.
var isStdinTerminal = func() bool {
	return term.IsTerminal(int(os.Stdin.Fd()))
}

// promptYesNo writes prompt to w and reads a single line from r. Returns
// true only for an explicit "y" or "yes" (case-insensitive, whitespace
// trimmed). Any other input — including empty input from EOF — is treated
// as "no" so the destructive default is always the safe one.
func promptYesNo(w io.Writer, r io.Reader, prompt string) (bool, error) {
	if _, err := fmt.Fprint(w, prompt); err != nil {
		return false, fmt.Errorf("writing prompt: %w", err)
	}
	reader := bufio.NewReader(r)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return false, fmt.Errorf("reading confirmation: %w", err)
	}
	answer := strings.TrimSpace(strings.ToLower(line))
	return answer == "y" || answer == "yes", nil
}
