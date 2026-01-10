/**
 * CodeMirror-based raw markdown editor.
 * Provides syntax highlighting and formatting shortcuts for markdown editing.
 *
 * This is the "Markdown" mode editor used by ContentEditor.
 * For WYSIWYG editing, see MilkdownEditor.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap, EditorView } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'
import { Prec } from '@codemirror/state'

interface CodeMirrorEditorProps {
  /** Current content value */
  value: string
  /** Called when content changes */
  onChange: (value: string) => void
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Minimum height for the editor */
  minHeight?: string
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Whether to wrap long lines */
  wrapText?: boolean
  /** Remove padding to align text with other elements */
  noPadding?: boolean
  /** Whether to auto-focus on mount */
  autoFocus?: boolean
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
 */
function createMarkdownKeyBindings(): KeyBinding[] {
  return [
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
}

/**
 * CodeMirrorEditor provides a raw markdown editor with syntax highlighting.
 *
 * Features:
 * - CodeMirror editor with markdown syntax highlighting
 * - Keyboard shortcuts for formatting (Cmd+B, Cmd+I, Cmd+K, Cmd+Shift+X)
 * - Optional text wrapping
 */
export function CodeMirrorEditor({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  wrapText = false,
  noPadding = false,
  autoFocus = false,
}: CodeMirrorEditorProps): ReactNode {
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
    <div className={noPadding ? 'codemirror-no-padding' : ''}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        minHeight={minHeight}
        placeholder={placeholder}
        editable={!disabled}
        autoFocus={autoFocus}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: true,
        }}
        className="text-sm"
      />
    </div>
  )
}
