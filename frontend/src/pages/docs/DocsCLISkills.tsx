import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { InfoCallout } from './components/InfoCallout'

export function DocsCLISkills(): ReactNode {
  usePageTitle('Docs - CLI Skills')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">CLI Skills</h1>
      <p className="text-sm text-gray-600 mb-8">
        Export your prompt templates as agent skills for AI tools. Skills are SKILL.md files
        following the{' '}
        <a
          href="https://agentskills.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#d97b3d] hover:underline"
        >
          Agent Skills Standard
        </a>
        . They let AI assistants auto-invoke your prompts based on context.
      </p>

      {/* tiddly skills configure */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">tiddly skills configure</h2>
      <p className="text-sm text-gray-600 mb-3">
        Installs your prompt templates as SKILL.md files for the target AI tool.
        By default, only prompts tagged &quot;skill&quot; are installed. Without arguments, it auto-detects all installed tools:
      </p>
      <CopyableCodeBlock code={`tiddly skills configure                                  # auto-detect tools, configure "skill"-tagged prompts
tiddly skills configure claude-code                      # configure for a specific tool
tiddly skills configure claude-code codex                # multiple tools
tiddly skills configure --tags python,skill --tag-match all  # prompts matching all tags (default)
tiddly skills configure --tags python,skill --tag-match any  # prompts matching any tag
tiddly skills configure --tags ""                         # configure all prompts (no tag filter)
tiddly skills configure --scope directory                  # configure to directory-level paths`} />

      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">What happens per client</h3>
      <ul className="list-disc list-inside space-y-2 text-sm text-gray-600 mb-4">
        <li>
          <strong>Claude Code:</strong> extracts tar.gz to{' '}
          <code className="bg-gray-100 px-1 rounded">~/.claude/skills/</code> (user) or{' '}
          <code className="bg-gray-100 px-1 rounded">.claude/skills/</code> (directory)
        </li>
        <li>
          <strong>Codex:</strong> extracts tar.gz to{' '}
          <code className="bg-gray-100 px-1 rounded">~/.agents/skills/</code> (user) or{' '}
          <code className="bg-gray-100 px-1 rounded">.agents/skills/</code> (directory)
        </li>
        <li>
          <strong>Claude Desktop:</strong> saves zip to a temp file for manual upload via
          Settings &rarr; Capabilities
        </li>
      </ul>

      <InfoCallout variant="tip" title="Install Behavior">
        <p>
          Installing is <strong>additive</strong>: new skills are added and existing skills are updated,
          but skills are never deleted. To remove a skill, manually delete its folder from the skills
          directory.
        </p>
      </InfoCallout>

      {/* tiddly skills list */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">tiddly skills list</h2>
      <p className="text-sm text-gray-600 mb-3">
        Lists prompts eligible for export as skills, showing name and description:
      </p>
      <CopyableCodeBlock code={`tiddly skills list                       # list all available skills
tiddly skills list --tags python         # list skills filtered by tags`} />

      {/* Reference: Scopes */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Reference</h2>

      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Scopes</h3>
      <p className="text-sm text-gray-600 mb-3">
        Use <code className="bg-gray-100 px-1 rounded">--scope</code> to control where skills are
        written:
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Scope</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Claude Code</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Codex</th>
              <th className="py-2 text-left font-semibold text-gray-900">Claude Desktop</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">user</code> (default)</td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.claude/skills/</code></td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">~/.agents/skills/</code></td>
              <td className="py-2 text-gray-400">N/A (zip download)</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">directory</code></td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">.claude/skills/</code></td>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded text-xs">.agents/skills/</code></td>
              <td className="py-2 text-gray-400">Not supported</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* All Flags */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">All Flags</h3>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Flag</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Commands</th>
              <th className="py-2 text-left font-semibold text-gray-900">Description</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--tags</code></td>
              <td className="py-2 pr-4">configure, list</td>
              <td className="py-2">Comma-separated tag filter (default: &quot;skill&quot;)</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--tag-match</code></td>
              <td className="py-2 pr-4">configure, list</td>
              <td className="py-2">&quot;all&quot; (default) or &quot;any&quot;</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="bg-gray-100 px-1 rounded">--scope</code></td>
              <td className="py-2 pr-4">configure</td>
              <td className="py-2">user (default) or directory</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Client Constraints */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Client Constraints</h3>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Constraint</th>
              <th className="py-2 pr-4 text-left font-semibold text-gray-900">Claude Code / Desktop</th>
              <th className="py-2 text-left font-semibold text-gray-900">Codex</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-600">
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">Name max length</td>
              <td className="py-2 pr-4">64 chars</td>
              <td className="py-2">100 chars</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pr-4">Description max length</td>
              <td className="py-2 pr-4">1024 chars</td>
              <td className="py-2">500 chars</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Multi-line description</td>
              <td className="py-2 pr-4">Preserved</td>
              <td className="py-2">Collapsed to single line</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Usage */}
      <h3 className="text-base font-semibold text-gray-900 mt-6 mb-3">Usage</h3>
      <ul className="list-disc list-inside space-y-2 text-sm text-gray-600 mb-6">
        <li>
          <strong>Claude Code:</strong> auto-invoked based on context, or trigger with{' '}
          <code className="bg-gray-100 px-1 rounded">/skill-name</code>
        </li>
        <li>
          <strong>Codex:</strong> auto-selected based on task context, or invoke with{' '}
          <code className="bg-gray-100 px-1 rounded">$skill-name</code>
        </li>
        <li>
          <strong>Claude Desktop:</strong> invoke via natural language (e.g. &quot;use my X skill&quot;)
        </li>
      </ul>

      {/* Cross-links */}
      <InfoCallout variant="tip" title="See Also">
        <p>
          For manual setup without the CLI, see the{' '}
          <Link to="/docs/ai" className="underline hover:text-gray-900">AI Integration</Link>{' '}
          docs. For creating prompts to export as skills, see{' '}
          <Link to="/docs/features/prompts" className="underline hover:text-gray-900">Prompts &amp; Templates</Link>.
        </p>
      </InfoCallout>
    </div>
  )
}
