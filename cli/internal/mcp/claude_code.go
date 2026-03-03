package mcp

import (
	"fmt"
	"strings"
)

// CommandRunner executes system commands.
type CommandRunner interface {
	Run(name string, args ...string) (stdout string, stderr string, err error)
}

// InstallClaudeCode configures MCP servers in Claude Code via subprocess.
func InstallClaudeCode(runner CommandRunner, contentPAT, promptPAT, scope string) error {
	if scope == "" {
		scope = "user"
	}

	if contentPAT != "" {
		_, stderr, err := runner.Run("claude", "mcp", "add",
			"--transport", "http",
			"--scope", scope,
			serverNameContent,
			ContentMCPURL(),
			"--header", "Authorization: Bearer "+contentPAT,
		)
		if err != nil {
			return fmt.Errorf("configuring %s: %s: %w", serverNameContent, strings.TrimSpace(stderr), err)
		}
	}

	if promptPAT != "" {
		_, stderr, err := runner.Run("claude", "mcp", "add",
			"--transport", "http",
			"--scope", scope,
			serverNamePrompts,
			PromptMCPURL(),
			"--header", "Authorization: Bearer "+promptPAT,
		)
		if err != nil {
			return fmt.Errorf("configuring %s: %s: %w", serverNamePrompts, strings.TrimSpace(stderr), err)
		}
	}

	return nil
}

// UninstallClaudeCode removes tiddly MCP servers from Claude Code.
func UninstallClaudeCode(runner CommandRunner) error {
	for _, name := range []string{serverNameContent, serverNamePrompts} {
		_, _, err := runner.Run("claude", "mcp", "remove", name)
		if err != nil {
			// Ignore errors — server may not exist
			continue
		}
	}
	return nil
}

// StatusClaudeCode returns tiddly MCP servers configured in Claude Code.
func StatusClaudeCode(runner CommandRunner) ([]string, error) {
	stdout, _, err := runner.Run("claude", "mcp", "list")
	if err != nil {
		return nil, fmt.Errorf("listing Claude Code MCP servers: %w", err)
	}

	var found []string
	for _, name := range []string{serverNameContent, serverNamePrompts} {
		if strings.Contains(stdout, name) {
			found = append(found, name)
		}
	}
	return found, nil
}

// DryRunClaudeCode returns the shell commands that would be executed.
func DryRunClaudeCode(contentPAT, promptPAT, scope string) []string {
	if scope == "" {
		scope = "user"
	}

	var cmds []string
	if contentPAT != "" {
		cmds = append(cmds, fmt.Sprintf(
			`claude mcp add --transport http --scope %s %s %s --header %s`,
			scope, serverNameContent, ContentMCPURL(),
			shellQuote("Authorization: Bearer "+contentPAT),
		))
	}
	if promptPAT != "" {
		cmds = append(cmds, fmt.Sprintf(
			`claude mcp add --transport http --scope %s %s %s --header %s`,
			scope, serverNamePrompts, PromptMCPURL(),
			shellQuote("Authorization: Bearer "+promptPAT),
		))
	}
	return cmds
}

// shellQuote wraps a string in single quotes, escaping any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
