import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'

export function DocsCLIMCP(): ReactNode {
  usePageTitle('Docs - CLI MCP Setup')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">CLI MCP Setup</h1>
      <p className="text-sm text-gray-600 mb-8">
        The <code className="bg-gray-100 px-1 rounded">tiddly mcp</code> commands auto-detect
        installed AI tools and configure MCP servers with dedicated tokens. Supported tools:
        Claude Desktop, Claude Code, and Codex.
      </p>

      {/* tiddly mcp configure */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">tiddly mcp configure</h2>
      <p className="text-sm text-gray-600 mb-3">
        Installs Tiddly MCP server entries into AI tool config files. Without arguments, it
        auto-detects all installed tools and installs both servers. Use{' '}
        <code className="bg-gray-100 px-1 rounded">--servers</code> to choose which servers to install:
      </p>
      <CopyableCodeBlock code={`tiddly mcp configure                               # all tools, both servers
tiddly mcp configure --servers content              # bookmarks & notes server only
tiddly mcp configure --servers prompts              # prompts server only
tiddly mcp configure claude-code                    # specific tool, both servers
tiddly mcp configure claude-code --servers content  # specific tool + server
tiddly mcp configure claude-code codex              # multiple tools`} />

      {/* Server explanation */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Servers</h3>
      <p className="text-sm text-gray-600 mb-2">
        Tiddly exposes two MCP servers, each with its own set of tools:
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 mb-6">
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
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">tiddly mcp status</h2>
      <p className="text-sm text-gray-600 mb-3">
        Shows MCP server configuration status for each supported tool:
      </p>
      <CopyableCodeBlock code="tiddly mcp status" />
      <p className="text-sm text-gray-600 mt-3 mb-4">
        For each tool and scope, shows:
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 mb-6">
        <li><strong>Not detected</strong> — binary or config directory not found</li>
        <li><strong>Tiddly servers</strong> — lists configured Tiddly MCP servers with their URLs</li>
        <li><strong>Other servers</strong> — lists non-Tiddly MCP servers with their transport type (http/stdio)</li>
        <li><strong>No Tiddly servers configured</strong> — shows an install hint</li>
      </ul>
      <p className="text-sm text-gray-500 mb-4">
        Reads config files directly — no API calls or subprocesses.
      </p>

      {/* tiddly mcp remove */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">tiddly mcp remove</h2>
      <p className="text-sm text-gray-600 mb-3">
        Removes the CLI-managed entries ({' '}
        <code className="bg-gray-100 px-1 rounded">tiddly_notes_bookmarks</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">tiddly_prompts</code>) from a tool&apos;s
        config file. Other entries pointing at Tiddly URLs under different names (e.g.{' '}
        <code className="bg-gray-100 px-1 rounded">work_prompts</code>) are preserved.
        A CLI-managed entry is removed regardless of what URL it currently points at.
      </p>
      <CopyableCodeBlock code="tiddly mcp remove claude-code
tiddly mcp remove claude-code --delete-tokens" />

      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">--delete-tokens</h3>
      <p className="text-sm text-gray-600 mb-3">
        With <code className="bg-gray-100 px-1 rounded">--delete-tokens</code> (requires OAuth
        auth), the CLI targets PATs attached to the CLI-managed entries only. PATs attached to
        other entries are never touched.
      </p>
      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 mb-4">
        <li>Reads PATs from the CLI-managed entries before removing them</li>
        <li>Removes the CLI-managed entries from the config file</li>
        <li>Revokes matching tokens from your account (matched by prefix and{' '}
          <code className="bg-gray-100 px-1 rounded">cli-mcp-</code> name pattern)</li>
      </ol>
      <p className="text-sm text-gray-600 mb-3">
        If a CLI-managed PAT is also referenced by a preserved entry, the CLI warns that
        revoking will break the preserved binding and then proceeds. If a CLI-managed entry&apos;s
        PAT doesn&apos;t match any CLI-created server-side token, the CLI prints an informational
        note referencing that entry.
      </p>
      <p className="text-sm text-gray-600 mb-3">
        Without <code className="bg-gray-100 px-1 rounded">--delete-tokens</code>, the CLI warns
        about potentially orphaned tokens (excluding any that are still in active use by a
        preserved entry).
      </p>
      <p className="text-sm text-gray-500 mb-8">
        <strong>Note:</strong> the shared-PAT warning and orphan-token filter look only at
        entries whose URL still points at a Tiddly MCP server. If a CLI-managed key has been
        hand-edited to a non-Tiddly URL, its PAT is invisible to these safeguards.
      </p>

      {/* Reference */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Reference</h2>

      {/* Token Management */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Token Management</h3>
      <p className="text-sm text-gray-600 mb-3">
        <strong>OAuth users:</strong> The CLI creates a dedicated PAT per tool per server (e.g.,
        Claude Code gets separate tokens for the content and prompt servers). Tokens are named{' '}
        <code className="bg-gray-100 px-1 rounded">cli-mcp-&#123;tool&#125;-&#123;server&#125;-&#123;hex&#125;</code>{' '}
        (e.g., <code className="bg-gray-100 px-1 rounded">cli-mcp-claude-code-content-a1b2c3</code>).
      </p>
      <p className="text-sm text-gray-600 mb-3">
        <strong>Re-installs</strong> are safe — the CLI reads existing PATs from config files, validates
        them, and only creates new tokens when needed.
      </p>
      <p className="text-sm text-gray-600 mb-4">
        <strong>PAT users:</strong> The CLI reuses your login PAT for both servers since it cannot
        create new tokens via the API when authenticated with a PAT. A warning is displayed.
      </p>

      {/* CLI-managed entries */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">CLI-managed entries</h3>
      <p className="text-sm text-gray-600 mb-3">
        The CLI creates and manages exactly two entries per tool:{' '}
        <code className="bg-gray-100 px-1 rounded">tiddly_notes_bookmarks</code> (content server)
        and <code className="bg-gray-100 px-1 rounded">tiddly_prompts</code> (prompt server).
        These are the only entries <code className="bg-gray-100 px-1 rounded">configure</code>{' '}
        and <code className="bg-gray-100 px-1 rounded">remove</code> will ever touch.
      </p>
      <p className="text-sm text-gray-600 mb-3">
        On <strong>configure</strong>, any other entry pointing at a Tiddly URL under a different
        key name (e.g. a <code className="bg-gray-100 px-1 rounded">work_prompts</code> entry you
        set up for a second account) is left alone. The summary at the end of a run lists preserved
        non-CLI-managed entries so you can see what was left unchanged.
      </p>
      <p className="text-sm text-gray-600 mb-3">
        <strong>Mismatch safety.</strong> If a CLI-managed key already exists but points at a URL
        that&apos;s not the expected Tiddly URL for its type (e.g. someone hand-edited the entry to
        a local dev fork), <code className="bg-gray-100 px-1 rounded">configure</code> refuses by
        default and names the offending entry. Either rename it in the config file to preserve
        your custom setup, or re-run with{' '}
        <code className="bg-gray-100 px-1 rounded">--force</code> to overwrite. Dry-run previews
        either path without committing.
      </p>
      <p className="text-sm text-gray-600 mb-4">
        On <strong>remove</strong>, the CLI-managed entries are deleted by key name regardless of
        the URL they currently point at. Other entries — including custom-named entries at Tiddly
        URLs — are preserved. The prior config is saved to{' '}
        <code className="bg-gray-100 px-1 rounded">&lt;path&gt;.bak.&lt;timestamp&gt;</code> before
        any write.
      </p>

      {/* FAQ: multiple entries */}
      <InfoCallout variant="info" title="I have multiple Tiddly entries — what happens on configure?">
        <p>
          Multi-account setups are supported. If you already have entries like{' '}
          <code className="bg-blue-100 px-1 rounded">work_prompts</code> and{' '}
          <code className="bg-blue-100 px-1 rounded">personal_prompts</code> pointing at the Tiddly
          prompts server with distinct PATs,{' '}
          <code className="bg-blue-100 px-1 rounded">tiddly mcp configure</code> adds the
          CLI-managed <code className="bg-blue-100 px-1 rounded">tiddly_prompts</code> entry
          alongside them. Your custom entries keep their PATs and stay bound to the accounts
          they&apos;re already using.
        </p>
      </InfoCallout>

      {/* Tool Detection */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Tool Detection</h3>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Tool</th>
              <th className="py-2 text-left font-semibold text-gray-900">Detection Method</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
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
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Config Files Written</h3>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Tool</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Config File</th>
              <th className="py-2 text-left font-semibold text-gray-900">Format</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
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
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Scopes</h3>
      <p className="text-sm text-gray-600 mb-3">
        Use <code className="bg-gray-100 px-1 rounded">--scope</code> to control which config
        level is written. Support varies by tool:
      </p>
      <ul className="list-disc list-inside space-y-2 text-sm text-gray-600 mb-4">
        <li>
          <strong>user</strong> (default) — available everywhere for the user. Stored in your home directory.
        </li>
        <li>
          <strong>directory</strong> — configuration only applies when running tools from a specific directory.
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
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">user</code> (default)</td>
              <td className="py-2 pr-4">Global config</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.claude.json</code> top-level</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded text-xs">~/.codex/config.toml</code></td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">directory</code></td>
              <td className="py-2 pr-4 text-gray-400">Not supported</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.claude.json</code> under project key</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded text-xs">.codex/config.toml</code> in cwd</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* All Flags */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">All Flags</h3>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Flag</th>
              <th className="py-2 text-left font-semibold text-gray-900">Description</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--servers content,prompts</code></td>
              <td className="py-2">Install only specific servers (default: both)</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--scope user|directory</code></td>
              <td className="py-2">Config scope (default: user)</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--dry-run</code></td>
              <td className="py-2">Preview config changes without writing files or creating tokens</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--force</code></td>
              <td className="py-2">Overwrite a CLI-managed entry that currently points at a non-Tiddly URL or the wrong-type Tiddly URL</td>
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
          Prefer configuring MCP servers manually? See the{' '}
          <Link to="/docs/ai" className="underline hover:text-gray-900">AI Integration</Link>{' '}
          docs for step-by-step guides.
        </p>
      </InfoCallout>
    </div>
  )
}
