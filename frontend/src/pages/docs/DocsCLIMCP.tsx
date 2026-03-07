import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'

export function DocsCLIMCP(): ReactNode {
  usePageTitle('Docs - CLI MCP Setup')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">CLI MCP Setup</h1>
      <p className="text-gray-600 mb-8">
        The <code className="bg-gray-100 px-1 rounded">tiddly mcp</code> commands auto-detect
        installed AI tools and configure MCP servers with dedicated tokens. Supported tools:
        Claude Desktop, Claude Code, and Codex.
      </p>

      {/* tiddly mcp install */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">tiddly mcp install</h2>
      <p className="text-gray-600 mb-3">
        Installs Tiddly MCP server entries into AI tool config files. Without arguments, it
        auto-detects all installed tools and installs both servers. Use{' '}
        <code className="bg-gray-100 px-1 rounded">--servers</code> to choose which servers to install:
      </p>
      <CopyableCodeBlock code={`tiddly mcp install                               # all tools, both servers
tiddly mcp install --servers content              # bookmarks & notes server only
tiddly mcp install --servers prompts              # prompts server only
tiddly mcp install claude-code                    # specific tool, both servers
tiddly mcp install claude-code --servers content  # specific tool + server
tiddly mcp install claude-code codex              # multiple tools`} />

      {/* Server explanation */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Servers</h3>
      <p className="text-gray-600 mb-2">
        Tiddly exposes two MCP servers, each with its own set of tools:
      </p>
      <ul className="list-disc list-inside space-y-1 text-gray-600 mb-6">
        <li>
          <code className="bg-gray-100 px-1 rounded">tiddly_notes_bookmarks</code> (content server) —
          search, create, and edit bookmarks and notes
        </li>
        <li>
          <code className="bg-gray-100 px-1 rounded">tiddly_prompts</code> (prompt server) —
          manage and render Jinja2 prompt templates
        </li>
      </ul>

      <InfoCallout variant="info" title="Codex and Prompts">
        <p>
          Codex does not support MCP Prompts natively (the{' '}
          <code className="bg-blue-100 px-1 rounded">/prompt-name</code> invocation available in
          Claude Code). However, the prompt server still provides MCP <em>tools</em> for searching
          and retrieving prompts, so you can ask Codex to fetch and apply a prompt by name. For
          Codex-native prompt invocation, export your prompts as{' '}
          <Link to="/docs/cli/skills" className="underline hover:text-gray-900">Codex Skills</Link>.
        </p>
      </InfoCallout>

      {/* tiddly mcp status */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">tiddly mcp status</h2>
      <p className="text-gray-600 mb-3">
        Shows MCP server configuration status for each supported tool:
      </p>
      <CopyableCodeBlock code="tiddly mcp status" />
      <p className="text-gray-600 mt-3 mb-4">
        For each tool and scope, shows:
      </p>
      <ul className="list-disc list-inside space-y-1 text-gray-600 mb-6">
        <li><strong>Not detected</strong> — binary or config directory not found</li>
        <li><strong>Tiddly servers</strong> — lists configured Tiddly MCP servers with their URLs</li>
        <li><strong>Other servers</strong> — lists non-Tiddly MCP servers with their transport type (http/stdio)</li>
        <li><strong>No Tiddly servers configured</strong> — shows an install hint</li>
      </ul>
      <p className="text-sm text-gray-500 mb-4">
        Reads config files directly — no API calls or subprocesses.
      </p>

      {/* tiddly mcp uninstall */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">tiddly mcp uninstall</h2>
      <p className="text-gray-600 mb-3">
        Removes MCP server entries from a tool&apos;s config file. All other config keys are preserved.
      </p>
      <CopyableCodeBlock code="tiddly mcp uninstall claude-code
tiddly mcp uninstall claude-code --delete-tokens" />

      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">--delete-tokens</h3>
      <p className="text-gray-600 mb-3">
        With <code className="bg-gray-100 px-1 rounded">--delete-tokens</code> (requires OAuth
        auth), the CLI:
      </p>
      <ol className="list-decimal list-inside space-y-1 text-gray-600 mb-4">
        <li>Reads PATs from the tool&apos;s config before removing server entries</li>
        <li>Removes the server entries from the config file</li>
        <li>Deletes matching tokens from your account (matched by prefix and{' '}
          <code className="bg-gray-100 px-1 rounded">cli-mcp-</code> name pattern)</li>
      </ol>
      <p className="text-gray-600 mb-8">
        Without <code className="bg-gray-100 px-1 rounded">--delete-tokens</code>, the CLI warns
        about potentially orphaned tokens and suggests cleanup options.
      </p>

      {/* Reference */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">Reference</h2>

      {/* Token Management */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Token Management</h3>
      <p className="text-gray-600 mb-3">
        <strong>OAuth users:</strong> The CLI creates a dedicated PAT per tool per server (e.g.,
        Claude Code gets separate tokens for the content and prompt servers). Tokens are named{' '}
        <code className="bg-gray-100 px-1 rounded">cli-mcp-&#123;tool&#125;-&#123;server&#125;-&#123;hex&#125;</code>{' '}
        (e.g., <code className="bg-gray-100 px-1 rounded">cli-mcp-claude-code-content-a1b2c3</code>).
      </p>
      <p className="text-gray-600 mb-3">
        <strong>Re-installs</strong> are safe — the CLI reads existing PATs from config files, validates
        them, and only creates new tokens when needed.
      </p>
      <p className="text-gray-600 mb-4">
        <strong>PAT users:</strong> The CLI reuses your login PAT for both servers since it cannot
        create new tokens via the API when authenticated with a PAT. A warning is displayed.
      </p>

      {/* Server Identification */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Server Identification</h3>
      <p className="text-gray-600 mb-3">
        The CLI identifies Tiddly MCP servers by <strong>URL</strong>, not by config key name.
        Any entry whose URL points to a Tiddly MCP host is recognized, regardless of its key name.
        This applies to all operations: <code className="bg-gray-100 px-1 rounded">install</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">uninstall</code>, and{' '}
        <code className="bg-gray-100 px-1 rounded">status</code>.
      </p>
      <p className="text-gray-600 mb-3">
        On <strong>install</strong>, existing entries pointing to Tiddly URLs are replaced with
        the canonical names (<code className="bg-gray-100 px-1 rounded">tiddly_notes_bookmarks</code>{' '}
        and <code className="bg-gray-100 px-1 rounded">tiddly_prompts</code>). This makes re-installs
        and migrations from manual setups safe.
      </p>
      <p className="text-gray-600 mb-4">
        On <strong>uninstall</strong>, any entry pointing to a Tiddly URL is removed, even if it
        was created manually with a different name.
      </p>

      {/* Tool Detection */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Tool Detection</h3>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Tool</th>
              <th className="py-2 text-left font-semibold text-gray-900">Detection Method</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">Claude Desktop</td>
              <td className="py-2">Config directory exists + <code className="bg-gray-100 px-1 rounded">npx</code> in PATH</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">Claude Code</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">claude</code> binary in PATH</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Codex</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">codex</code> binary in PATH or <code className="bg-gray-100 px-1 rounded">~/.codex/</code> exists</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Config Files */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Config Files Written</h3>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Tool</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Config File</th>
              <th className="py-2 text-left font-semibold text-gray-900">Format</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">Claude Desktop</td>
              <td className="py-2 pr-4">
                <code className="bg-gray-100 px-1 rounded text-xs">~/Library/Application Support/Claude/claude_desktop_config.json</code>{' '}<span className="text-gray-400 text-xs">(macOS)</span>
                <br />
                <code className="bg-gray-100 px-1 rounded text-xs">%APPDATA%\Claude\claude_desktop_config.json</code>{' '}<span className="text-gray-400 text-xs">(Windows)</span>
                <br />
                <code className="bg-gray-100 px-1 rounded text-xs">~/.config/Claude/claude_desktop_config.json</code>{' '}<span className="text-gray-400 text-xs">(Linux)</span>
              </td>
              <td className="py-2">JSON</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">Claude Code</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.claude.json</code></td>
              <td className="py-2">JSON</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Codex</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.codex/config.toml</code></td>
              <td className="py-2">TOML</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Config files are written atomically (write-to-temp + rename). Existing config keys and server
        entries are preserved. Malformed files are backed up to{' '}
        <code className="bg-gray-100 px-1 rounded">.bak</code> before overwriting.
      </p>

      {/* Scopes */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Scopes</h3>
      <p className="text-gray-600 mb-3">
        Use <code className="bg-gray-100 px-1 rounded">--scope</code> to control which config
        level is written. Support varies by tool:
      </p>
      <ul className="list-disc list-inside space-y-2 text-gray-600 mb-4">
        <li>
          <strong>user</strong> — applies globally to all projects. Stored in your home directory.
        </li>
        <li>
          <strong>local</strong> (Claude Code only) — scoped to a specific project but stored in
          your home directory (<code className="bg-gray-100 px-1 rounded text-xs">~/.claude.json</code> under
          a project key). Not committed to the repo — useful for private config you don&apos;t want
          to share with collaborators.
        </li>
        <li>
          <strong>project</strong> — scoped to the project and stored in the project directory
          itself. Can be committed and shared with collaborators.
        </li>
      </ul>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Scope</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Claude Desktop</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Claude Code</th>
              <th className="py-2 text-left font-semibold text-gray-900">Codex</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">user</code> (default)</td>
              <td className="py-2 pr-4">Global config</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.claude.json</code> top-level</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded text-xs">~/.codex/config.toml</code></td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">local</code></td>
              <td className="py-2 pr-4 text-gray-400">N/A</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.claude.json</code> under project key</td>
              <td className="py-2 text-gray-400">N/A</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">project</code></td>
              <td className="py-2 pr-4 text-gray-400">N/A</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">.mcp.json</code> in cwd</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded text-xs">.codex/config.toml</code> in cwd</td>
            </tr>
          </tbody>
        </table>
      </div>

      <InfoCallout variant="info" title="Default Scope vs Claude Code">
        <p>
          Tiddly defaults to <code className="bg-blue-100 px-1 rounded">user</code> scope so your
          MCP servers are available across all projects without re-installing per project.
          Claude Code&apos;s own <code className="bg-blue-100 px-1 rounded">claude mcp add</code> command
          defaults to <code className="bg-blue-100 px-1 rounded">local</code> scope (per-project).
          If you prefer per-project configuration, use{' '}
          <code className="bg-blue-100 px-1 rounded">--scope local</code>.
        </p>
      </InfoCallout>

      {/* All Flags */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">All Flags</h3>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Flag</th>
              <th className="py-2 text-left font-semibold text-gray-900">Description</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--servers content,prompts</code></td>
              <td className="py-2">Install only specific servers (default: both)</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--scope user|local|project</code></td>
              <td className="py-2">Config level to write (default: user)</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--dry-run</code></td>
              <td className="py-2">Preview config changes without writing files or creating tokens</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--expires</code></td>
              <td className="py-2">PAT expiration in days (1-365, or 0 for no expiration)</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cross-link to AI Integration */}
      <InfoCallout variant="tip" title="Manual Setup">
        <p>
          Prefer configuring MCP servers manually? See the step-by-step guides for{' '}
          <Link to="/docs/ai/claude-desktop" className="underline hover:text-gray-900">Claude Desktop</Link>,{' '}
          <Link to="/docs/ai/claude-code" className="underline hover:text-gray-900">Claude Code</Link>, and{' '}
          <Link to="/docs/ai/codex" className="underline hover:text-gray-900">Codex</Link>.
        </p>
      </InfoCallout>
    </div>
  )
}
