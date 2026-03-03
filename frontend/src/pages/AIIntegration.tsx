import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { CheckIcon } from '../components/icons'

interface AIClient {
  name: string
  maker: string
  environment: string
  description: string
  capabilities: string[]
  docsPath: string
  comingSoon?: boolean
  configType?: string
  mcpPrompts?: boolean
  agentSkills?: boolean
}

const AI_CLIENTS: AIClient[] = [
  {
    name: 'Claude Desktop',
    maker: 'Anthropic',
    environment: 'Desktop',
    description: 'Search, read, and edit your bookmarks, notes, and prompts directly from chat.',
    capabilities: ['Bookmarks & notes', 'Prompt templates', 'MCP Prompts', 'Agent Skills'],
    docsPath: '/docs/ai/claude-desktop',
    configType: 'JSON',
    mcpPrompts: true,
    agentSkills: true,
  },
  {
    name: 'Claude Code',
    maker: 'Anthropic',
    environment: 'Terminal',
    description: 'CLI-first workflow — search, read, and edit content from your terminal.',
    capabilities: ['Bookmarks & notes', 'Prompt templates', 'MCP Prompts', 'Agent Skills'],
    docsPath: '/docs/ai/claude-code',
    configType: 'CLI',
    mcpPrompts: true,
    agentSkills: true,
  },
  {
    name: 'Codex',
    maker: 'OpenAI',
    environment: 'Terminal',
    description: 'Access your bookmarks, notes, and prompt templates from Codex.',
    capabilities: ['Bookmarks & notes', 'Prompt templates'],
    docsPath: '/docs/ai/codex',
    configType: 'TOML',
    mcpPrompts: false,
    agentSkills: false,
  },
  {
    name: 'ChatGPT',
    maker: 'OpenAI',
    environment: 'Cloud',
    description: 'Requires OAuth authentication, which is coming soon.',
    capabilities: [],
    docsPath: '/docs/ai/chatgpt',
    comingSoon: true,
  },
  {
    name: 'Gemini CLI',
    maker: 'Google',
    environment: 'Terminal',
    description: 'MCP integration instructions are coming soon.',
    capabilities: [],
    docsPath: '/docs/ai/gemini-cli',
    comingSoon: true,
  },
]

const comparisonRows = [
  {
    feature: 'Environment',
    claudeDesktop: 'Desktop',
    claudeCode: 'Terminal',
    codex: 'Terminal',
  },
  {
    feature: 'Config type',
    claudeDesktop: 'JSON',
    claudeCode: 'CLI',
    codex: 'TOML',
  },
  {
    feature: 'Bookmarks & notes',
    claudeDesktop: true,
    claudeCode: true,
    codex: true,
  },
  {
    feature: 'Prompt templates',
    claudeDesktop: true,
    claudeCode: true,
    codex: true,
  },
  {
    feature: 'MCP Prompts',
    claudeDesktop: true,
    claudeCode: true,
    codex: false,
  },
  {
    feature: 'Agent Skills',
    claudeDesktop: true,
    claudeCode: true,
    codex: false,
  },
]

function AIClientCard({ client }: { client: AIClient }): ReactNode {
  if (client.comingSoon) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 opacity-60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-500">{client.name}</h3>
            <p className="text-xs text-gray-400">{client.maker}</p>
          </div>
          <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
            Coming soon
          </span>
        </div>
        <p className="mt-3 text-sm text-gray-400">{client.description}</p>
      </div>
    )
  }

  return (
    <Link
      to={client.docsPath}
      className="group rounded-xl border border-gray-200 bg-white p-6 transition-colors hover:border-[#f09040] hover:bg-[#fff7f0]"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
            {client.name}
          </h3>
          <p className="text-xs text-gray-400">{client.maker}</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {client.environment}
        </span>
      </div>
      <p className="mt-3 text-sm text-gray-600">{client.description}</p>
      <ul className="mt-3 space-y-1">
        {client.capabilities.map((cap) => (
          <li key={cap} className="flex items-start gap-2 text-sm text-gray-500">
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#d97b3d]" />
            <span>{cap}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm font-medium text-[#d97b3d]">
        Set up &rarr;
      </p>
    </Link>
  )
}

function ComparisonCell({ value }: { value: string | boolean }): ReactNode {
  if (typeof value === 'boolean') {
    return value ? (
      <CheckIcon className="mx-auto h-5 w-5 text-[#d97b3d]" />
    ) : (
      <span className="text-gray-300">&mdash;</span>
    )
  }
  return <>{value}</>
}

export function AIIntegration(): ReactNode {
  usePageTitle('AI Integration')

  return (
    <div>
      {/* Hero */}
      <div className="pb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          AI Integration
        </h1>
        <p className="mt-4 text-lg text-gray-500 sm:text-xl">
          Connect AI assistants to your bookmarks, notes, and prompts via the{' '}
          <a
            href="https://modelcontextprotocol.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#d97b3d] hover:underline"
          >
            Model Context Protocol
          </a>
          {' '}and{' '}
          <Link to="/docs/features/prompts" className="text-[#d97b3d] hover:underline">
            skills
          </Link>
          .
        </p>
      </div>

      {/* Choose your AI client */}
      <section>
        <h2 className="mb-6 text-2xl font-bold text-gray-900">
          Choose your AI client
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AI_CLIENTS.map((client) => (
            <AIClientCard key={client.name} client={client} />
          ))}
        </div>
      </section>

      {/* Compare integrations */}
      <section className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="mb-6 text-2xl font-bold text-gray-900">
          Compare integrations
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-4 pr-4 text-left text-sm font-medium text-gray-500" />
                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-900">
                  Claude Desktop
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-900">
                  Claude Code
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-900">
                  Codex
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.feature} className="border-b border-gray-100">
                  <td className="py-3 pr-4 text-sm text-gray-600">{row.feature}</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">
                    <ComparisonCell value={row.claudeDesktop} />
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">
                    <ComparisonCell value={row.claudeCode} />
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">
                    <ComparisonCell value={row.codex} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <div className="mt-16 mb-4 rounded-2xl bg-gray-50 px-8 py-12 text-center">
        <h2 className="mb-3 text-2xl font-bold text-gray-900">Ready to get started?</h2>
        <p className="mb-6 text-gray-500">
          Follow our step-by-step guides to connect your preferred AI client.
        </p>
        <Link
          to="/docs/ai"
          className="inline-block rounded-full bg-gray-900 px-8 py-3 text-sm font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          View setup guides
        </Link>
      </div>
    </div>
  )
}
