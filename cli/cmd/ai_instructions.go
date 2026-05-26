package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/spf13/cobra"
)

// The hosted instructions doc lives at the web origin (see config.WebURL), not the API.
const (
	llmsCLIInstructionsPath = "/llms-cli-instructions.txt"
	aiInstructionsTimeout   = 5 * time.Second
	aiInstructionsMaxBytes  = 1 << 20 // 1 MiB cap; the doc is a few KB. Defensive bound.
)

// aiInstructionsFallback is printed when the hosted doc can't be fetched. Kept
// intentionally minimal — just a pointer to the live URL plus a quick start — so it
// has near-zero drift cost against the always-current hosted file (which is the source
// of truth). Do not grow this into a copy of the doc.
const aiInstructionsFallback = `Tiddly CLI — agent instructions (offline fallback)

The latest instructions could not be fetched. Read the current version at:
  https://tiddly.me/llms-cli-instructions.txt

Quick start:
  tiddly login           Authenticate (OAuth device-code, or: tiddly login --token bm_...)
  tiddly mcp configure   Connect detected AI tools to your content via MCP
  tiddly status          Show what's configured

Run "tiddly --help" for the full command list.`

func newAIInstructionsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ai-instructions",
		Short: "Print Tiddly's CLI instructions for AI agents (agents should run this first)",
		Long: `Print Tiddly's CLI instructions for AI agents.

If you are an AI agent working with Tiddly, run this first: it prints how to use the
tiddly CLI to connect a user's bookmarks, notes, and prompts to their AI tools.

The text is fetched live from ` + config.DefaultWebURL + llmsCLIInstructionsPath + ` so it is
always current. No login is required. If it can't be fetched (offline), a minimal
fallback that points at the URL is printed instead, and the command still succeeds.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			url := config.WebURL() + llmsCLIInstructionsPath
			body, err := fetchAIInstructions(cmd.Context(), url)
			if err != nil {
				// Never fail: an agent should always get usable content. Print the
				// minimal fallback, note the failure on stderr, and exit 0.
				fmt.Fprintf(cmd.ErrOrStderr(),
					"note: could not fetch the latest instructions (%v); showing a minimal offline fallback.\n", err)
				fmt.Fprintln(cmd.OutOrStdout(), aiInstructionsFallback)
				return nil
			}
			fmt.Fprintln(cmd.OutOrStdout(), body)
			return nil
		},
	}
}

// fetchAIInstructions GETs the hosted instructions with a short timeout. Returns an
// error on transport failure, non-200, or read failure so the caller can fall back.
func fetchAIInstructions(ctx context.Context, url string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, aiInstructionsTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	// The instructions live at the web origin, where a missing/misdeployed path is
	// served as the SPA's index.html (HTTP 200, text/html) rather than a 404. Reject
	// an HTML response so we print the fallback instead of feeding an agent the app
	// shell — the real .txt is served as text/plain.
	if ct := resp.Header.Get("Content-Type"); strings.Contains(strings.ToLower(ct), "text/html") {
		return "", fmt.Errorf("origin returned the SPA shell (content-type %q), not the instructions file", ct)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, aiInstructionsMaxBytes))
	if err != nil {
		return "", err
	}
	return string(body), nil
}
