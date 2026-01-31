/**
 * Settings page for MCP (Model Context Protocol) and Skills setup instructions.
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../../config'
import { api } from '../../services/api'
import type { TagCount, TagListResponse } from '../../types'

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
    <div className="flex flex-col md:flex-row md:items-center gap-1.5">
      {/* Label - on mobile shows above options with orange border, on desktop shows inline */}
      <div className="border-l-4 border-l-[#f09040] pl-3 md:border-l-0 md:pl-4 md:w-32 md:flex-shrink-0">
        <span className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>{label}</span>
      </div>
      {/* Options - stack vertically on mobile, horizontal on desktop */}
      <div className="flex flex-col md:flex-row md:flex-1 gap-1.5 pl-4 md:pl-0">
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
                md:flex-1 px-4 py-2.5 text-sm font-medium transition-colors text-left md:text-center
                ${
                  isOptionDisabled
                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    : isComingSoon
                    ? isSelected
                      ? 'bg-gray-300 text-gray-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : isSelected
                    ? 'bg-[#f09040] text-white'
                    : 'bg-[#fff0e5] text-[#d97b3d] hover:bg-[#ffe4d1]'
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
    return `claude mcp add --transport http bookmarks ${mcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
  } else {
    return `claude mcp add --transport http prompts ${promptMcpUrl}/mcp \\
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
 * Generate the Codex config TOML based on server selection.
 */
function generateCodexConfig(
  server: ServerType,
  mcpUrl: string,
  promptMcpUrl: string
): string {
  if (server === 'content') {
    return `[mcp_servers.bookmarks]
url = "${mcpUrl}/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN_HERE" }`
  } else {
    return `[mcp_servers.prompts]
url = "${promptMcpUrl}/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN_HERE" }`
  }
}

/**
 * Codex setup instructions component.
 */
interface CodexInstructionsProps {
  server: ServerType
  mcpUrl: string
  promptMcpUrl: string
}

function CodexInstructions({
  server,
  mcpUrl,
  promptMcpUrl,
}: CodexInstructionsProps): ReactNode {
  const [copiedConfig, setCopiedConfig] = useState(false)

  const configContent = generateCodexConfig(server, mcpUrl, promptMcpUrl)

  const handleCopyConfig = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(configContent)
      setCopiedConfig(true)
      setTimeout(() => setCopiedConfig(false), 2000)
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

      {/* Step 2: Add to config */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 2: Add to Config File
        </h3>
        <p className="text-gray-600 mb-3">
          Open (or create) <code className="bg-gray-100 px-1 rounded">~/.codex/config.toml</code> and add:
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-gray-900 p-3 text-sm text-gray-100 whitespace-pre-wrap overflow-x-auto">
            <code>{configContent}</code>
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

      {/* Step 3: Restart */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 3: Restart Codex
        </h3>
        <p className="text-gray-600 mb-3">
          If Codex is running, quit and restart it.
        </p>
      </div>

      {/* Step 4: Verify */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 4: Verify Installation
        </h3>
        <p className="text-gray-600 mb-3">
          In Codex, type <code className="bg-gray-100 px-1 rounded">/mcp</code> to confirm the server
          is connected and shows available tools.
        </p>
      </div>

      {/* Using Prompts Note (only for prompt server) */}
      {server === 'prompts' && (
        <div className="mb-8 rounded-lg bg-blue-50 border border-blue-200 p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Using Your Prompts</h3>
          <p className="text-sm text-blue-800 mb-3">
            <strong>Note:</strong> Codex does not support MCP Prompts directly (the{' '}
            <code className="bg-blue-100 px-1 rounded">/prompt-name</code> invocation style).
            Instead, it exposes your server&apos;s tools for managing and retrieving prompts.
          </p>
          <p className="text-sm text-blue-800 mb-2">
            To use a saved prompt, ask Codex to fetch and apply it:
          </p>
          <ul className="text-sm text-blue-800 list-disc list-inside space-y-1">
            <li>
              <em>&quot;Get my &apos;code-review&apos; prompt and use it to review the changes in this file&quot;</em>
            </li>
            <li>
              <em>&quot;Search my prompts for &apos;commit message&apos; and use the best match to write a commit for my staged changes&quot;</em>
            </li>
          </ul>
        </div>
      )}

      {/* Add Both Servers Tip */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Want to add both servers?</h3>
        <p className="text-sm text-gray-600">
          Switch between &quot;Bookmarks &amp; Notes&quot; and &quot;Prompts&quot; in the selector above to see the configuration for each server.
          You can add both configurations to your <code className="bg-gray-200 px-1 rounded text-xs">config.toml</code> file.
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
  const contentTools = [
    { tool: 'get_context', category: 'Context', description: 'Get context summary of bookmarks and notes' },
    { tool: 'search_items', category: 'Search & Read', description: 'Search bookmarks and notes by text/tags' },
    { tool: 'get_item', category: 'Search & Read', description: 'Get full details by ID' },
    { tool: 'search_in_content', category: 'Search & Read', description: 'Search within content for editing' },
    { tool: 'list_filters', category: 'Search & Read', description: 'List content filters with IDs and tag rules' },
    { tool: 'list_tags', category: 'Search & Read', description: 'Get all tags with usage counts' },
    { tool: 'create_bookmark', category: 'Create & Edit', description: 'Save a new URL' },
    { tool: 'create_note', category: 'Create & Edit', description: 'Create a new note' },
    { tool: 'update_item', category: 'Create & Edit', description: 'Update metadata or fully replace content' },
    { tool: 'edit_content', category: 'Create & Edit', description: 'Edit content using string replacement' },
  ]

  const promptTools = [
    { tool: 'get_context', category: 'Context', description: 'Get context summary of prompts' },
    { tool: 'search_prompts', category: 'Search & Read', description: 'Search prompts by text/tags' },
    { tool: 'get_prompt_content', category: 'Search & Read', description: 'Get template and arguments for viewing/editing' },
    { tool: 'get_prompt_metadata', category: 'Search & Read', description: 'Get metadata without the template' },
    { tool: 'list_filters', category: 'Search & Read', description: 'List prompt filters with IDs and tag rules' },
    { tool: 'list_tags', category: 'Search & Read', description: 'Get all tags with usage counts' },
    { tool: 'create_prompt', category: 'Create & Edit', description: 'Create a new prompt template' },
    { tool: 'edit_prompt_content', category: 'Create & Edit', description: 'Edit template and arguments using string replacement' },
    { tool: 'update_prompt', category: 'Create & Edit', description: 'Update metadata, content, or arguments' },
  ]

  const tools = server === 'content' ? contentTools : promptTools

  // Group tools by category and calculate rowSpan
  const categoryGroups: { category: string; tools: typeof tools }[] = []
  let currentCategory = ''
  for (const tool of tools) {
    if (tool.category !== currentCategory) {
      categoryGroups.push({ category: tool.category, tools: [tool] })
      currentCategory = tool.category
    } else {
      categoryGroups[categoryGroups.length - 1].tools.push(tool)
    }
  }

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Available MCP Tools</h2>
      <p className="text-gray-600 mb-4">
        Once connected, AI agents can use these tools:
      </p>

      {/* Mobile: Section/bullet format */}
      <div className="md:hidden space-y-4">
        {categoryGroups.map((group) => (
          <div key={group.category}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {group.category}
            </h4>
            <ul className="space-y-2 text-sm text-gray-600">
              {group.tools.map((item) => (
                <li key={item.tool} className="flex items-start gap-2">
                  <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 text-xs flex-shrink-0">
                    {item.tool}
                  </code>
                  <span className="text-xs">{item.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Desktop: Table format */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Category
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Tool
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Description
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {categoryGroups.map((group) =>
              group.tools.map((item, index) => (
                <tr key={item.tool}>
                  {index === 0 && (
                    <td
                      rowSpan={group.tools.length}
                      className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap align-top border-r border-gray-200 bg-gray-50"
                    >
                      {group.category}
                    </td>
                  )}
                  <td className="px-3 py-2 text-sm">
                    <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">{item.tool}</code>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {item.description}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// =============================================================================
// Skills Export Components
// =============================================================================

// Client type for skills export (subset that supports skills)
type SkillsClientType = 'claude-code' | 'claude-desktop' | 'codex'

/**
 * Multi-select tag dropdown for filtering which prompts to export as skills.
 */
interface SkillsTagSelectorProps {
  availableTags: TagCount[]
  selectedTags: string[]
  onChange: (tags: string[]) => void
}

function SkillsTagSelector({
  availableTags,
  selectedTags,
  onChange,
}: SkillsTagSelectorProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter suggestions based on input
  const filteredTags = availableTags.filter(
    (tag) => tag.name.toLowerCase().includes(inputValue.toLowerCase())
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleTag = (tagName: string): void => {
    if (selectedTags.includes(tagName)) {
      onChange(selectedTags.filter((t) => t !== tagName))
    } else {
      onChange([...selectedTags, tagName])
    }
  }

  const removeTag = (tagName: string): void => {
    onChange(selectedTags.filter((t) => t !== tagName))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags display */}
      <div
        className="min-h-[34px] p-1.5 border border-gray-200 rounded-lg bg-white cursor-text flex flex-wrap gap-1.5 items-center"
        onClick={() => {
          setIsOpen(true)
          inputRef.current?.focus()
        }}
      >
        {selectedTags.length === 0 && !isOpen && (
          <span className="text-gray-400 text-sm">All prompts (click to filter by tags)</span>
        )}
        {selectedTags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#fff0e5] text-[#d97b3d]"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className="hover:text-orange-900"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {isOpen && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedTags.length > 0 ? 'Add more...' : 'Type to filter...'}
            className="flex-1 min-w-[100px] outline-none text-sm"
            autoFocus
          />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filteredTags.length === 0 ? (
            <div className="px-3 py-1.5 text-sm text-gray-400">
              {inputValue ? 'No matching tags' : 'No tags available'}
            </div>
          ) : (
            filteredTags.map((tag) => {
              const isSelected = selectedTags.includes(tag.name)
              return (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => toggleTag(tag.name)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-[#fff7f0] text-[#d97b3d]'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {isSelected && (
                      <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {tag.name}
                  </span>
                  <span className="text-xs text-gray-400">{tag.content_count}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Build the export URL for skills API endpoint.
 */
function buildSkillsExportUrl(client: SkillsClientType, selectedTags: string[]): string {
  const params = new URLSearchParams()
  params.append('client', client)
  selectedTags.forEach((tag) => params.append('tags', tag))
  return `${config.apiUrl}/prompts/export/skills?${params.toString()}`
}

/**
 * Claude Code skills sync instructions.
 */
interface ClaudeCodeSkillsInstructionsProps {
  exportUrl: string
}

function ClaudeCodeSkillsInstructions({ exportUrl }: ClaudeCodeSkillsInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)

  const syncCommand = `mkdir -p ~/.claude/skills && curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ~/.claude/skills/`

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(syncCommand)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <>
      {/* Step 3: Sync Command */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 3: Sync Skills
        </h3>
        <p className="text-gray-600 mb-3">
          Run this command to download and install your skills:
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-gray-900 p-3 text-sm text-gray-100 whitespace-pre-wrap overflow-x-auto">
            <code>{syncCommand}</code>
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
      </div>

      {/* Step 4: Use Your Skills */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 4: Use Your Skills
        </h3>
        <p className="text-gray-600 mb-2">
          After syncing, skills are available as <code className="bg-gray-100 px-1 rounded">/skill-name</code> slash commands.
          Claude will also auto-invoke them when relevant to your task.
        </p>
        <p className="text-sm text-gray-500">
          Tip: Add this command to a cron job or shell alias for regular syncing.
        </p>
      </div>

      {/* Sync behavior note */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Sync Behavior</h3>
        <p className="text-sm text-gray-600">
          Syncing is <strong>additive</strong>: new skills are added and existing skills are updated,
          but skills are not deleted. To remove a skill, manually delete its folder from{' '}
          <code className="bg-gray-200 px-1 rounded text-xs">~/.claude/skills/</code>.
        </p>
      </div>
    </>
  )
}

/**
 * Codex skills sync instructions.
 */
interface CodexSkillsInstructionsProps {
  exportUrl: string
}

function CodexSkillsInstructions({ exportUrl }: CodexSkillsInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)

  const syncCommand = `mkdir -p ~/.codex/skills && curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ~/.codex/skills/`

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(syncCommand)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <>
      {/* Step 3: Sync Command */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 3: Sync Skills
        </h3>
        <p className="text-gray-600 mb-3">
          Run this command to download and install your skills:
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-gray-900 p-3 text-sm text-gray-100 whitespace-pre-wrap overflow-x-auto">
            <code>{syncCommand}</code>
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
      </div>

      {/* Step 4: Use Your Skills */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 4: Use Your Skills
        </h3>
        <p className="text-gray-600">
          After syncing, invoke skills by typing <code className="bg-gray-100 px-1 rounded">$skill-name</code> in your prompt.
          Codex will also auto-select skills based on your task context.
        </p>
      </div>

      {/* Sync behavior note */}
      <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Sync Behavior</h3>
        <p className="text-sm text-gray-600">
          Syncing is <strong>additive</strong>: new skills are added and existing skills are updated,
          but skills are not deleted. To remove a skill, manually delete its folder from{' '}
          <code className="bg-gray-200 px-1 rounded text-xs">~/.codex/skills/</code>.
        </p>
      </div>
    </>
  )
}

/**
 * Claude Desktop skills download instructions.
 */
interface ClaudeDesktopSkillsInstructionsProps {
  exportUrl: string
}

function ClaudeDesktopSkillsInstructions({ exportUrl }: ClaudeDesktopSkillsInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)

  const downloadCommand = `curl -sH "Authorization: Bearer YOUR_PAT" "${exportUrl}" -o skills.zip`

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(downloadCommand)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <>
      {/* Step 3: Download */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 3: Download Zip File
        </h3>
        <p className="text-gray-600 mb-3">
          Run this command to download your skills:
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-gray-900 p-3 text-sm text-gray-100 whitespace-pre-wrap overflow-x-auto">
            <code>{downloadCommand}</code>
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
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_PAT</code> with your Personal Access Token from Step 1.
        </p>
      </div>

      {/* Step 4: Upload */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 4: Upload to Claude Desktop
        </h3>
        <ol className="list-decimal list-inside text-gray-600 space-y-2">
          <li>Open Claude Desktop</li>
          <li>Go to <strong>Settings → Capabilities → Skills</strong></li>
          <li>Click &quot;Upload skill&quot; and select the downloaded <code className="bg-gray-100 px-1 rounded">skills.zip</code> file</li>
        </ol>
      </div>

      {/* Step 5: Use Your Skills */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 5: Use Your Skills
        </h3>
        <p className="text-gray-600">
          Skills are invoked via natural language (e.g., &quot;use my code review skill&quot;).
          Claude will also auto-invoke them when relevant to your conversation.
        </p>
      </div>
    </>
  )
}

/**
 * Main skills export section component.
 */
interface SkillsExportSectionProps {
  client: SkillsClientType
}

/**
 * Compute default tags based on available tags.
 * Returns ['skill'] if 'skill' tag exists, ['skills'] if 'skills' tag exists, otherwise [].
 */
function getDefaultSkillTags(availableTags: TagCount[]): string[] {
  const tagNames = availableTags.map((t) => t.name)
  if (tagNames.includes('skill')) return ['skill']
  if (tagNames.includes('skills')) return ['skills']
  return []
}

function SkillsExportSection({ client }: SkillsExportSectionProps): ReactNode {
  // Local state for prompt-only tags (don't use global store which has all tags)
  const [promptTags, setPromptTags] = useState<TagCount[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Fetch prompt tags on mount and apply default selection
  useEffect(() => {
    let cancelled = false

    const fetchPromptTags = async (): Promise<void> => {
      try {
        const response = await api.get<TagListResponse>('/tags/?content_types=prompt')
        if (!cancelled) {
          const tags = response.data.tags
          setPromptTags(tags)
          // Apply default tag selection
          const defaultTags = getDefaultSkillTags(tags)
          if (defaultTags.length > 0) {
            setSelectedTags(defaultTags)
          }
        }
      } catch {
        // Silent fail - tags are optional
      }
    }
    fetchPromptTags()

    return () => {
      cancelled = true
    }
  }, [])

  const exportUrl = buildSkillsExportUrl(client, selectedTags)

  return (
    <>
      {/* Client-specific notes */}
      {(client === 'claude-code' || client === 'claude-desktop') && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> Prompt names longer than 64 characters will be truncated for {client === 'claude-code' ? 'Claude Code' : 'Claude Desktop'}.
          </p>
        </div>
      )}
      {client === 'codex' && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> Multi-line descriptions will be collapsed to a single line for Codex compatibility.
          </p>
        </div>
      )}

      {/* Step 1: Create PAT */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 1: Create a Personal Access Token
        </h3>
        <p className="text-gray-600 mb-3">
          Create a PAT and set it as the <code className="bg-gray-100 px-1 rounded">PROMPTS_TOKEN</code> environment variable.
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

      {/* Step 2: Filter by Tags */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Step 2: Filter by Tags (Optional)
        </h3>
        <p className="text-gray-600 mb-3">
          Select which prompts to export. If no tags are selected, all prompts will be exported.
        </p>
        <SkillsTagSelector
          availableTags={promptTags}
          selectedTags={selectedTags}
          onChange={setSelectedTags}
        />
      </div>

      {/* Client-specific instructions */}
      {client === 'claude-code' && <ClaudeCodeSkillsInstructions exportUrl={exportUrl} />}
      {client === 'codex' && <CodexSkillsInstructions exportUrl={exportUrl} />}
      {client === 'claude-desktop' && <ClaudeDesktopSkillsInstructions exportUrl={exportUrl} />}
    </>
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

  // Helper flags
  const isSkills = integration === 'skills'
  const isSkillsClient = client === 'claude-desktop' || client === 'claude-code' || client === 'codex'

  // Determine what content to show for MCP mode
  const isMcpSupported = auth === 'bearer' && integration === 'mcp' && isSkillsClient

  // Determine if skills export is supported (skills only work with prompts and certain clients)
  const isSkillsSupported = isSkills && isSkillsClient && server === 'prompts'

  // Coming soon / not applicable scenarios
  const getComingSoonContent = (): { title: string; description: string } | null => {
    if (integration === 'mcp') {
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
      if (auth === 'oauth') {
        return {
          title: 'OAuth Coming Soon',
          description: 'OAuth authentication will allow secure browser-based login without needing to manage tokens manually. Coming soon.',
        }
      }
    }
    // Skills mode: Bookmarks & Notes not applicable
    if (isSkills && server === 'content') {
      return {
        title: 'Skills Only Apply to Prompts',
        description: 'Skills are exported from your prompt templates. Select "Prompts" to export your prompt templates as skills.',
      }
    }
    // Skills mode: unsupported clients
    if (isSkills && !isSkillsClient) {
      return {
        title: `${client === 'chatgpt' ? 'ChatGPT' : 'Gemini CLI'} Skills Coming Soon`,
        description: `Skills export for ${client === 'chatgpt' ? 'ChatGPT' : 'Gemini CLI'} is not yet supported.`,
      }
    }
    return null
  }

  const comingSoonContent = getComingSoonContent()

  // Server options - Bookmarks & Notes grayed out for skills (only prompts can be exported as skills)
  const serverOptions: SelectorOption<ServerType>[] = [
    { value: 'content', label: 'Bookmarks & Notes', comingSoon: isSkills },
    { value: 'prompts', label: 'Prompts' },
  ]

  // When switching to Skills mode, auto-select Prompts
  const handleIntegrationChange = (newIntegration: IntegrationType): void => {
    setIntegration(newIntegration)
    if (newIntegration === 'skills') {
      setServer('prompts')
    }
  }

  // Client options - different coming soon logic for MCP vs Skills
  const clientOptions: SelectorOption<ClientType>[] = [
    { value: 'claude-desktop', label: 'Claude Desktop' },
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'chatgpt', label: 'ChatGPT', comingSoon: true },
    { value: 'codex', label: 'Codex' },
    { value: 'gemini-cli', label: 'Gemini CLI', comingSoon: true },
  ]

  // Auth options - ChatGPT only supports OAuth, not Bearer (only relevant for MCP)
  const authOptions: SelectorOption<AuthType>[] = [
    { value: 'bearer', label: 'Bearer Token', comingSoon: client === 'chatgpt' },
    { value: 'oauth', label: 'OAuth', comingSoon: true },
  ]

  // Integration options
  const integrationOptions: SelectorOption<IntegrationType>[] = [
    { value: 'mcp', label: 'MCP Server' },
    { value: 'skills', label: 'Skills' },
  ]

  return (
    <div className="max-w-3xl pt-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Integration</h1>
      </div>

      {/* Config Selector */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Select Integration</h2>
        <div className="md:border-l-4 md:border-l-[#f09040] bg-white py-1.5 flex flex-col gap-4 md:gap-1.5">
          {/* Integration row first - controls visibility of other rows */}
          <SelectorRow
            label="Integration"
            options={integrationOptions}
            value={integration}
            onChange={handleIntegrationChange}
          />
          {/* Content row - Bookmarks & Notes disabled for skills mode */}
          <SelectorRow
            label="Content"
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
          {/* Auth row - only show for MCP mode (skills use PAT via curl) */}
          {!isSkills && (
            <SelectorRow
              label="Auth"
              options={authOptions}
              value={auth}
              onChange={setAuth}
            />
          )}
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
            Skills are reusable instructions (SKILL.md files) that AI assistants can auto-invoke based on context
            or invoke manually via slash commands. Export your prompts as skills and sync them to your AI client.
            Skills follow the <a href="https://agentskills.io/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Agent Skills Standard</a>.
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

      {/* MCP Instructions */}
      {isMcpSupported && client === 'claude-desktop' && (
        <ClaudeDesktopInstructions
          server={server}
          mcpUrl={config.mcpUrl}
          promptMcpUrl={config.promptMcpUrl}
        />
      )}
      {isMcpSupported && client === 'claude-code' && (
        <ClaudeCodeInstructions
          server={server}
          mcpUrl={config.mcpUrl}
          promptMcpUrl={config.promptMcpUrl}
        />
      )}
      {isMcpSupported && client === 'codex' && (
        <CodexInstructions
          server={server}
          mcpUrl={config.mcpUrl}
          promptMcpUrl={config.promptMcpUrl}
        />
      )}

      {/* Skills Export Instructions */}
      {isSkillsSupported && (
        <SkillsExportSection client={client as SkillsClientType} />
      )}

      {/* Available Tools - show when MCP setup is supported */}
      {isMcpSupported && <AvailableTools server={server} />}
    </div>
  )
}
