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
}): string {
  const servers: Record<string, McpServerConfig> = {}

  if (options.enableBookmarks) {
    servers.notes_bookmarks = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${options.mcpUrl}/mcp`,
        '--header',
        'Authorization: Bearer YOUR_TOKEN_HERE',
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
        'Authorization: Bearer YOUR_TOKEN_HERE',
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

  const exampleConfig = generateConfig({
    enableBookmarks,
    enablePrompts,
    mcpUrl: config.mcpUrl,
    promptMcpUrl: config.promptMcpUrl,
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">MCP Integration</h1>
        <p className="mt-1 text-gray-500">
          Connect Claude Desktop to your bookmarks and notes using the Model Context Protocol (MCP).
        </p>
      </div>

      {/* Step 1: Create PAT */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Step 1: Create a Personal Access Token
        </h2>
        <p className="text-gray-600 mb-3">
          You need a Personal Access Token (PAT) to authenticate with the MCP server.
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
      </div>

      {/* Step 2: Config file location */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Step 2: Locate Claude Desktop Config
        </h2>
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

      {/* Step 3: Select Servers */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Step 3: Select MCP Servers
        </h2>
        <p className="text-gray-600 mb-3">
          Choose which MCP servers to enable:
        </p>
        <div className="space-y-3">
          {/* Bookmarks & Notes Card */}
          <div
            className={`relative rounded-lg border-2 p-4 transition-colors cursor-pointer ${
              enableBookmarks
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => setEnableBookmarks(!enableBookmarks)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-lg p-2 ${enableBookmarks ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <svg className={`h-5 w-5 ${enableBookmarks ? 'text-blue-600' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </div>
                <div>
                  <span className="font-medium text-gray-900">Bookmarks & Notes</span>
                  <p className="text-sm text-gray-500 mt-0.5">Allow AI agents to search and create bookmarks and notes.</p>
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
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  enableBookmarks ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enableBookmarks ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Prompts Card */}
          <div
            className={`relative rounded-lg border-2 p-4 transition-colors cursor-pointer ${
              enablePrompts
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => setEnablePrompts(!enablePrompts)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-lg p-2 ${enablePrompts ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <svg className={`h-5 w-5 ${enablePrompts ? 'text-blue-600' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <div>
                  <span className="font-medium text-gray-900">Prompts</span>
                  <p className="text-sm text-gray-500 mt-0.5">Allow AI agents to create and use your prompts.</p>
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
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  enablePrompts ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enablePrompts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
        {!enableBookmarks && !enablePrompts && (
          <p className="mt-3 text-sm text-amber-600">
            Select at least one server to generate a configuration.
          </p>
        )}
      </div>

      {/* Step 4: Add config */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Step 4: Add MCP Server Configuration
        </h2>
        <p className="text-gray-600 mb-3">
          Add the following to your Claude Desktop config file:
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
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with your
          Personal Access Token from Step 1.
        </p>
      </div>

      {/* Step 5: Restart */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Step 5: Restart Claude Desktop
        </h2>
        <p className="text-gray-600 mb-3">
          After saving the config file, restart Claude Desktop to load the MCP server.
        </p>
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-sm text-blue-800">
            <strong>Tip:</strong> Start a new conversation and try{' '}
            <em>&quot;Search my bookmarks&quot;</em> or <em>&quot;Create a note&quot;</em> to verify the integration is working.
          </p>
        </div>
      </div>

      {/* Available Tools */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Available MCP Tools</h2>
        <p className="text-gray-600 mb-4">
          Once connected, Claude can use these tools to interact with your content:
        </p>

        {/* Bookmarks */}
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Bookmarks</h3>
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
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
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
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Unified</h3>
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

        {/* Prompts Server */}
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Prompts Server</h3>
        <p className="text-sm text-gray-500 mb-2">
          The prompts server exposes your saved prompts as MCP prompts that Claude can use directly.
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
        </ul>
      </div>
    </div>
  )
}
