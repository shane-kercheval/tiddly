package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newCompletionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "completion [bash|zsh|fish]",
		Short: "Generate shell completion scripts",
		Long: `Generate shell completion scripts for tiddly.

  # Bash (add to ~/.bashrc)
  source <(tiddly completion bash)

  # Zsh (add to ~/.zshrc)
  source <(tiddly completion zsh)

  # Fish (add to ~/.config/fish/config.fish)
  tiddly completion fish | source`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"bash", "zsh", "fish"},
		RunE: func(cmd *cobra.Command, args []string) error {
			root := cmd.Root()
			out := cmd.OutOrStdout()
			switch args[0] {
			case "bash":
				return root.GenBashCompletionV2(out, true)
			case "zsh":
				return root.GenZshCompletion(out)
			case "fish":
				return root.GenFishCompletion(out, true)
			default:
				return fmt.Errorf("unsupported shell %q. Use bash, zsh, or fish", args[0])
			}
		},
	}

	return cmd
}
