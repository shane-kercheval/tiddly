import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { config } from '../../config'
import { CreateTokenStep } from './components/CreateTokenStep'
import { StepSection } from './components/StepSection'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'
import { SkillsSection } from './components/SkillsSection'
import { ExamplePrompts } from './components/ExamplePrompts'

const CONFIG_PATH_MAC = '~/Library/Application\\ Support/Claude/claude_desktop_config.json'
const CONFIG_PATH_WINDOWS = '%APPDATA%\\Claude\\claude_desktop_config.json'

function generateCombinedConfig(mcpUrl: string, promptMcpUrl: string): string {
  const configObj = {
    mcpServers: {
      bookmarks_notes: {
        command: 'npx',
        args: [
          'mcp-remote',
          `${mcpUrl}/mcp`,
          '--header',
          'Authorization: Bearer YOUR_TOKEN_HERE',
        ],
      },
      prompts: {
        command: 'npx',
        args: [
          'mcp-remote',
          `${promptMcpUrl}/mcp`,
          '--header',
          'Authorization: Bearer YOUR_TOKEN_HERE',
        ],
      },
    },
  }
  return JSON.stringify(configObj, null, 2)
}

export function DocsClaudeDesktop(): ReactNode {
  usePageTitle('Docs - Claude Desktop')

  const combinedConfig = generateCombinedConfig(config.mcpUrl, config.promptMcpUrl)

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Tiddly + Claude Desktop</h1>
      <p className="text-gray-600 mb-8">
        Connect Claude Desktop to your bookmarks, notes, and prompts via MCP.
        Add both servers to your JSON configuration file.
      </p>

      {/* MCP Server Setup */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">MCP Server Setup</h2>

      <CreateTokenStep />

      {/* Config File Location */}
      <StepSection step={2} title="Locate Config File">
        <p className="text-gray-600 mb-3">
          Create or edit the Claude Desktop configuration file at:
        </p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-700">macOS:</span>
            </div>
            <CopyableCodeBlock code={CONFIG_PATH_MAC} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-700">Windows:</span>
            </div>
            <CopyableCodeBlock code={CONFIG_PATH_WINDOWS} />
          </div>
        </div>
      </StepSection>

      {/* Add Configuration */}
      <StepSection step={3} title="Add Configuration">
        <p className="text-gray-600 mb-3">
          Add the following to your config file (includes both Content and Prompt servers):
        </p>
        <CopyableCodeBlock code={combinedConfig} />
        <p className="mt-2 text-sm text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </StepSection>

      {/* Restart */}
      <StepSection step={4} title="Restart Claude Desktop">
        <p className="text-gray-600 mb-3">
          After saving the config file, restart Claude Desktop to load the MCP servers.
        </p>
        <InfoCallout variant="info">
          <strong>Verify:</strong> Start a new conversation and try{' '}
          <em>&quot;Search my bookmarks&quot;</em> to confirm the integration is working.
        </InfoCallout>
      </StepSection>

      {/* Skills Section */}
      <SkillsSection client="claude-desktop" />

      <ExamplePrompts />
    </div>
  )
}
