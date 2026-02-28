import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { config } from '../../config'
import { CreateTokenStep } from './components/CreateTokenStep'
import { StepSection } from './components/StepSection'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'
import { SkillsSection } from './components/SkillsSection'
import { ExamplePrompts } from './components/ExamplePrompts'

function generateCombinedConfig(mcpUrl: string, promptMcpUrl: string): string {
  return `[mcp_servers.bookmarks_notes]
url = "${mcpUrl}/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN_HERE" }

[mcp_servers.prompts]
url = "${promptMcpUrl}/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN_HERE" }`
}

export function DocsCodex(): ReactNode {
  usePageTitle('Docs - Codex')

  const combinedConfig = generateCombinedConfig(config.mcpUrl, config.promptMcpUrl)

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Tiddly + Codex</h1>
      <p className="text-gray-600 mb-8">
        Connect Codex to your bookmarks, notes, and prompts via MCP.
        Add both servers to your TOML configuration file.
      </p>

      {/* MCP Server Setup */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">MCP Server Setup</h2>

      <CreateTokenStep />

      {/* Add to Config */}
      <StepSection step={2} title="Add to Config File">
        <p className="text-gray-600 mb-3">
          Open (or create) <code className="bg-gray-100 px-1 rounded">~/.codex/config.toml</code> and
          add both servers:
        </p>
        <CopyableCodeBlock code={combinedConfig} />
        <p className="mt-2 text-sm text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </StepSection>

      {/* Restart */}
      <StepSection step={3} title="Restart Codex">
        <p className="text-gray-600 mb-3">
          If Codex is running, quit and restart it.
        </p>
      </StepSection>

      {/* Verify */}
      <StepSection step={4} title="Verify Installation">
        <p className="text-gray-600 mb-3">
          In Codex, type <code className="bg-gray-100 px-1 rounded">/mcp</code> to confirm
          the servers are connected and show available tools.
        </p>
      </StepSection>

      {/* Using Prompts Note */}
      <InfoCallout variant="info" title="Using Your Prompts">
        <p className="mb-3">
          <strong>Note:</strong> Codex does not support MCP Prompts directly (the{' '}
          <code className="bg-blue-100 px-1 rounded">/prompt-name</code> invocation style).
          Instead, it exposes your server&apos;s tools for managing and retrieving prompts.
        </p>
        <p className="mb-2">
          To use a saved prompt, ask Codex to fetch and apply it:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <em>&quot;Get my &apos;code-review&apos; prompt and use it to review the changes in this file&quot;</em>
          </li>
          <li>
            <em>&quot;Search my prompts for &apos;commit message&apos; and use the best match to write a commit for my staged changes&quot;</em>
          </li>
        </ul>
      </InfoCallout>

      {/* Skills Section */}
      <SkillsSection client="codex" />

      <ExamplePrompts />
    </div>
  )
}
