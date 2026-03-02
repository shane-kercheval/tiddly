import { useState } from 'react'
import type { ReactNode } from 'react'
import { highlightJinja } from './JinjaHighlight'

interface CopyableCodeBlockProps {
  code: string
  language?: string
  /** When true, highlights Jinja2 syntax ({{ }}, {% %}, {# #}) with editor colors. */
  jinja?: boolean
}

/**
 * Pre-formatted code block with copy-to-clipboard button.
 * Uses light theme consistent with docs styling.
 */
export function CopyableCodeBlock({ code, jinja }: CopyableCodeBlockProps): ReactNode {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="relative">
      <pre className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap break-all overflow-x-auto pr-16">
        <code>{jinja ? highlightJinja(code) : code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className={`absolute top-2 right-2 rounded px-2 py-1 text-xs transition-colors ${
          copied
            ? 'bg-green-600 text-white'
            : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
        }`}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
