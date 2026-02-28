import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { config } from '../../config'
import { CreateTokenStep } from './components/CreateTokenStep'
import { StepSection } from './components/StepSection'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'
import { SkillsSection } from './components/SkillsSection'
import { ExamplePrompts } from './components/ExamplePrompts'

function generateContentCommand(mcpUrl: string): string {
  return `claude mcp add --transport http bookmarks_notes ${mcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
}

function generatePromptCommand(promptMcpUrl: string): string {
  return `claude mcp add --transport http prompts ${promptMcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
}

export function DocsClaudeCode(): ReactNode {
  usePageTitle('Docs - Claude Code')

  const contentCommand = generateContentCommand(config.mcpUrl)
  const promptCommand = generatePromptCommand(config.promptMcpUrl)

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Tiddly + Claude Code</h1>
      <p className="text-gray-600 mb-8">
        Connect Claude Code to your bookmarks, notes, and prompts via MCP.
        Add servers with a single terminal command per project.
      </p>

      {/* MCP Server Setup */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">MCP Server Setup</h2>

      <CreateTokenStep />

      {/* Content Server */}
      <StepSection step={2} title="Add Content Server">
        <p className="text-gray-600 mb-3">
          Run this command in your project directory to add the bookmarks &amp; notes server:
        </p>
        <CopyableCodeBlock code={contentCommand} />
        <p className="mt-2 text-sm text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </StepSection>

      {/* Prompt Server */}
      <StepSection step={3} title="Add Prompt Server">
        <p className="text-gray-600 mb-3">
          Run this command to add the prompts server:
        </p>
        <CopyableCodeBlock code={promptCommand} />
        <p className="mt-2 text-sm text-gray-500">
          Use the same token as Step 2.
        </p>
      </StepSection>

      {/* Verify */}
      <StepSection step={4} title="Verify Installation">
        <p className="text-gray-600 mb-3">
          The servers are now configured for this project. Try asking Claude Code to{' '}
          <em>&quot;search my bookmarks&quot;</em> to verify it&apos;s working.
        </p>
        <InfoCallout variant="info">
          <strong>Note:</strong> Claude Code MCP servers are configured per project/directory.
          Run the commands in each project where you want access.
        </InfoCallout>
      </StepSection>

      {/* Import from Claude Desktop */}
      <InfoCallout variant="tip" title="Alternative: Import from Claude Desktop">
        <p className="mb-3">
          If you&apos;ve already configured Claude Desktop, you can import those servers:
        </p>
        <CopyableCodeBlock code="claude mcp add-from-claude-desktop" />
      </InfoCallout>

      {/* Skills Section */}
      <SkillsSection client="claude-code" />

      <ExamplePrompts />
    </div>
  )
}
