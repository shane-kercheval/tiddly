/**
 * Shared toolbar icons and components for editor toolbars.
 * Used by both MilkdownEditor and CodeMirrorEditor to ensure consistent styling.
 */
import type { ReactNode } from 'react'

/**
 * Toolbar separator for visual grouping between button groups.
 * Hidden on mobile (< md) where toolbar wraps and separators add clutter.
 */
export function ToolbarSeparator(): ReactNode {
  return <div className="hidden md:block w-px h-5 bg-gray-200 mx-1" />
}

// Toolbar icon components with consistent sizing (w-4 h-4)

export function BoldIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
    </svg>
  )
}

export function ItalicIcon(): ReactNode {
  return <span className="w-4 h-4 flex items-center justify-center text-[17px] font-serif italic">I</span>
}

export function StrikethroughIcon(): ReactNode {
  return <span className="w-4 h-4 flex items-center justify-center text-[17px] line-through">S</span>
}

export function HighlightIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h7" fill="#fef3c7" />
    </svg>
  )
}

export function InlineCodeIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  )
}

export function CodeBlockIcon(): ReactNode {
  // Curly braces representing a code block - more intuitive than text lines
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4c-2 0-3 1-3 3v3c0 1.5-1 2-2 2 1 0 2 .5 2 2v3c0 2 1 3 3 3M16 4c2 0 3 1 3 3v3c0 1.5 1 2 2 2-1 0-2 .5-2 2v3c0 2-1 3-3 3" />
    </svg>
  )
}

export function LinkIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  )
}

export function BulletListIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="3" cy="6" r="2" fill="currentColor" />
      <circle cx="3" cy="12" r="2" fill="currentColor" />
      <circle cx="3" cy="18" r="2" fill="currentColor" />
    </svg>
  )
}

export function OrderedListIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h12M8 12h12M8 18h12" />
      <text x="1" y="8" fontSize="7" fill="currentColor" fontWeight="bold">1</text>
      <text x="1" y="14" fontSize="7" fill="currentColor" fontWeight="bold">2</text>
      <text x="1" y="20" fontSize="7" fill="currentColor" fontWeight="bold">3</text>
    </svg>
  )
}

export function TaskListIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="5" width="14" height="14" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12l3 3 5-5" />
    </svg>
  )
}

export function BlockquoteIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
    </svg>
  )
}

export function HorizontalRuleIcon(): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
    </svg>
  )
}

export function JinjaVariableIcon(): ReactNode {
  return <span className="w-4 h-4 flex items-center justify-center text-[11px] font-mono font-bold">{'{}'}</span>
}

export function JinjaIfIcon(): ReactNode {
  return <span className="w-4 h-4 flex items-center justify-center text-[10px] font-mono font-bold">if</span>
}

export function JinjaIfTrimIcon(): ReactNode {
  return <span className="w-4 h-4 flex items-center justify-center text-[10px] font-mono font-bold">if-</span>
}

// Toggle icons for editor settings

export function WrapIcon(): ReactNode {
  // Line that wraps around with arrow
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h12a4 4 0 014 4 4 4 0 01-4 4H9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12l-3 3 3 3" />
    </svg>
  )
}

export function LineNumbersIcon(): ReactNode {
  // Hash/number symbol representing line numbers
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
    </svg>
  )
}

export function ReadingIcon(): ReactNode {
  // Eye icon for reading/preview mode
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}
