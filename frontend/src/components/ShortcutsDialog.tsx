/**
 * Dialog showing available keyboard shortcuts.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ShortcutsDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when the dialog should close */
  onClose: () => void
}

/** Keyboard shortcut definition */
interface Shortcut {
  keys: string[]
  description: string
}

/** Shortcut group with title */
interface ShortcutGroup {
  title: string
  subtitle?: string
  shortcuts: Shortcut[]
}

// Left column groups: Actions, Navigation, View
const leftColumnGroups: ShortcutGroup[] = [
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['b'], description: 'New bookmark' },
      { keys: ['e'], description: 'Edit note (when viewing)' },
      { keys: ['\u2318', 'V'], description: 'Paste URL to add bookmark' },
      { keys: ['\u21E7', '\u2318', 'Click'], description: 'Open link without tracking' },
      { keys: ['\u2318', 'S'], description: 'Save' },
      { keys: ['\u2318', '\u21E7', 'S'], description: 'Save and close' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['/'], description: 'Focus search' },
      { keys: ['Esc'], description: 'Close modal / Unfocus search' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['w'], description: 'Toggle full-width layout' },
      { keys: ['\u2318', '\\'], description: 'Toggle sidebar' },
      { keys: ['\u2318', '/'], description: 'Show shortcuts' },
      { keys: ['\u2318', '\u21E7', 'M'], description: 'Toggle reading mode' },
      { keys: ['\u2325', 'Z'], description: 'Toggle word wrap' },
      { keys: ['\u2325', 'L'], description: 'Toggle line numbers' },
    ],
  },
]

// Right column: Markdown Editor formatting shortcuts
// Order matches toolbar layout in CodeMirrorEditor
const rightColumnGroups: ShortcutGroup[] = [
  {
    title: 'Markdown Editor',
    shortcuts: [
      // Text formatting (matches toolbar order)
      { keys: ['\u2318', 'B'], description: 'Bold' },
      { keys: ['\u2318', 'I'], description: 'Italic' },
      { keys: ['\u2318', '\u21E7', 'X'], description: 'Strikethrough' },
      { keys: ['\u2318', '\u21E7', 'H'], description: 'Highlight' },
      { keys: ['\u2318', '\u21E7', '.'], description: 'Blockquote' },
      // Code
      { keys: ['\u2318', 'E'], description: 'Inline code' },
      { keys: ['\u2318', '\u21E7', 'E'], description: 'Code block' },
      // Lists (Notion convention: 7=numbered, 8=bullet, 9=task)
      { keys: ['\u2318', '\u21E7', '8'], description: 'Bullet list' },
      { keys: ['\u2318', '\u21E7', '7'], description: 'Numbered list' },
      { keys: ['\u2318', '\u21E7', '9'], description: 'Task list' },
      // Links and other
      { keys: ['\u2318', 'K'], description: 'Insert link' },
      { keys: ['\u2318', '\u21E7', '-'], description: 'Horizontal rule' },
      { keys: ['\u2318', 'Click'], description: 'Open link in new tab' },
    ],
  },
]

/**
 * Renders a keyboard key badge.
 */
function KeyBadge({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700 shadow-sm">
      {children}
    </kbd>
  )
}

/**
 * Renders a group of shortcuts with a title.
 */
function ShortcutGroupSection({ group }: { group: ShortcutGroup }): ReactNode {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 border-t border-gray-100" />
        <div className="shrink-0 text-center">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            {group.title}
          </h3>
          {group.subtitle && (
            <p className="text-xs text-gray-400 normal-case">{group.subtitle}</p>
          )}
        </div>
        <div className="flex-1 border-t border-gray-100" />
      </div>
      <ul className="space-y-1.5">
        {group.shortcuts.map((shortcut, index) => (
          <li
            key={index}
            className="flex items-center justify-between py-1"
          >
            <span className="text-sm text-gray-700">{shortcut.description}</span>
            <div className="flex items-center gap-1">
              {shortcut.keys.map((key, keyIndex) => (
                <span key={keyIndex} className="flex items-center gap-1">
                  {keyIndex > 0 && (
                    <span className="text-xs text-gray-400">+</span>
                  )}
                  <KeyBadge>{key}</KeyBadge>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * ShortcutsDialog displays available keyboard shortcuts.
 *
 * Features:
 * - Lists all available shortcuts
 * - Closes on Escape or backdrop click
 * - Shows platform-appropriate modifier keys
 */
export function ShortcutsDialog({ isOpen, onClose }: ShortcutsDialogProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Handle escape key and body scroll
  useEffect(() => {
    if (!isOpen) return

    previousActiveElement.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }

    // Use capture phase so this handler runs before other document-level handlers
    // This ensures Escape closes only the dialog, not components behind it
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKeyDown, true)

      if (previousActiveElement.current) {
        previousActiveElement.current.focus()
      }
    }
  }, [isOpen, onClose])

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        ref={dialogRef}
        className="modal-content max-w-sm md:max-w-[720px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="shortcuts-title" className="text-base font-semibold text-gray-900">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Close dialog"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body - two columns on desktop, one on mobile */}
        <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {/* Left column: Actions, Navigation, View */}
          <div className="space-y-4">
            {leftColumnGroups.map((group) => (
              <ShortcutGroupSection key={group.title} group={group} />
            ))}
          </div>
          {/* Right column: Editor */}
          <div className="space-y-4">
            {rightColumnGroups.map((group) => (
              <ShortcutGroupSection key={group.title} group={group} />
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
