package cmd

import (
	"bytes"
	"fmt"
	"io"
	"path"
	"runtime"

	"github.com/shane-kercheval/tiddly/cli/internal/update"
	"github.com/spf13/cobra"
)

func newUpdateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "update",
		Short: "Update Tiddly CLI to the latest version",
		Long: `Download and install the latest version of the Tiddly CLI.

  tiddly update    Download and replace the current binary

The binary is verified via SHA256 checksum before replacement.
On Linux/macOS, the binary is replaced atomically via rename.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if runtime.GOOS == "windows" {
				return fmt.Errorf("automatic update not supported on Windows. Download the latest release from https://github.com/shane-kercheval/tiddly/releases")
			}

			ctx := cmd.Context()
			stderr := cmd.ErrOrStderr()
			stdout := cmd.OutOrStdout()

			var checker update.Checker
			if appDeps != nil && appDeps.UpdateChecker != nil {
				checker = appDeps.UpdateChecker
			} else {
				checker = update.NewGitHubChecker()
			}

			// 1. Get latest release
			release, err := checker.LatestRelease(ctx)
			if err != nil {
				return fmt.Errorf("checking for updates: %w", err)
			}

			// 2. Check if newer
			if !update.IsNewer(cliVersion, release.Version) {
				fmt.Fprintf(stdout, "Already up to date (v%s)\n", cliVersion)
				return nil
			}

			fmt.Fprintf(stderr, "Downloading %s...\n", release.Version)

			// 3. Download and verify checksum
			if release.ChecksumURL == "" {
				return fmt.Errorf("release missing checksums.txt — cannot verify integrity")
			}
			csBody, err := checker.Download(ctx, release.ChecksumURL)
			if err != nil {
				return fmt.Errorf("downloading checksums: %w", err)
			}
			checksums, err := update.ParseChecksums(csBody)
			csBody.Close() //nolint:errcheck // body fully read by ParseChecksums
			if err != nil {
				return fmt.Errorf("parsing checksums: %w", err)
			}

			// 4. Download binary archive
			body, err := checker.Download(ctx, release.AssetURL)
			if err != nil {
				return fmt.Errorf("downloading release: %w", err)
			}
			archiveData, err := io.ReadAll(body)
			body.Close() //nolint:errcheck // body fully read by ReadAll
			if err != nil {
				return fmt.Errorf("reading download: %w", err)
			}

			// 5. Verify checksum
			assetName := path.Base(release.AssetURL)
			expected, ok := checksums[assetName]
			if !ok {
				return fmt.Errorf("no checksum found for %s", assetName)
			}
			if err := update.VerifyChecksum(archiveData, expected); err != nil {
				return fmt.Errorf("verification failed: %w", err)
			}

			// 6. Extract binary
			binaryData, err := update.ExtractBinary(bytes.NewReader(archiveData))
			if err != nil {
				return fmt.Errorf("extracting binary: %w", err)
			}

			// 7. Replace binary
			if err := update.ReplaceBinary(binaryData); err != nil {
				return err
			}

			fmt.Fprintf(stdout, "Updated from v%s to %s\n", cliVersion, update.DisplayVersion(release.Version))
			return nil
		},
	}
}
