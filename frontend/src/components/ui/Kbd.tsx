/**
 * Shared keyboard-key chip rendered as a single `<kbd>` element.
 *
 * Used by every surface that displays a chip-row shortcut: the docs shortcuts
 * page, tip cards, the tip body inline-token renderer, and the tip-detail
 * palette sub-view. CommandPalette's inline shortcut hint (lighter, smaller,
 * tucked into a one-line command row) is intentionally a different visual
 * treatment — it stays as a local `<kbd>` until a second inline caller emerges.
 */
import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
      {children}
    </kbd>
  )
}
