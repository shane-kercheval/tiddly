import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { ExamplePrompts } from './components/ExamplePrompts'

interface ClientCard {
  name: string
  description: string
  path: string
  comingSoon?: boolean
}

const AI_CLIENTS: ClientCard[] = [
  {
    name: 'Claude Desktop',
    description: 'JSON config file — add both MCP servers to your Claude Desktop configuration.',
    path: '/docs/ai/claude-desktop',
  },
  {
    name: 'Claude Code',
    description: 'CLI command — add MCP servers with a single terminal command per project.',
    path: '/docs/ai/claude-code',
  },
  {
    name: 'Codex',
    description: 'TOML config — add both MCP servers to your Codex configuration file.',
    path: '/docs/ai/codex',
  },
  {
    name: 'ChatGPT',
    description: 'Requires OAuth authentication, which is coming soon.',
    path: '/docs/ai/chatgpt',
    comingSoon: true,
  },
  {
    name: 'Gemini CLI',
    description: 'MCP integration instructions are coming soon.',
    path: '/docs/ai/gemini-cli',
    comingSoon: true,
  },
]

export function DocsAIHub(): ReactNode {
  usePageTitle('Docs - AI Integration')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">AI Integration</h1>

      <p className="text-gray-600 mb-4">
        Connect AI assistants to your bookmarks, notes, and prompts using the{' '}
        <a
          href="https://modelcontextprotocol.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#d97b3d] hover:underline"
        >
          Model Context Protocol (MCP)
        </a>
        . Tiddly provides two MCP servers:
      </p>
      <ul className="text-gray-600 mb-4 list-disc list-inside space-y-1">
        <li><strong>Content Server</strong> — search and manage your bookmarks and notes</li>
        <li><strong>Prompt Server</strong> — search, view, and edit your prompt templates</li>
      </ul>
      <p className="text-gray-600 mb-8">
        You can also export your prompts as <strong>Agent Skills</strong> — reusable instruction
        files that AI assistants can auto-invoke based on context.
      </p>

      <h2 className="text-xl font-bold text-gray-900 mb-4">Choose Your Client</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {AI_CLIENTS.map((client) =>
          client.comingSoon ? (
            <div
              key={client.name}
              className="rounded-lg border border-gray-200 bg-gray-50 p-5 opacity-60"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-500">{client.name}</h3>
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-gray-400">{client.description}</p>
            </div>
          ) : (
            <Link
              key={client.name}
              to={client.path}
              className="group rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#f09040] hover:bg-[#fff7f0]"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
                  {client.name}
                </h3>
                <svg className="h-4 w-4 text-gray-400 group-hover:text-[#d97b3d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">{client.description}</p>
            </Link>
          )
        )}
      </div>

      <div className="mt-8">
        <Link
          to="/docs/ai/mcp-tools"
          className="text-sm text-[#d97b3d] hover:underline"
        >
          See all available MCP tools &rarr;
        </Link>
      </div>

      <ExamplePrompts />
    </div>
  )
}
