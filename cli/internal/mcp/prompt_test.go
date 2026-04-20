package mcp

import (
	"bytes"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPromptYesNo__explicit_yes(t *testing.T) {
	for _, input := range []string{"y\n", "Y\n", "yes\n", "YES\n", "  yes  \n", "Y"} {
		t.Run(input, func(t *testing.T) {
			var out bytes.Buffer
			ok, err := promptYesNo(&out, strings.NewReader(input), "continue? ")
			require.NoError(t, err)
			assert.True(t, ok, "input %q should be treated as yes", input)
			assert.Equal(t, "continue? ", out.String())
		})
	}
}

func TestPromptYesNo__default_no(t *testing.T) {
	// Anything other than y/yes (case-insensitive) should be No, including
	// empty input, stray letters, and the full word "no".
	for _, input := range []string{"", "\n", "n\n", "no\n", "maybe\n", " \n"} {
		t.Run(input, func(t *testing.T) {
			var out bytes.Buffer
			ok, err := promptYesNo(&out, strings.NewReader(input), "continue? ")
			require.NoError(t, err)
			assert.False(t, ok, "input %q should default to No", input)
		})
	}
}
