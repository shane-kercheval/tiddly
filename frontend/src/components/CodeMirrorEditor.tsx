/**
 * CodeMirror-based raw markdown editor.
 * Provides syntax highlighting and formatting shortcuts for markdown editing.
 *
 * This is the "Markdown" mode editor used by ContentEditor.
 * For WYSIWYG editing, see MilkdownEditor.
 */
import { useMemo, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap, EditorView } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { CopyToClipboardButton } from './ui/CopyToClipboardButton'

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
  /** Content for the copy button (if provided, copy button is shown) */
  copyContent?: string
  /** Show Jinja2 template tools in toolbar (for prompts) */
  showJinjaTools?: boolean
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
 * Toggle code block. If in code block, remove markers. Otherwise, wrap selection or insert empty block.
 */
function toggleCodeBlock(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)

  if (selectedText) {
    // Wrap selected text in code block
    view.dispatch({
      changes: { from, to, insert: `\`\`\`\n${selectedText}\n\`\`\`` },
      selection: { anchor: from + 4, head: from + 4 + selectedText.length },
    })
  } else {
    // Insert empty code block and place cursor inside
    view.dispatch({
      changes: { from, insert: '```\n\n```' },
      selection: { anchor: from + 4 },
    })
  }
  return true
}

/**
 * Add or toggle a prefix on selected lines.
 */
function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)

  const changes: { from: number; to: number; insert: string }[] = []
  let newSelectionStart = from
  let newSelectionEnd = to

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum)
    const lineText = line.text

    if (lineText.startsWith(prefix)) {
      // Remove prefix
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      if (lineNum === startLine.number) newSelectionStart -= prefix.length
      newSelectionEnd -= prefix.length
    } else {
      // Add prefix
      changes.push({ from: line.from, to: line.from, insert: prefix })
      if (lineNum === startLine.number) newSelectionStart += prefix.length
      newSelectionEnd += prefix.length
    }
  }

  view.dispatch({
    changes,
    selection: { anchor: Math.max(0, newSelectionStart), head: newSelectionEnd },
  })
  return true
}

/**
 * Insert a horizontal rule.
 */
function insertHorizontalRule(view: EditorView): boolean {
  const { state } = view
  const { from } = state.selection.main
  const line = state.doc.lineAt(from)

  // Insert at end of current line with newlines
  const insert = line.text.length > 0 ? '\n\n---\n' : '---\n'
  const insertPos = line.text.length > 0 ? line.to : from

  view.dispatch({
    changes: { from: insertPos, insert },
    selection: { anchor: insertPos + insert.length },
  })
  return true
}

/**
 * Insert text at cursor position.
 */
function insertText(view: EditorView, text: string): boolean {
  const { from } = view.state.selection.main
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  })
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
 * Toolbar button for CodeMirror editor.
 */
interface ToolbarButtonProps {
  onClick: () => void
  title: string
  children: ReactNode
}

function ToolbarButton({ onClick, title, children }: ToolbarButtonProps): ReactNode {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault() // Prevent focus loss
        onClick()
      }}
      title={title}
      className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
    >
      {children}
    </button>
  )
}

/**
 * Toolbar separator for visual grouping.
 */
function ToolbarSeparator(): ReactNode {
  return <div className="w-px h-5 bg-gray-200 mx-1" />
}

/**
 * CodeMirrorEditor provides a raw markdown editor with syntax highlighting.
 *
 * Features:
 * - CodeMirror editor with markdown syntax highlighting
 * - Formatting toolbar with buttons for common markdown operations
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
  copyContent,
  showJinjaTools = false,
}: CodeMirrorEditorProps): ReactNode {
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  // Get the EditorView from ref
  const getView = useCallback((): EditorView | undefined => {
    return editorRef.current?.view
  }, [])

  // Toolbar action handlers
  const handleBold = useCallback(() => {
    const view = getView()
    if (view) {
      wrapWithMarkers(view, '**', '**')
      view.focus()
    }
  }, [getView])

  const handleItalic = useCallback(() => {
    const view = getView()
    if (view) {
      wrapWithMarkers(view, '*', '*')
      view.focus()
    }
  }, [getView])

  const handleStrikethrough = useCallback(() => {
    const view = getView()
    if (view) {
      wrapWithMarkers(view, '~~', '~~')
      view.focus()
    }
  }, [getView])

  const handleInlineCode = useCallback(() => {
    const view = getView()
    if (view) {
      wrapWithMarkers(view, '`', '`')
      view.focus()
    }
  }, [getView])

  const handleCodeBlock = useCallback(() => {
    const view = getView()
    if (view) {
      toggleCodeBlock(view)
      view.focus()
    }
  }, [getView])

  const handleLink = useCallback(() => {
    const view = getView()
    if (view) {
      insertLink(view)
      view.focus()
    }
  }, [getView])

  const handleBulletList = useCallback(() => {
    const view = getView()
    if (view) {
      toggleLinePrefix(view, '- ')
      view.focus()
    }
  }, [getView])

  const handleOrderedList = useCallback(() => {
    const view = getView()
    if (view) {
      toggleLinePrefix(view, '1. ')
      view.focus()
    }
  }, [getView])

  const handleTaskList = useCallback(() => {
    const view = getView()
    if (view) {
      toggleLinePrefix(view, '- [ ] ')
      view.focus()
    }
  }, [getView])

  const handleBlockquote = useCallback(() => {
    const view = getView()
    if (view) {
      toggleLinePrefix(view, '> ')
      view.focus()
    }
  }, [getView])

  const handleHorizontalRule = useCallback(() => {
    const view = getView()
    if (view) {
      insertHorizontalRule(view)
      view.focus()
    }
  }, [getView])

  const handleInsertText = useCallback((text: string) => {
    const view = getView()
    if (view) {
      insertText(view, text)
      view.focus()
    }
  }, [getView])

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
      {/* Toolbar - formatting buttons fade in, copy button always visible */}
      {!disabled && (
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-solid border-transparent group-focus-within/editor:border-gray-200 bg-transparent group-focus-within/editor:bg-gray-50/50 transition-colors">
          {/* Left: formatting buttons that fade in */}
          <div className="flex items-center gap-0.5 opacity-0 group-focus-within/editor:opacity-100 transition-opacity">
            {/* Text formatting */}
            <ToolbarButton onClick={handleBold} title="Bold (⌘B)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={handleItalic} title="Italic (⌘I)">
              <span className="w-4 h-4 flex items-center justify-center text-[17px] font-serif italic">I</span>
            </ToolbarButton>
            <ToolbarButton onClick={handleStrikethrough} title="Strikethrough (⌘⇧X)">
              <span className="w-4 h-4 flex items-center justify-center text-[17px] line-through">S</span>
            </ToolbarButton>
            <ToolbarButton onClick={handleInlineCode} title="Inline Code">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={handleCodeBlock} title="Code Block">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h6" />
              </svg>
            </ToolbarButton>

            <ToolbarSeparator />

            {/* Link */}
            <ToolbarButton onClick={handleLink} title="Insert Link (⌘K)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </ToolbarButton>

            <ToolbarSeparator />

            {/* Lists */}
            <ToolbarButton onClick={handleBulletList} title="Bullet List">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h12M8 12h12M8 18h12" />
                <circle cx="3" cy="6" r="2" fill="currentColor" />
                <circle cx="3" cy="12" r="2" fill="currentColor" />
                <circle cx="3" cy="18" r="2" fill="currentColor" />
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={handleOrderedList} title="Numbered List">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h12M8 12h12M8 18h12" />
                <text x="1" y="8" fontSize="7" fill="currentColor" fontWeight="bold">1</text>
                <text x="1" y="14" fontSize="7" fill="currentColor" fontWeight="bold">2</text>
                <text x="1" y="20" fontSize="7" fill="currentColor" fontWeight="bold">3</text>
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={handleTaskList} title="Task List">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="5" width="14" height="14" rx="2" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12l3 3 5-5" />
              </svg>
            </ToolbarButton>

            <ToolbarSeparator />

            {/* Block elements */}
            <ToolbarButton onClick={handleBlockquote} title="Blockquote">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={handleHorizontalRule} title="Horizontal Rule">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
              </svg>
            </ToolbarButton>

            {/* Jinja2 template tools (for prompts) */}
            {showJinjaTools && (
              <>
                <ToolbarSeparator />
                <ToolbarButton onClick={() => handleInsertText('{{ variable }}')} title="Insert Variable {{ }}">
                  <span className="w-4 h-4 flex items-center justify-center text-[11px] font-mono font-bold">{'{}'}</span>
                </ToolbarButton>
                <ToolbarButton onClick={() => handleInsertText('{% if variable %}\n\n{% endif %}')} title="If Block {% if %}">
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-mono font-bold">if</span>
                </ToolbarButton>
                <ToolbarButton onClick={() => handleInsertText('{%- if variable %}\n\n{%- endif %}')} title="If Block with Whitespace Trim {%- if %}">
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-mono font-bold">if-</span>
                </ToolbarButton>
              </>
            )}
          </div>

          {/* Right: copy button - always visible */}
          {copyContent !== undefined && (
            <CopyToClipboardButton content={copyContent} title="Copy content" />
          )}
        </div>
      )}
      <CodeMirror
        ref={editorRef}
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
