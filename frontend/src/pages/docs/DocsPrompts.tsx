import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'
import { CopyableCodeBlock } from './components/CopyableCodeBlock'
import { JinjaCode } from './components/JinjaHighlight'

export function DocsPrompts(): ReactNode {
  usePageTitle('Docs - Prompts & Templates')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Prompts & Templates</h1>
      <p className="text-gray-600 mb-10">
        Prompts are Jinja2 templates with typed arguments. Define reusable templates for AI
        assistants, render them with different values, and access them programmatically
        via MCP or the API.
      </p>

      {/* Template Basics */}
      <h2 className="text-xl font-bold text-gray-900 mb-3">Template Basics</h2>
      <p className="text-gray-600 mb-3">
        Use <JinjaCode>{'{{ variable_name }}'}</JinjaCode>{' '}
        to create placeholders that get filled in when the template is rendered:
      </p>
      <div className="mb-4">
        <CopyableCodeBlock jinja code={`Review this {{ language }} code for bugs and improvements:\n\n{{ code_to_review }}`} />
      </div>
      <p className="text-gray-600">
        Arguments are automatically detected from your template content — when you add or remove
        a <JinjaCode>{'{{ }}'}</JinjaCode> variable,
        the arguments list updates to match.
      </p>

      {/* Arguments */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Arguments</h2>
        <p className="text-gray-600 mb-3">
          Each argument has a name, optional description, and required flag:
        </p>
        <ul className="space-y-1.5 text-gray-600 mb-5">
          <li><strong>Name</strong> — valid Jinja2 identifier (lowercase, underscores). Must match the variable in the template.</li>
          <li><strong>Description</strong> — explains what value to provide. Shown to AI assistants via MCP.</li>
          <li><strong>Required</strong> — required arguments must be supplied at render time; optional ones default to empty string.</li>
        </ul>
        <InfoCallout variant="tip">
          Write clear argument descriptions — AI assistants see them when deciding what values
          to pass, so good descriptions lead to better results.
        </InfoCallout>
      </div>

      {/* Jinja2 Syntax */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Jinja2 Syntax</h2>
        <p className="text-gray-600 mb-6">
          Templates support the full Jinja2 syntax. Here are the most useful features:
        </p>

        <div className="space-y-6">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Variables</h3>
            <CopyableCodeBlock jinja code={`{{ variable_name }}`} />
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Conditionals</h3>
            <p className="text-gray-600 mb-2">
              Include sections only when an argument is provided:
            </p>
            <CopyableCodeBlock jinja code={`{% if context %}\nContext: {{ context }}\n{% endif %}`} />
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Whitespace Control</h3>
            <p className="text-gray-600 mb-2">
              Add a <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">-</code> to strip
              whitespace around blocks (keeps output clean when optional sections are empty):
            </p>
            <CopyableCodeBlock jinja code={`{%- if style_guide %}\nFollow this style guide: {{ style_guide }}\n{%- endif %}`} />
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Filters</h3>
            <p className="text-gray-600 mb-2">
              Transform values with pipe filters:
            </p>
            <CopyableCodeBlock jinja code={`{{ name | upper }}\n{{ items | join(", ") }}\n{{ text | default("No text provided") }}`} />
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Loops</h3>
            <CopyableCodeBlock jinja code={`{% for item in items %}\n- {{ item }}\n{% endfor %}`} />
          </div>
        </div>
      </div>

      {/* Editor Slash Commands */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Editor Slash Commands</h2>
        <p className="text-gray-600 mb-3">
          The prompt editor includes Jinja2-specific slash commands. Type{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">/</code> at the start of
          a line to see:
        </p>
        <ul className="space-y-1.5 text-gray-600">
          <li><strong>Variable</strong> — inserts <JinjaCode>{'{{ }}'}</JinjaCode></li>
          <li><strong>If block</strong> — inserts a conditional block</li>
          <li><strong>If block (trim)</strong> — inserts a conditional with whitespace trimming</li>
        </ul>
      </div>

      {/* Rendering */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Rendering</h2>
        <p className="text-gray-600 mb-3">
          Templates are rendered by supplying values for the arguments. This happens in two ways:
        </p>
        <ul className="space-y-1.5 text-gray-600 mb-5">
          <li>
            <strong>Via MCP</strong> — AI assistants fetch and render your templates through the
            Prompt MCP server. See{' '}
            <Link to="/docs/ai" className="text-[#d97b3d] hover:underline">AI Integration</Link>.
          </li>
          <li>
            <strong>Via API</strong> — call <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">POST /prompts/&#123;id&#125;/render</code> with
            argument values. See{' '}
            <Link to="/docs/api/prompts" className="text-[#d97b3d] hover:underline">API docs</Link>.
          </li>
        </ul>
        <InfoCallout variant="info">
          Templates use strict mode — referencing an undefined variable raises an error rather than
          silently producing empty output. This catches typos and missing arguments early.
        </InfoCallout>
      </div>

      {/* Agent Skills */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Agent Skills</h2>
        <p className="text-gray-600 mb-3">
          Prompts can be exported as <strong>agent skills</strong> — instruction files that AI
          assistants like Claude Code auto-invoke based on context. Tag a prompt with{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">skill</code> and sync
          it to your project to make it available as a slash command.
        </p>
        <p className="text-gray-600">
          See the{' '}
          <Link to="/docs/ai/claude-code" className="text-[#d97b3d] hover:underline">Claude Code</Link>{' '}
          or{' '}
          <Link to="/docs/ai/claude-desktop" className="text-[#d97b3d] hover:underline">Claude Desktop</Link>{' '}
          docs for setup instructions.
        </p>
      </div>
    </div>
  )
}
