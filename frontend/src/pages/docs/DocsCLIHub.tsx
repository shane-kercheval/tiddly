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
        <CopyableCodeBlock code="curl -fsSL https://raw.githubusercontent.com/shane-kercheval/tiddly/main/cli/install.sh | sh" />
        <p className="text-gray-600 mt-2 text-sm">
          To update later, run <code className="bg-gray-100 px-1 rounded">tiddly upgrade</code>.
        </p>
      </StepSection>

      <StepSection step={2} title="Log in">
        <CopyableCodeBlock code="tiddly login" />
        <p className="text-gray-600 mt-2 text-sm">
          Opens your browser for OAuth login. See{' '}
          <Link to="/docs/cli/reference" className="underline hover:text-gray-900">Reference</Link>{' '}
          for details and PAT login.
        </p>
      </StepSection>

      <StepSection step={3} title="Set up MCP">
        <p className="text-gray-600 mb-3 text-sm">
          By default, the configure command configures both MCP servers (bookmarks/notes and prompts) for all
          detected AI tools. You can target specific tools and/or servers:
        </p>
        <CopyableCodeBlock code={`tiddly mcp configure                   # both servers, all detected tools
tiddly mcp configure claude-code       # specific tool only
tiddly mcp configure claude-code codex # multiple tools
tiddly mcp configure --servers content # bookmarks & notes server only
tiddly mcp configure --servers prompts # prompts server only`} />
        <p className="text-gray-600 mt-2 text-sm">
          See{' '}
          <Link to="/docs/cli/mcp" className="underline hover:text-gray-900">MCP Setup</Link>{' '}
          for targeting specific tools, scopes, and other options.
        </p>
      </StepSection>

      <StepSection step={4} title="Install Skills">
        <p className="text-gray-600 mb-3 text-sm">
          Export your prompt templates as agent skills. Without arguments, the configure command
          auto-detects installed AI tools and installs prompts tagged &quot;skill&quot;:
        </p>
        <CopyableCodeBlock code={`tiddly skills configure                   # auto-detect tools, configure "skill"-tagged prompts
tiddly skills configure claude-code       # configure for a specific tool
tiddly skills configure --tags ""         # configure all prompts (no tag filter)`} />
        <p className="text-gray-600 mt-2 text-sm">
          See{' '}
          <Link to="/docs/cli/skills" className="underline hover:text-gray-900">Skills</Link>{' '}
          for tag filtering, scopes, and other options.
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

      <p className="text-gray-600 text-sm">
        For tokens, export, config, and other commands, see{' '}
        <Link to="/docs/cli/reference" className="underline hover:text-gray-900">Reference</Link>.
      </p>
    </div>
  )
}
