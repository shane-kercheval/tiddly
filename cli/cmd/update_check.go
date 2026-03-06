package cmd

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/shane-kercheval/tiddly/cli/internal/update"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"golang.org/x/term"
)

// isStderrTTY reports whether stderr is a terminal. Overridden in tests.
var isStderrTTY = func() bool {
	return term.IsTerminal(int(os.Stderr.Fd()))
}

// shouldCheckForUpdates returns true if an auto-update check should run.
func shouldCheckForUpdates(cmd *cobra.Command, configDir string) bool {
	// Skip for commands where update notifications are not useful.
	// Check the full command ancestry so subcommands (e.g. "config get") are also skipped.
	for c := cmd; c != nil; c = c.Parent() {
		switch c.Name() {
		case "upgrade", "completion", "help", "config":
			return false
		}
	}

	// Skip dev builds
	if cliVersion == "dev" {
		return false
	}

	// Skip if user opted out via config
	if !viper.GetBool("update_check") {
		return false
	}

	// Skip if opted out via env
	if os.Getenv("TIDDLY_NO_UPDATE_CHECK") == "1" {
		return false
	}

	// Skip in CI environments
	if os.Getenv("CI") == "true" {
		return false
	}

	// Skip if stderr is not a TTY (e.g., piped output)
	if !isStderrTTY() {
		return false
	}

	// Skip if checked recently
	if configDir != "" {
		state, err := config.ReadState(configDir)
		if err == nil && !update.NeedsCheck(state.LastUpdateCheck) {
			return false
		}
	}

	return true
}

// startUpdateCheck launches a background goroutine to check for updates.
// Returns a channel that will receive a message string (or empty if no update).
func startUpdateCheck(ctx context.Context, checker update.Checker, configDir string) <-chan string {
	ch := make(chan string, 1)

	go func() {
		release, err := checker.LatestRelease(ctx)
		if err != nil {
			ch <- ""
			return
		}

		// Record check time (best-effort)
		if configDir != "" {
			_ = config.WriteState(configDir, &config.State{
				LastUpdateCheck: time.Now(),
			})
		}

		if update.IsNewer(cliVersion, release.Version) {
			ch <- fmt.Sprintf("A new version of tiddly is available: %s (current: %s). Run 'tiddly upgrade' to update.", update.DisplayVersion(release.Version), update.DisplayVersion(cliVersion))
		} else {
			ch <- ""
		}
	}()

	return ch
}
