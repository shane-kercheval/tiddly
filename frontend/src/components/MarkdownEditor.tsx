/**
 * Reusable markdown editor component with edit/preview toggle.
 * Uses CodeMirror for editing and ReactMarkdown for preview.
 */
import { useState, useRef } from 'react'
import type { ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
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
 * CodeMirror keybindings for markdown formatting.
 * For global shortcuts, we consume the event (return true) to prevent
 * CodeMirror's default handling, then dispatch to global handlers.
 */
const markdownKeyBindings: KeyBinding[] = [
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

/**
 * MarkdownEditor provides a CodeMirror-based markdown editor with preview toggle.
 *
 * Features:
 * - CodeMirror editor with markdown syntax highlighting
 * - Preview mode with rendered markdown
 * - Keyboard shortcuts for formatting (Cmd+B, Cmd+I, Cmd+K)
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
}: MarkdownEditorProps): ReactNode {
  const [showPreview, setShowPreview] = useState(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor="content" className="label">
          {label}
        </label>
        <div className="flex items-center gap-2">
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

      {showPreview ? (
        <div
          className="border border-gray-200 rounded-lg p-4 bg-white flex-1 overflow-y-auto"
          style={{ minHeight }}
        >
          {value ? (
            <div className="prose prose-gray max-w-none">
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
      ) : (
        <div
          ref={editorContainerRef}
          className={`border rounded-lg overflow-hidden flex-1 ${hasError ? 'border-red-300' : 'border-gray-200'}`}
        >
          <CodeMirror
            value={value}
            onChange={onChange}
            extensions={[markdown(), Prec.highest(keymap.of(markdownKeyBindings))]}
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
    <div className="prose prose-gray max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
