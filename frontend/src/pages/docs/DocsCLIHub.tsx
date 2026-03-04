import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'

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
]

export function DocsCLIHub(): ReactNode {
  usePageTitle('Docs - CLI')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Tiddly CLI</h1>
      <p className="text-gray-600 mb-8">
        The Tiddly CLI (<code className="bg-gray-100 px-1 rounded">tiddly</code>) is a Go command-line
        tool for authenticating with the Tiddly API and configuring MCP servers for AI tools like
        Claude Desktop, Claude Code, and Codex.
      </p>

      {/* Installation */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Installation</h2>
      <p className="text-gray-600 mb-3">
        Build from source (requires Go 1.21+):
      </p>
      <CopyableCodeBlock code="git clone https://github.com/shane-kercheval/tiddly.git
cd tiddly
make cli-build    # outputs bin/tiddly" />
      <p className="text-gray-600 mt-3 mb-3">
        Or install directly with <code className="bg-gray-100 px-1 rounded">go install</code>:
      </p>
      <CopyableCodeBlock code="go install github.com/shane-kercheval/tiddly/cli@latest" />
      <p className="text-gray-600 mt-3 mb-8">
        After installation, verify with{' '}
        <code className="bg-gray-100 px-1 rounded">tiddly --help</code>.
      </p>

      {/* Configuration */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Configuration</h2>
      <p className="text-gray-600 mb-3">
        The CLI reads configuration from{' '}
        <code className="bg-gray-100 px-1 rounded">~/.config/tiddly/config.yaml</code>{' '}
        (respects <code className="bg-gray-100 px-1 rounded">$XDG_CONFIG_HOME</code>):
      </p>
      <CopyableCodeBlock code={`api_url: https://api.tiddly.me
format: text`} />

      <p className="text-gray-600 mt-4 mb-3">
        Settings can be overridden at multiple levels. The CLI resolves values in this order
        (highest priority first):
      </p>
      <div className="overflow-x-auto mb-8">
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

      {/* Sub-page cards */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Guides</h2>
      <div className="grid gap-4 sm:grid-cols-2">
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
    </div>
  )
}
