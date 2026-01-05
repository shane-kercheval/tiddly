/**
 * Settings page for MCP (Model Context Protocol) setup instructions.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../../config'

const CONFIG_PATH_MAC = '~/Library/Application\\ Support/Claude/claude_desktop_config.json'
const CONFIG_PATH_WINDOWS = '%APPDATA%\\Claude\\claude_desktop_config.json'

interface McpServerConfig {
  command: string
  args: string[]
}

/**
 * Generate the Claude Desktop config JSON based on enabled servers.
 */
function generateConfig(options: {
  enableBookmarks: boolean
  enablePrompts: boolean
  mcpUrl: string
  promptMcpUrl: string
  useSeparateTokens: boolean
}): string {
  const servers: Record<string, McpServerConfig> = {}

  if (options.enableBookmarks) {
    servers.bookmarks_notes = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${options.mcpUrl}/mcp`,
        '--header',
        `Authorization: Bearer ${options.useSeparateTokens && options.enablePrompts ? 'YOUR_BOOKMARKS_TOKEN' : 'YOUR_TOKEN_HERE'}`,
      ],
    }
  }

  if (options.enablePrompts) {
    servers.prompts = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${options.promptMcpUrl}/mcp`,
        '--header',
        `Authorization: Bearer ${options.useSeparateTokens && options.enableBookmarks ? 'YOUR_PROMPTS_TOKEN' : 'YOUR_TOKEN_HERE'}`,
      ],
    }
  }

  const configObj = { mcpServers: servers }
  return JSON.stringify(configObj, null, 2)
}

/**
 * MCP setup instructions settings page.
 */
export function SettingsMCP(): ReactNode {
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [copiedPathMac, setCopiedPathMac] = useState(false)
  const [copiedPathWin, setCopiedPathWin] = useState(false)
  const [enableBookmarks, setEnableBookmarks] = useState(true)
  const [enablePrompts, setEnablePrompts] = useState(true)

  const bothEnabled = enableBookmarks && enablePrompts

  const exampleConfig = generateConfig({
    enableBookmarks,
    enablePrompts,
    mcpUrl: config.mcpUrl,
    promptMcpUrl: config.promptMcpUrl,
    useSeparateTokens: bothEnabled,
  })

  const handleCopyConfig = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(exampleConfig)
      setCopiedConfig(true)
      setTimeout(() => setCopiedConfig(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleCopyPathMac = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CONFIG_PATH_MAC)
      setCopiedPathMac(true)
      setTimeout(() => setCopiedPathMac(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleCopyPathWin = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CONFIG_PATH_WINDOWS)
      setCopiedPathWin(true)
      setTimeout(() => setCopiedPathWin(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">MCP Integration</h1>
      </div>

      {/* What is MCP? */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">What is MCP?</h2>
        <p className="text-sm text-gray-600 mb-2">
          The <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Model Context Protocol (MCP)</a> is
          an open standard that allows AI assistants to securely access external tools and data.
          By connecting your bookmarks, notes, and prompts via MCP, AI agents can search your content,
          create new items, and use your prompt templates directly.
        </p>
        <p className="text-sm text-gray-600">
          <strong>Compatible with any MCP client:</strong> Claude Desktop, Claude Code, Cursor, and other MCP-enabled tools.
          The instructions below use Claude Desktop as an example, but the configuration is similar for other clients.
        </p>
      </div>

      {/* Setup Instructions */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Setup Instructions</h2>
        <p className="text-sm text-gray-500">These instructions are specific to Claude Desktop/Code, but similar steps can be taken to set up other MCP clients.</p>
      </div>

      {/* Server Selection */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Choose Servers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Content Server Card */}
          <div
            className={`relative rounded-xl border-2 p-5 transition-colors cursor-pointer ${
              enableBookmarks
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => setEnableBookmarks(!enableBookmarks)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2.5 ${enableBookmarks ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <svg className={`h-6 w-6 ${enableBookmarks ? 'text-blue-600' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </div>
                <div>
                  <span className="font-semibold text-gray-900">Content MCP Server</span>
                  <p className="text-sm text-gray-500 mt-1">
                    Let agents interact with your bookmarks and notes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enableBookmarks}
                onClick={(e) => {
                  e.stopPropagation()
                  setEnableBookmarks(!enableBookmarks)
                }}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  enableBookmarks ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enableBookmarks ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Prompt Server Card */}
          <div
            className={`relative rounded-xl border-2 p-5 transition-colors cursor-pointer ${
              enablePrompts
                ? 'border-orange-500 bg-orange-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => setEnablePrompts(!enablePrompts)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2.5 ${enablePrompts ? 'bg-orange-100' : 'bg-gray-100'}`}>
                  <svg className={`h-6 w-6 ${enablePrompts ? 'text-orange-600' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <div>
                  <span className="font-semibold text-gray-900">Prompt MCP Server</span>
                  <p className="text-sm text-gray-500 mt-1">
                    Give agents your predefined prompt templates.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enablePrompts}
                onClick={(e) => {
                  e.stopPropagation()
                  setEnablePrompts(!enablePrompts)
                }}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${
                  enablePrompts ? 'bg-orange-500' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enablePrompts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Explanation of the two servers */}
        <p className="mt-3 text-sm text-gray-500">
          <strong>Why two servers?</strong> The Content Server lets agents search, create, and manage your data.
          The Prompt Server provides agents with your reusable instructions. You can enable one or both based on your needs.
        </p>

        {!enableBookmarks && !enablePrompts && (
          <p className="mt-2 text-sm text-amber-600">
            Select at least one server to generate a configuration.
          </p>
        )}
      </div>

      {/* Step 1: Create PAT */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 1: Create a Personal Access Token
        </h3>
        <p className="text-gray-600 mb-3">
          Create a PAT to authenticate with the MCP server.
        </p>
        <Link
          to="/app/settings/tokens"
          className="btn-primary inline-flex items-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Token
        </Link>
        {bothEnabled && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm text-amber-800">
              <strong>Tip:</strong> Since you&apos;re enabling both servers, consider creating separate tokens for each.
              This allows you to revoke access to one service without affecting the other, and makes it easier to track usage.
            </p>
          </div>
        )}
      </div>

      {/* Step 2: Config file location */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 2: Locate Config File
        </h3>
        <p className="text-gray-600 mb-3">
          Create or edit the Claude Desktop configuration file at:
        </p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-700">macOS:</span>
            </div>
            <div className="relative">
              <code className="block rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800 pr-16">
                {CONFIG_PATH_MAC}
              </code>
              <button
                onClick={handleCopyPathMac}
                className={`absolute top-1.5 right-2 rounded px-2 py-1 text-xs transition-colors ${
                  copiedPathMac
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                {copiedPathMac ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-700">Windows:</span>
            </div>
            <div className="relative">
              <code className="block rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800 pr-16">
                {CONFIG_PATH_WINDOWS}
              </code>
              <button
                onClick={handleCopyPathWin}
                className={`absolute top-1.5 right-2 rounded px-2 py-1 text-xs transition-colors ${
                  copiedPathWin
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                {copiedPathWin ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Step 3: Add config */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 3: Add Configuration
        </h3>
        <p className="text-gray-600 mb-3">
          Add the following to your config file:
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-gray-900 p-3 text-sm text-gray-100 whitespace-pre-wrap break-all overflow-x-auto">
            <code>{exampleConfig}</code>
          </pre>
          <button
            onClick={handleCopyConfig}
            className={`absolute top-2 right-2 rounded px-2 py-1 text-xs transition-colors ${
              copiedConfig
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {copiedConfig ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">{bothEnabled ? 'YOUR_BOOKMARKS_TOKEN and YOUR_PROMPTS_TOKEN' : 'YOUR_TOKEN_HERE'}</code> with
          your Personal Access Token{bothEnabled ? 's' : ''} from Step 1.
        </p>
      </div>

      {/* Step 4: Restart */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 4: Restart Claude Desktop
        </h3>
        <p className="text-gray-600 mb-3">
          After saving the config file, restart Claude Desktop to load the MCP server.
        </p>
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-sm text-blue-800">
            <strong>Verify:</strong> Start a new conversation and try{' '}
            <em>&quot;Search my bookmarks&quot;</em> or <em>&quot;Create a note&quot;</em> to confirm the integration is working.
          </p>
        </div>
      </div>

      {/* Claude Code Tip */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Using with Claude Code?</h3>
        <p className="text-sm text-gray-600 mb-2">
          After configuring Claude Desktop, you can quickly add the same servers to Claude Code:
        </p>
        <code className="block rounded bg-gray-200 px-3 py-2 text-sm text-gray-800 font-mono">
          claude mcp add-from-claude-desktop
        </code>
        <p className="text-sm text-gray-500 mt-2">
          Note: Claude Code MCP servers are configured per project/directory.
        </p>
      </div>

      {/* Available Tools */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Available MCP Tools</h2>
        <p className="text-gray-600 mb-4">
          Once connected, AI agents can use these tools:
        </p>

        {enableBookmarks && (
          <>
            {/* Content Server */}
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Content Server</h3>
            <p className="text-sm text-gray-500 mb-3">
              Tools for managing your bookmarks and notes.
            </p>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bookmarks</h4>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">search_bookmarks</span>
                <span>Search by text query and/or filter by tags</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_bookmark</span>
                <span>Get full details of a bookmark by ID</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">create_bookmark</span>
                <span>Save a new URL (metadata auto-fetched)</span>
              </li>
            </ul>

            {/* Notes */}
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h4>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">search_notes</span>
                <span>Search by text query and/or filter by tags</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_note</span>
                <span>Get full details of a note by ID</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">create_note</span>
                <span>Create a new note with markdown content</span>
              </li>
            </ul>

            {/* Unified */}
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Unified</h4>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">search_all_content</span>
                <span>Search across bookmarks and notes in one query</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">list_tags</span>
                <span>Get all tags with usage counts</span>
              </li>
            </ul>
          </>
        )}

        {enablePrompts && (
          <>
            {/* Prompt Server */}
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Prompt Server</h3>
            <p className="text-sm text-gray-500 mb-2">
              Agents can use your saved prompts and create new ones.
            </p>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">list_prompts</span>
                <span>List all available prompts with their arguments</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_prompt</span>
                <span>Get a prompt rendered with provided argument values</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">create_prompt</span>
                <span>Create a new reusable prompt template</span>
              </li>
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
