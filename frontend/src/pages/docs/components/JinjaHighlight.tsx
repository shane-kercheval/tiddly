import type { ReactNode } from 'react'
import { highlightJinja } from './jinjaHighlightUtils'

/**
 * Inline code element styled with Jinja2 variable colors (prompt brand orange).
 * Use for inline references like {{ variable_name }}.
 */
export function JinjaCode({ children }: { children: string }): ReactNode {
  return (
    <code className="rounded px-1.5 py-0.5 text-sm" style={{ backgroundColor: 'rgba(226, 166, 107, 0.1)' }}>
      {highlightJinja(children)}
    </code>
  )
}
