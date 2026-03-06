import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'

export function DocsCLIAuth(): ReactNode {
  usePageTitle('Docs - CLI Authentication')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">CLI Authentication</h1>
      <p className="text-gray-600 mb-8">
        The Tiddly CLI supports two authentication methods: OAuth device flow (interactive) and
        Personal Access Token (non-interactive). Credentials are stored securely in the system
        keyring with an automatic file fallback.
      </p>

      {/* tiddly login */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">tiddly login</h2>
      <p className="text-gray-600 mb-3">
        Authenticates with the Tiddly API and stores credentials locally.
      </p>

      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">OAuth Login (default)</h3>
      <p className="text-gray-600 mb-3">
        Running <code className="bg-gray-100 px-1 rounded">tiddly login</code> without flags
        starts an OAuth device code flow:
      </p>
      <CopyableCodeBlock code="tiddly login" />
      <ol className="list-decimal list-inside space-y-2 text-gray-600 mt-3 mb-4">
        <li>The CLI prints a URL and a one-time code for you to enter in your browser.</li>
        <li>After you authorize in the browser, the CLI stores both the access token and refresh token.</li>
        <li>The CLI verifies the token by calling the API and displays your account email.</li>
      </ol>

      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">PAT Login</h3>
      <p className="text-gray-600 mb-3">
        To authenticate with a Personal Access Token (useful for CI/CD or headless environments):
      </p>
      <CopyableCodeBlock code="tiddly login --token bm_your_token_here" />
      <ol className="list-decimal list-inside space-y-2 text-gray-600 mt-3 mb-4">
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

      {/* tiddly logout */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">tiddly logout</h2>
      <p className="text-gray-600 mb-3">
        Removes all stored credentials (PAT, OAuth access token, and OAuth refresh token) from the
        keyring or file store:
      </p>
      <CopyableCodeBlock code="tiddly logout" />

      {/* tiddly auth status */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">tiddly auth status</h2>
      <p className="text-gray-600 mb-3">
        Displays the current authentication method, API URL, and user email. Read-only — does not
        modify any files.
      </p>
      <CopyableCodeBlock code="tiddly auth status" />
      <p className="text-gray-600 mt-3 mb-4">
        Shows the active auth type (<code className="bg-gray-100 px-1 rounded">pat</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">oauth</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">flag</code>, or{' '}
        <code className="bg-gray-100 px-1 rounded">env</code>) and calls the API to display your
        account information.
      </p>

      {/* tiddly status */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">tiddly status</h2>
      <p className="text-gray-600 mb-3">
        Shows a full overview of your CLI setup. Read-only — no files are modified.
      </p>
      <CopyableCodeBlock code="tiddly status" />
      <p className="text-gray-600 mt-3 mb-4">
        Displays:
      </p>
      <ul className="list-disc list-inside space-y-1 text-gray-600 mb-6">
        <li>CLI version</li>
        <li>Authentication status and method</li>
        <li>API health and latency</li>
        <li>Content counts (bookmarks, notes, prompts — fetched in parallel)</li>
        <li>MCP server status for each detected AI tool</li>
      </ul>

      {/* Credential Storage */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">Credential Storage</h2>
      <p className="text-gray-600 mb-3">
        Credentials are stored in the system keyring (macOS Keychain, Windows Credential Manager,
        Linux Secret Service) under the service name{' '}
        <code className="bg-gray-100 px-1 rounded">tiddly-cli</code>.
      </p>

      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">File Fallback</h3>
      <p className="text-gray-600 mb-3">
        When the system keyring is unavailable, credentials are stored in{' '}
        <code className="bg-gray-100 px-1 rounded">~/.config/tiddly/credentials</code> (mode 0600,
        owner-only read/write). The file fallback is used when:
      </p>
      <ul className="list-disc list-inside space-y-1 text-gray-600 mb-4">
        <li>No desktop session (<code className="bg-gray-100 px-1 rounded">DISPLAY</code>/<code className="bg-gray-100 px-1 rounded">WAYLAND_DISPLAY</code> unset on Linux)</li>
        <li>Keyring hangs (3-second timeout)</li>
        <li><code className="bg-gray-100 px-1 rounded">--keyring=file</code> flag is passed</li>
      </ul>

      {/* Token Resolution */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">Token Resolution</h2>
      <p className="text-gray-600 mb-3">
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
          <tbody className="text-gray-600">
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
    </div>
  )
}
