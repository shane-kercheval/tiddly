import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'

export function DocsCLIReference(): ReactNode {
  usePageTitle('Docs - CLI Reference')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">CLI Reference</h1>
      <p className="text-sm text-gray-600 mb-8">
        Authentication, tokens, export, configuration, and other CLI commands.
      </p>

      {/* Authentication */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">Authentication</h2>

      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">tiddly login</h3>
      <p className="text-sm text-gray-600 mb-3">
        Authenticates with the Tiddly API and stores credentials locally.
      </p>

      <h4 className="font-semibold text-gray-900 mt-4 mb-2">OAuth Login (default)</h4>
      <p className="text-sm text-gray-600 mb-3">
        Running <code className="bg-gray-100 px-1 rounded">tiddly login</code> without flags
        starts an OAuth device code flow:
      </p>
      <CopyableCodeBlock code="tiddly login" />
      <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 mt-3 mb-4">
        <li>The CLI prints a URL and a one-time code for you to enter in your browser.</li>
        <li>After you authorize in the browser, the CLI stores both the access token and refresh token.</li>
        <li>The CLI verifies the token by calling the API and displays your account email.</li>
      </ol>

      <h4 className="font-semibold text-gray-900 mt-4 mb-2">PAT Login</h4>
      <p className="text-sm text-gray-600 mb-3">
        To authenticate with a Personal Access Token (useful for CI/CD or headless environments):
      </p>
      <CopyableCodeBlock code="tiddly login --token bm_your_token_here" />
      <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 mt-3 mb-4">
        <li>The CLI validates the <code className="bg-gray-100 px-1 rounded">bm_</code> prefix.</li>
        <li>Verifies the token against the API.</li>
        <li>Stores the PAT in the system keyring (or file fallback).</li>
      </ol>

      <InfoCallout variant="tip" title="Generate a PAT">
        <p>
          Create a Personal Access Token in{' '}
          <a href="/app/settings/tokens" className="underline hover:text-gray-900">Settings &gt; Personal Access Tokens</a>{' '}
          on tiddly.me.
        </p>
      </InfoCallout>

      <h3 className="text-base font-semibold text-gray-900 mt-8 mb-3">tiddly logout</h3>
      <p className="text-sm text-gray-600 mb-3">
        Removes all stored credentials (PAT, OAuth access token, and OAuth refresh token) from the
        keyring or file store:
      </p>
      <CopyableCodeBlock code="tiddly logout" />

      <h3 className="text-base font-semibold text-gray-900 mt-8 mb-3">tiddly auth status</h3>
      <p className="text-sm text-gray-600 mb-3">
        Displays the current authentication method, API URL, and user email. Read-only — does not
        modify any files.
      </p>
      <CopyableCodeBlock code="tiddly auth status" />
      <p className="text-sm text-gray-600 mt-3 mb-4">
        Shows the active auth type (<code className="bg-gray-100 px-1 rounded">pat</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">oauth</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">flag</code>, or{' '}
        <code className="bg-gray-100 px-1 rounded">env</code>) and calls the API to display your
        account information.
      </p>

      <h3 className="text-base font-semibold text-gray-900 mt-8 mb-3">tiddly status</h3>
      <p className="text-sm text-gray-600 mb-3">
        Shows a full overview of your CLI setup. Read-only — no files are modified.
      </p>
      <CopyableCodeBlock code="tiddly status" />
      <p className="text-sm text-gray-600 mt-3 mb-3">
        Displays:
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 mb-3">
        <li>CLI version</li>
        <li>Authentication status and method</li>
        <li>API health and latency</li>
        <li>Content counts (bookmarks, notes, prompts — fetched in parallel)</li>
        <li>MCP server status for each detected AI tool across all scopes (user, local, project)</li>
        <li>Installed skills across all tools and scopes</li>
      </ul>
      <p className="text-sm text-gray-600 mb-3">
        Use <code className="bg-gray-100 px-1 rounded">--project-path</code> to specify which
        project directory to inspect for local/project scopes. Defaults to the current working
        directory.
      </p>
      <CopyableCodeBlock code="tiddly status --project-path /path/to/project" />

      {/* Credential Storage */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Credential Storage</h2>
      <p className="text-sm text-gray-600 mb-3">
        Credentials are stored in the system keyring (macOS Keychain, Windows Credential Manager,
        Linux Secret Service) under the service name{' '}
        <code className="bg-gray-100 px-1 rounded">tiddly-cli</code>.
      </p>

      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">File Fallback</h3>
      <p className="text-sm text-gray-600 mb-3">
        When the system keyring is unavailable, credentials are stored in{' '}
        <code className="bg-gray-100 px-1 rounded">~/.config/tiddly/credentials</code> (mode 0600,
        owner-only read/write). You may see this warning:
      </p>
      <CopyableCodeBlock code="Warning: System keyring unavailable. Credentials stored in plaintext at ~/.config/tiddly/credentials" />
      <p className="text-sm text-gray-600 mt-3 mb-3">
        This is common in VMs, containers, WSL, and SSH sessions where the keyring is not unlocked
        by a graphical login. It is safe to ignore — the file store uses restricted permissions.
        To suppress the warning, pass{' '}
        <code className="bg-gray-100 px-1 rounded">--keyring=file</code> to explicitly choose file storage.</p>

      {/* Token Resolution */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Token Resolution</h2>
      <p className="text-sm text-gray-600 mb-3">
        When a command needs a token, the CLI checks these sources in order:
      </p>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Priority</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Source</th>
              <th className="py-2 text-left font-semibold text-gray-900">Details</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">1</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--token</code> flag</td>
              <td className="py-2">Explicit token passed on the command line</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">2</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">TIDDLY_TOKEN</code> env var</td>
              <td className="py-2">Environment variable</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">3</td>
              <td className="py-2 pr-4">Stored PAT</td>
              <td className="py-2">From keyring or file fallback</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">4</td>
              <td className="py-2 pr-4">Stored OAuth JWT</td>
              <td className="py-2">Auto-refreshed if expired</td>
            </tr>
          </tbody>
        </table>
      </div>

      <InfoCallout variant="info">
        Commands that require Auth0-only endpoints (e.g., token management) swap steps 3 and 4,
        preferring the OAuth JWT over a stored PAT.
      </InfoCallout>

      {/* Tokens */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Tokens</h2>
      <p className="text-sm text-gray-600 mb-3">
        Manage Personal Access Tokens for programmatic API access. Requires OAuth login (browser-based).
      </p>
      <CopyableCodeBlock code={`tiddly tokens list                       # list all tokens
tiddly tokens create "My Token"          # create a new token
tiddly tokens create "CI" --expires 90   # create with 90-day expiration
tiddly tokens delete <id>                # delete (with confirmation)
tiddly tokens delete <id> --force        # delete without confirmation`} />

      {/* Export */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Export</h2>
      <p className="text-sm text-gray-600 mb-3">
        Bulk export your content as JSON for backup or migration.
      </p>
      <CopyableCodeBlock code={`tiddly export                            # export all content as JSON
tiddly export --types bookmark,note      # export specific content types
tiddly export --output backup.json       # write to file
tiddly export --include-archived         # include archived items`} />

      {/* Config */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Config</h2>
      <p className="text-sm text-gray-600 mb-3">
        View and modify CLI configuration. Settings can also be set via environment variables
        (<code className="bg-gray-100 px-1 rounded">TIDDLY_API_URL</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">TIDDLY_UPDATE_CHECK</code>).
      </p>
      <CopyableCodeBlock code={`tiddly config list                       # show all config values
tiddly config get api_url                # get a specific value
tiddly config set api_url http://...     # set a value
tiddly config set update_check false     # disable auto-update checks`} />

      <p className="text-sm text-gray-600 mt-6 mb-3">
        The CLI reads configuration from{' '}
        <code className="bg-gray-100 px-1 rounded">~/.config/tiddly/config.yaml</code>{' '}
        (respects <code className="bg-gray-100 px-1 rounded">$XDG_CONFIG_HOME</code>):
      </p>
      <CopyableCodeBlock code={`api_url: https://api.tiddly.me
update_check: true`} />

      <p className="text-sm text-gray-600 mt-4 mb-3">
        Settings can be overridden at multiple levels. The CLI resolves values in this order
        (highest priority first):
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Priority</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Source</th>
              <th className="py-2 text-left font-semibold text-gray-900">Example</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">1 (highest)</td>
              <td className="py-2 pr-4">CLI flags</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">--api-url</code>, <code className="bg-gray-100 px-1 rounded">--token</code></td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">2</td>
              <td className="py-2 pr-4">Environment variables</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">TIDDLY_API_URL</code>, <code className="bg-gray-100 px-1 rounded">TIDDLY_UPDATE_CHECK</code></td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">3</td>
              <td className="py-2 pr-4">Config file</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">~/.config/tiddly/config.yaml</code></td>
            </tr>
            <tr>
              <td className="py-2 pr-4">4 (lowest)</td>
              <td className="py-2 pr-4">Defaults</td>
              <td className="py-2"><code className="bg-gray-100 px-1 rounded">https://api.tiddly.me</code>, <code className="bg-gray-100 px-1 rounded">true</code></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Shell Completions */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Shell Completions</h2>
      <p className="text-sm text-gray-600 mb-3">
        Generate shell completion scripts for tab completion of commands and flags.
      </p>
      <CopyableCodeBlock code={`source <(tiddly completion bash)          # Bash (add to ~/.bashrc)
source <(tiddly completion zsh)           # Zsh (add to ~/.zshrc)
tiddly completion fish | source           # Fish`} />
    </div>
  )
}
