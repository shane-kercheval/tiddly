/**
 * Shared keyboard-key chip used by tip surfaces.
 *
 * Extracted from `TipCard` so both `TipCard` (chip row) and `TipBody` (inline
 * shortcut tokens) render with identical styling.
 */
import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
      {children}
    </kbd>
  )
}
