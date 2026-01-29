/**
 * Settings page for MCP (Model Context Protocol) and Skills setup instructions.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../../config'

const CONFIG_PATH_MAC = '~/Library/Application\\ Support/Claude/claude_desktop_config.json'
const CONFIG_PATH_WINDOWS = '%APPDATA%\\Claude\\claude_desktop_config.json'

// Selector types
type ServerType = 'content' | 'prompts'
type ClientType = 'claude-desktop' | 'claude-code' | 'gemini-cli' | 'chatgpt' | 'codex'
type AuthType = 'bearer' | 'oauth'
type IntegrationType = 'mcp' | 'skills'

interface McpServerConfig {
  command: string
  args: string[]
}

/**
 * Selector row component for PyTorch-style configuration.
 */
interface SelectorOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  comingSoon?: boolean
}

interface SelectorRowProps<T extends string> {
  label: string
  options: SelectorOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

function SelectorRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SelectorRowProps<T>): ReactNode {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-32 flex-shrink-0 pl-4">
        <span className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>{label}</span>
      </div>
      <div className="flex-1 flex gap-1.5">
        {options.map((option) => {
          const isSelected = value === option.value
          const isComingSoon = option.comingSoon
          const isOptionDisabled = disabled || option.disabled

          // Color scheme:
          // Supported: light orange (unselected) / dark orange (selected)
          // Unsupported/coming soon: light gray (unselected) / dark gray (selected)
          // Disabled: very light gray, not clickable

          return (
            <button
              key={option.value}
              type="button"
              disabled={isOptionDisabled}
              onClick={() => !isOptionDisabled && onChange(option.value)}
              className={`
                flex-1 px-4 py-2.5 text-sm font-medium transition-colors
                ${
                  isOptionDisabled
                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    : isComingSoon
                    ? isSelected
                      ? 'bg-gray-300 text-gray-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : isSelected
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                }
              `}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Generate the Claude Desktop config JSON based on server selection.
 */
function generateClaudeDesktopConfig(
  server: ServerType,
  mcpUrl: string,
  promptMcpUrl: string
): string {
  const servers: Record<string, McpServerConfig> = {}

  if (server === 'content') {
    servers.bookmarks_notes = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${mcpUrl}/mcp`,
        '--header',
        'Authorization: Bearer YOUR_TOKEN_HERE',
      ],
    }
  } else {
    servers.prompts = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${promptMcpUrl}/mcp`,
        '--header',
        'Authorization: Bearer YOUR_TOKEN_HERE',
      ],
    }
  }

  const configObj = { mcpServers: servers }
  return JSON.stringify(configObj, null, 2)
}

/**
 * Generate the Claude Code commands based on server selection.
 */
function generateClaudeCodeCommand(
  server: ServerType,
  mcpUrl: string,
  promptMcpUrl: string
): string {
  if (server === 'content') {
    return `claude mcp add bookmarks \\
  --transport sse \\
  ${mcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
  } else {
    return `claude mcp add prompts \\
  --transport sse \\
  ${promptMcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
  }
}

/**
 * Claude Desktop setup instructions component.
 */
interface ClaudeDesktopInstructionsProps {
  server: ServerType
  mcpUrl: string
  promptMcpUrl: string
}

function ClaudeDesktopInstructions({
  server,
  mcpUrl,
  promptMcpUrl,
}: ClaudeDesktopInstructionsProps): ReactNode {
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [copiedPathMac, setCopiedPathMac] = useState(false)
  const [copiedPathWin, setCopiedPathWin] = useState(false)

  const exampleConfig = generateClaudeDesktopConfig(server, mcpUrl, promptMcpUrl)

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
    <>
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
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
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
            {server === 'content' ? (
              <em>&quot;Search my bookmarks&quot;</em>
            ) : (
              <em>&quot;List my prompts&quot;</em>
            )}{' '}
            to confirm the integration is working.
          </p>
        </div>
      </div>

      {/* Add Both Servers Tip */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Want to add both servers?</h3>
        <p className="text-sm text-gray-600">
          Switch between &quot;Content&quot; and &quot;Prompts&quot; in the selector above to see the configuration for each server.
          You can add both configurations to your <code className="bg-gray-200 px-1 rounded text-xs">mcpServers</code> object
          by combining them.
        </p>
      </div>
    </>
  )
}

/**
 * Claude Code setup instructions component.
 */
interface ClaudeCodeInstructionsProps {
  server: ServerType
  mcpUrl: string
  promptMcpUrl: string
}

function ClaudeCodeInstructions({
  server,
  mcpUrl,
  promptMcpUrl,
}: ClaudeCodeInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [copiedImport, setCopiedImport] = useState(false)

  const command = generateClaudeCodeCommand(server, mcpUrl, promptMcpUrl)
  const importCommand = 'claude mcp add-from-claude-desktop'

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleCopyImport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(importCommand)
      setCopiedImport(true)
      setTimeout(() => setCopiedImport(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <>
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
      </div>

      {/* Step 2: Add MCP Server */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 2: Add MCP Server
        </h3>
        <p className="text-gray-600 mb-3">
          Run this command in your project directory:
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-gray-900 p-3 text-sm text-gray-100 whitespace-pre-wrap overflow-x-auto">
            <code>{command}</code>
          </pre>
          <button
            onClick={handleCopyCommand}
            className={`absolute top-2 right-2 rounded px-2 py-1 text-xs transition-colors ${
              copiedCommand
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {copiedCommand ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </div>

      {/* Step 3: Verify */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 3: Verify Installation
        </h3>
        <p className="text-gray-600 mb-3">
          The server is now configured for this project. Try asking Claude Code to{' '}
          {server === 'content' ? (
            <em>&quot;search my bookmarks&quot;</em>
          ) : (
            <em>&quot;list my prompts&quot;</em>
          )}{' '}
          to verify it&apos;s working.
        </p>
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Claude Code MCP servers are configured per project/directory.
            Run the command in each project where you want access.
          </p>
        </div>
      </div>

      {/* Alternative: Import from Claude Desktop */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Alternative: Import from Claude Desktop</h3>
        <p className="text-sm text-gray-600 mb-3">
          If you&apos;ve already configured Claude Desktop, you can import those servers:
        </p>
        <div className="relative">
          <code className="block rounded bg-gray-200 px-3 py-2 text-sm text-gray-800 font-mono pr-16">
            {importCommand}
          </code>
          <button
            onClick={handleCopyImport}
            className={`absolute top-1.5 right-2 rounded px-2 py-1 text-xs transition-colors ${
              copiedImport
                ? 'bg-green-600 text-white'
                : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
            }`}
          >
            {copiedImport ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Add Both Servers Tip */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Want to add both servers?</h3>
        <p className="text-sm text-gray-600">
          Switch between &quot;Content&quot; and &quot;Prompts&quot; in the selector above to see the command for each server.
          Run both commands to add both MCP servers to your project.
        </p>
      </div>
    </>
  )
}

/**
 * Coming soon placeholder component for various unsupported configurations.
 */
interface ComingSoonProps {
  title: string
  description: string
}

function ComingSoon({ title, description }: ComingSoonProps): ReactNode {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 p-6 text-center">
      <div className="mb-4">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-600">
        {description}
      </p>
    </div>
  )
}

/**
 * Available tools section component.
 */
interface AvailableToolsProps {
  server: ServerType
}

function AvailableTools({ server }: AvailableToolsProps): ReactNode {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Available MCP Tools</h2>
      <p className="text-gray-600 mb-4">
        Once connected, AI agents can use these tools:
      </p>

      {server === 'content' ? (
        <>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Content Server</h3>
          <p className="text-sm text-gray-500 mb-3">
            Tools for managing your bookmarks and notes.
          </p>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Context</h4>
          <ul className="space-y-2 text-sm text-gray-600 mb-4">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_context</span>
              <span>Get context summary of bookmarks and notes</span>
            </li>
          </ul>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Search & Read</h4>
          <ul className="space-y-2 text-sm text-gray-600 mb-4">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">search_items</span>
              <span>Search bookmarks and notes by text/tags</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_item</span>
              <span>Get full details by ID</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">search_in_content</span>
              <span>Search within content for editing</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">list_filters</span>
              <span>List content filters with IDs and tag rules</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">list_tags</span>
              <span>Get all tags with usage counts</span>
            </li>
          </ul>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Create & Edit</h4>
          <ul className="space-y-2 text-sm text-gray-600 mb-4">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">create_bookmark</span>
              <span>Save a new URL</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">create_note</span>
              <span>Create a new note</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">update_item</span>
              <span>Update metadata or fully replace content</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">edit_content</span>
              <span>Edit content using string replacement</span>
            </li>
          </ul>
        </>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Prompt Server</h3>
          <p className="text-sm text-gray-500 mb-2">
            Agents can use your saved prompts and create new ones.
          </p>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Context</h4>
          <ul className="space-y-2 text-sm text-gray-600 mb-4">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_context</span>
              <span>Get context summary of prompts</span>
            </li>
          </ul>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Search & Read</h4>
          <ul className="space-y-2 text-sm text-gray-600 mb-4">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">search_prompts</span>
              <span>Search prompts by text/tags</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_prompt_content</span>
              <span>Get template and arguments for viewing/editing</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">get_prompt_metadata</span>
              <span>Get metadata without the template</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">list_filters</span>
              <span>List prompt filters with IDs and tag rules</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">list_tags</span>
              <span>Get all tags with usage counts</span>
            </li>
          </ul>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Create & Edit</h4>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">create_prompt</span>
              <span>Create a new prompt template</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">edit_prompt_content</span>
              <span>Edit template and arguments using string replacement</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">update_prompt</span>
              <span>Update metadata, content, or arguments</span>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * MCP & Skills setup instructions settings page.
 */
export function SettingsMCP(): ReactNode {
  // Selector state
  const [server, setServer] = useState<ServerType>('content')
  const [client, setClient] = useState<ClientType>('claude-desktop')
  const [auth, setAuth] = useState<AuthType>('bearer')
  const [integration, setIntegration] = useState<IntegrationType>('mcp')

  // Determine what content to show
  const isSupported = auth === 'bearer' && integration === 'mcp' && (client === 'claude-desktop' || client === 'claude-code')

  // Coming soon scenarios
  const getComingSoonContent = (): { title: string; description: string } | null => {
    if (integration === 'skills') {
      return {
        title: 'Skills Coming Soon',
        description: 'Skills are pre-built agent capabilities that can be invoked directly from AI assistants without MCP configuration. Instructions coming soon.',
      }
    }
    if (client === 'chatgpt') {
      return {
        title: 'ChatGPT Integration Coming Soon',
        description: 'ChatGPT requires OAuth authentication. OAuth implementation is coming soon.',
      }
    }
    if (client === 'gemini-cli') {
      return {
        title: 'Gemini CLI Integration Coming Soon',
        description: 'Gemini CLI MCP integration instructions are coming soon.',
      }
    }
    if (client === 'codex') {
      return {
        title: 'Codex Integration Coming Soon',
        description: 'Codex MCP integration instructions are coming soon.',
      }
    }
    if (auth === 'oauth') {
      return {
        title: 'OAuth Coming Soon',
        description: 'OAuth authentication will allow secure browser-based login without needing to manage tokens manually. Coming soon.',
      }
    }
    return null
  }

  const comingSoonContent = getComingSoonContent()

  // When Skills is selected, everything below is coming soon
  const isSkills = integration === 'skills'

  // Server options
  const serverOptions: SelectorOption<ServerType>[] = [
    { value: 'content', label: 'Bookmarks & Notes', comingSoon: isSkills },
    { value: 'prompts', label: 'Prompts', comingSoon: isSkills },
  ]

  // Client options - ChatGPT requires OAuth (coming soon for MCP), Codex/Gemini CLI coming soon
  const clientOptions: SelectorOption<ClientType>[] = [
    { value: 'claude-desktop', label: 'Claude Desktop', comingSoon: isSkills },
    { value: 'claude-code', label: 'Claude Code', comingSoon: isSkills },
    { value: 'chatgpt', label: 'ChatGPT', comingSoon: isSkills || integration === 'mcp' },
    { value: 'codex', label: 'Codex', comingSoon: true },
    { value: 'gemini-cli', label: 'Gemini CLI', comingSoon: true },
  ]

  // Auth options - ChatGPT only supports OAuth, not Bearer
  const authOptions: SelectorOption<AuthType>[] = [
    { value: 'bearer', label: 'Bearer Token', comingSoon: client === 'chatgpt' },
    { value: 'oauth', label: 'OAuth', comingSoon: true },
  ]

  // Integration options
  const integrationOptions: SelectorOption<IntegrationType>[] = [
    { value: 'mcp', label: 'MCP Server' },
    { value: 'skills', label: 'Skills', comingSoon: true },
  ]

  return (
    <div className="max-w-3xl pt-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Integration</h1>
      </div>

      {/* Config Selector */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Select Integration</h2>
        <div className="border-l-4 border-l-orange-500 bg-white py-1.5 flex flex-col gap-1.5">
          <SelectorRow
            label="Integration"
            options={integrationOptions}
            value={integration}
            onChange={setIntegration}
          />
          <SelectorRow
            label="Server"
            options={serverOptions}
            value={server}
            onChange={setServer}
          />
          <SelectorRow
            label="Client"
            options={clientOptions}
            value={client}
            onChange={setClient}
          />
          <SelectorRow
            label="Auth"
            options={authOptions}
            value={auth}
            onChange={setAuth}
            disabled={isSkills}
          />
        </div>
      </div>

      {/* Integration explanation - changes based on selection */}
      {integration === 'mcp' && (
        <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">What is MCP?</h2>
          <p className="text-sm text-gray-600">
            The <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Model Context Protocol (MCP)</a> is
            an open standard that allows AI assistants to securely access external tools and data.
            By connecting your bookmarks, notes, and prompts via MCP, AI agents can search your content,
            create new items, and use your prompt templates directly.
          </p>
        </div>
      )}
      {integration === 'skills' && (
        <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">What are Skills?</h2>
          <p className="text-sm text-gray-600">
            Skills are pre-built agent capabilities that can be invoked directly from AI assistants
            without any configuration. Simply mention your content in a conversation and the AI
            can automatically access your bookmarks, notes, and prompts.
          </p>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Setup Instructions</h2>
      </div>

      {/* Conditional content based on selection */}
      {comingSoonContent && (
        <ComingSoon title={comingSoonContent.title} description={comingSoonContent.description} />
      )}
      {isSupported && client === 'claude-desktop' && (
        <ClaudeDesktopInstructions
          server={server}
          mcpUrl={config.mcpUrl}
          promptMcpUrl={config.promptMcpUrl}
        />
      )}
      {isSupported && client === 'claude-code' && (
        <ClaudeCodeInstructions
          server={server}
          mcpUrl={config.mcpUrl}
          promptMcpUrl={config.promptMcpUrl}
        />
      )}

      {/* Available Tools - show when setup is supported */}
      {isSupported && <AvailableTools server={server} />}
    </div>
  )
}
