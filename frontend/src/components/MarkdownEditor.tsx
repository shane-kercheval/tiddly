/**
 * Reusable markdown editor component with edit/preview toggle.
 * Uses CodeMirror for editing and ReactMarkdown for preview.
 */
import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap, EditorView } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

interface MarkdownEditorProps {
  /** Current content value */
  value: string
  /** Called when content changes */
  onChange: (value: string) => void
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Whether there's an error */
  hasError?: boolean
  /** Minimum height for the editor */
  minHeight?: string
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Helper text shown below the editor */
  helperText?: string
  /** Label for the field */
  label?: string
  /** Maximum content length for counter */
  maxLength?: number
  /** Error message to display */
  errorMessage?: string
  /** Whether to wrap long lines (default: false) */
  wrapText?: boolean
  /** Called when wrap text setting changes */
  onWrapTextChange?: (wrap: boolean) => void
}

/**
 * Wrap selected text with markdown markers.
 * If no selection, insert markers and place cursor between them.
 */
function wrapWithMarkers(view: EditorView, before: string, after: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)

  if (selectedText) {
    // Wrap selected text
    view.dispatch({
      changes: { from, to, insert: `${before}${selectedText}${after}` },
      selection: { anchor: from + before.length, head: to + before.length },
    })
  } else {
    // No selection - insert markers and place cursor between them
    view.dispatch({
      changes: { from, insert: `${before}${after}` },
      selection: { anchor: from + before.length },
    })
  }
  return true
}

/**
 * Insert a markdown link. If text is selected, use it as the link text.
 */
function insertLink(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)

  if (selectedText) {
    // Use selected text as link text, place cursor in URL position
    const linkText = `[${selectedText}](url)`
    view.dispatch({
      changes: { from, to, insert: linkText },
      selection: { anchor: from + selectedText.length + 3, head: from + selectedText.length + 6 },
    })
  } else {
    // Insert empty link template, place cursor in text position
    view.dispatch({
      changes: { from, insert: '[text](url)' },
      selection: { anchor: from + 1, head: from + 5 },
    })
  }
  return true
}

/**
 * Dispatch a keyboard event to the document for global handlers to catch.
 * Used to pass shortcuts through from CodeMirror to global handlers.
 */
function dispatchGlobalShortcut(key: string, metaKey: boolean): void {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey,
    ctrlKey: !metaKey, // Use ctrlKey on non-Mac
    bubbles: true,
  })
  document.dispatchEvent(event)
}

/**
 * Create CodeMirror keybindings for markdown formatting.
 * Includes optional wrap toggle shortcut (Alt+Z, matching VS Code).
 */
function createMarkdownKeyBindings(onToggleWrap?: () => void): KeyBinding[] {
  const bindings: KeyBinding[] = [
    // Formatting shortcuts
    { key: 'Mod-b', run: (view) => wrapWithMarkers(view, '**', '**') },
    { key: 'Mod-i', run: (view) => wrapWithMarkers(view, '*', '*') },
    { key: 'Mod-k', run: (view) => insertLink(view) },
    { key: 'Mod-Shift-x', run: (view) => wrapWithMarkers(view, '~~', '~~') },
    // Pass through to global handlers (consume event, then dispatch globally)
    {
      key: 'Mod-/',
      run: () => {
        dispatchGlobalShortcut('/', true)
        return true // Consume to prevent CodeMirror's comment toggle
      },
    },
    {
      key: 'Mod-\\',
      run: () => {
        dispatchGlobalShortcut('\\', true)
        return true
      },
    },
  ]

  // Add wrap toggle shortcut if callback provided (Alt+Z, like VS Code)
  if (onToggleWrap) {
    bindings.push({
      key: 'Alt-z',
      run: () => {
        onToggleWrap()
        return true
      },
    })
  }

  return bindings
}

/**
 * MarkdownEditor provides a CodeMirror-based markdown editor with preview toggle.
 *
 * Features:
 * - CodeMirror editor with markdown syntax highlighting
 * - Preview mode with rendered markdown (editor stays mounted to preserve undo history)
 * - Keyboard shortcuts for formatting (Cmd+B, Cmd+I, Cmd+K)
 * - Optional text wrapping
 * - Character counter
 * - Error state styling
 */
export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  hasError = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  helperText = 'Supports Markdown: **bold**, *italic*, `code`, [links](url), lists, tables, etc.',
  label = 'Content',
  maxLength,
  errorMessage,
  wrapText = false,
  onWrapTextChange,
}: MarkdownEditorProps): ReactNode {
  const [showPreview, setShowPreview] = useState(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Toggle wrap callback for keyboard shortcut
  const handleToggleWrap = useCallback(() => {
    onWrapTextChange?.(!wrapText)
  }, [onWrapTextChange, wrapText])

  // Global keyboard handler for Alt+Z (Option+Z on Mac) to toggle wrap
  // Uses capture phase to intercept before macOS converts to special character (Ω)
  useEffect(() => {
    if (!onWrapTextChange) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      // Alt+Z (Option+Z on Mac) - toggle word wrap
      // Check both 'z' and 'Ω' (the character macOS produces with Option+Z)
      if (e.altKey && (e.key.toLowerCase() === 'z' || e.key === 'Ω' || e.code === 'KeyZ')) {
        e.preventDefault()
        e.stopPropagation()
        handleToggleWrap()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true) // capture phase
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onWrapTextChange, handleToggleWrap])

  // Build extensions array with optional line wrapping and keybindings
  const extensions = useMemo(() => {
    const bindings = createMarkdownKeyBindings()
    const exts = [markdown(), Prec.highest(keymap.of(bindings))]
    if (wrapText) {
      exts.push(EditorView.lineWrapping)
    }
    return exts
  }, [wrapText])

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor="content" className="label">
          {label}
        </label>
        <div className="flex items-center gap-2">
          {onWrapTextChange && (
            <label
              className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mr-2"
              title="Toggle word wrap (⌥Z)"
            >
              <input
                type="checkbox"
                checked={wrapText}
                onChange={(e) => onWrapTextChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-gray-600 focus:ring-gray-500/20"
              />
              Wrap
            </label>
          )}
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className={`text-sm px-2 py-1 rounded ${
              !showPreview
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className={`text-sm px-2 py-1 rounded ${
              showPreview
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {/* Editor - always mounted to preserve undo history */}
      <div
        ref={editorContainerRef}
        className={`border rounded-lg overflow-hidden flex-1 ${hasError ? 'border-red-300' : 'border-gray-200'} ${showPreview ? 'hidden' : ''}`}
      >
        <CodeMirror
          value={value}
          onChange={onChange}
          extensions={extensions}
          minHeight={minHeight}
          placeholder={placeholder}
          editable={!disabled}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: true,
          }}
          className="text-sm"
        />
      </div>

      {/* Preview - only rendered when active */}
      {showPreview && (
        <div
          className="border border-gray-200 rounded-lg p-4 bg-white flex-1 overflow-y-auto"
          style={{ minHeight }}
        >
          {value ? (
            <div className="prose prose-sm prose-gray max-w-none [&>p]:text-[15px] [&>ul]:text-[15px] [&>ol]:text-[15px]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
              >
                {value}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-gray-400 italic">No content to preview</p>
          )}
        </div>
      )}

      <div className="flex justify-between items-center mt-1">
        {errorMessage ? (
          <p className="error-text">{errorMessage}</p>
        ) : (
          <p className="helper-text">{helperText}</p>
        )}
        {maxLength && (
          <span className="helper-text">
            {value.length.toLocaleString()}/{maxLength.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * MarkdownViewer renders markdown content in view mode.
 * Used for displaying content in view-only contexts.
 */
interface MarkdownViewerProps {
  /** Markdown content to render */
  content: string | null | undefined
  /** Fallback text when content is empty */
  emptyText?: string
}

export function MarkdownViewer({
  content,
  emptyText = 'No content',
}: MarkdownViewerProps): ReactNode {
  if (!content) {
    return <p className="text-gray-400 italic">{emptyText}</p>
  }

  return (
    <div className="prose prose-sm prose-gray max-w-none [&>p]:text-[15px] [&>ul]:text-[15px] [&>ol]:text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
