import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { StepSection } from './components/StepSection'

interface CLIPageCard {
  name: string
  description: string
  path: string
}

const PAGES: CLIPageCard[] = [
  {
    name: 'Authentication',
    description: 'Login with OAuth or Personal Access Token, credential storage, and token resolution.',
    path: '/docs/cli/authentication',
  },
  {
    name: 'MCP Setup',
    description: 'Auto-detect AI tools and configure MCP servers with dedicated tokens.',
    path: '/docs/cli/mcp',
  },
  {
    name: 'Skills',
    description: 'Export prompt templates as agent skills for Claude Code, Codex, and Claude Desktop.',
    path: '/docs/cli/skills',
  },
]

export function DocsCLIHub(): ReactNode {
  usePageTitle('Docs - CLI')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Tiddly CLI</h1>
      <p className="text-gray-600 mb-8">
        The Tiddly CLI (<code className="bg-gray-100 px-1 rounded">tiddly</code>) is a command-line
        tool for authenticating with the Tiddly API, configuring MCP servers, syncing agent skills,
        and exporting content for AI tools like Claude Desktop, Claude Code, and Codex.
      </p>

      {/* Quick Start */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Start</h2>

      <StepSection step={1} title="Install">
        <CopyableCodeBlock code="brew install tiddly" />
      </StepSection>

      <StepSection step={2} title="Log in">
        <CopyableCodeBlock code="tiddly login" />
        <p className="text-gray-600 mt-2 text-sm">
          Opens your browser for OAuth login. See{' '}
          <Link to="/docs/cli/authentication" className="underline hover:text-gray-900">Authentication</Link>{' '}
          for details and PAT login.
        </p>
      </StepSection>

      <StepSection step={3} title="Set up MCP">
        <p className="text-gray-600 mb-3 text-sm">
          By default, this installs both MCP servers (bookmarks/notes and prompts) for all
          detected AI tools. You can target specific tools and/or servers:
        </p>
        <CopyableCodeBlock code={`tiddly mcp install                   # both servers, all detected tools
tiddly mcp install claude-code       # specific tool only
tiddly mcp install claude-code codex # multiple tools
tiddly mcp install --servers content # bookmarks & notes server only
tiddly mcp install --servers prompts # prompts server only`} />
        <p className="text-gray-600 mt-2 text-sm">
          See{' '}
          <Link to="/docs/cli/mcp" className="underline hover:text-gray-900">MCP Setup</Link>{' '}
          for targeting specific tools, scopes, and other options.
        </p>
      </StepSection>

      {/* Sub-page cards */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Guides</h2>
      <div className="grid gap-4 sm:grid-cols-2 mb-10">
        {PAGES.map((page) => (
          <Link
            key={page.name}
            to={page.path}
            className="group rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#f09040] hover:bg-[#fff7f0]"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
                {page.name}
              </h3>
              <svg className="h-4 w-4 text-gray-400 group-hover:text-[#d97b3d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">{page.description}</p>
          </Link>
        ))}
      </div>

      {/* More Commands */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">More Commands</h2>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Skills</h3>
        <p className="text-gray-600 mb-3 text-sm">
          Export your prompt templates as agent skills for Claude Code, Codex, or Claude Desktop.
        </p>
        <CopyableCodeBlock code={`tiddly skills sync                       # auto-detect tools and sync skills
tiddly skills sync claude-code           # sync for a specific tool
tiddly skills sync --tags skill          # only sync prompts with matching tags
tiddly skills sync --scope project       # sync to project-level paths
tiddly skills list                       # list available skills
tiddly skills list --tags python         # list skills filtered by tags`} />
        <p className="text-gray-600 mt-2 text-sm">
          See{' '}
          <Link to="/docs/cli/skills" className="underline hover:text-gray-900">Skills</Link>{' '}
          for full reference.
        </p>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Tokens</h3>
        <p className="text-gray-600 mb-3 text-sm">
          Manage Personal Access Tokens for programmatic API access. Requires OAuth login (browser-based).
        </p>
        <CopyableCodeBlock code={`tiddly tokens list                       # list all tokens
tiddly tokens create "My Token"          # create a new token
tiddly tokens create "CI" --expires 90   # create with 90-day expiration
tiddly tokens delete <id>                # delete (with confirmation)
tiddly tokens delete <id> --force        # delete without confirmation`} />
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Export</h3>
        <p className="text-gray-600 mb-3 text-sm">
          Bulk export your content as JSON for backup or migration.
        </p>
        <CopyableCodeBlock code={`tiddly export                            # export all content as JSON
tiddly export --types bookmarks,notes    # export specific content types
tiddly export --output backup.json       # write to file
tiddly export --include-archived         # include archived items`} />
      </div>

      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Shell Completions</h3>
        <p className="text-gray-600 mb-3 text-sm">
          Generate shell completion scripts for tab completion of commands and flags.
        </p>
        <CopyableCodeBlock code={`source <(tiddly completion bash)          # Bash (add to ~/.bashrc)
source <(tiddly completion zsh)           # Zsh (add to ~/.zshrc)
tiddly completion fish | source           # Fish`} />
      </div>

      {/* Advanced Configuration */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Advanced Configuration</h2>
      <p className="text-gray-600 mb-3">
        For most users, the defaults work out of the box. If you need to customize the API URL or
        output format, the CLI reads configuration from{' '}
        <code className="bg-gray-100 px-1 rounded">~/.config/tiddly/config.yaml</code>{' '}
        (respects <code className="bg-gray-100 px-1 rounded">$XDG_CONFIG_HOME</code>):
      </p>
      <CopyableCodeBlock code={`api_url: https://api.tiddly.me
format: text`} />

      <p className="text-gray-600 mt-4 mb-3">
        Settings can be overridden at multiple levels. The CLI resolves values in this order
        (highest priority first):
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Priority</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Source</th>
              <th className="py-2 text-left font-semibold text-gray-900">Example</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">1 (highest)</td>
              <td className="py-2 pr-4">CLI flags</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">--api-url</code>, <code className="bg-gray-100 px-1 rounded">--format</code></td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">2</td>
              <td className="py-2 pr-4">Environment variables</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">TIDDLY_API_URL</code>, <code className="bg-gray-100 px-1 rounded">TIDDLY_FORMAT</code></td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">3</td>
              <td className="py-2 pr-4">Config file</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">~/.config/tiddly/config.yaml</code></td>
            </tr>
            <tr>
              <td className="py-2 pr-4">4 (lowest)</td>
              <td className="py-2 pr-4">Defaults</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">https://api.tiddly.me</code>, <code className="bg-gray-100 px-1 rounded">text</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
