/**
 * CodeMirror-based plain text editor.
 * Provides syntax highlighting and formatting shortcuts for markdown editing.
 *
 * This is the main editor used by ContentEditor.
 * Includes optional "Reading" mode that shows read-only Milkdown preview.
 */
import { useMemo, useRef, useCallback, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap, EditorView } from '@codemirror/view'
import { markdownStyleExtension } from '../utils/markdownStyleExtension'
import type { KeyBinding } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { CopyToClipboardButton } from './ui/CopyToClipboardButton'
import { MilkdownEditor } from './MilkdownEditor'
import {
  ToolbarSeparator,
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  HighlightIcon,
  InlineCodeIcon,
  CodeBlockIcon,
  LinkIcon,
  BulletListIcon,
  OrderedListIcon,
  TaskListIcon,
  BlockquoteIcon,
  HorizontalRuleIcon,
  JinjaVariableIcon,
  JinjaIfIcon,
  JinjaIfTrimIcon,
} from './editor/EditorToolbarIcons'
import { JINJA_VARIABLE, JINJA_IF_BLOCK, JINJA_IF_BLOCK_TRIM } from './editor/jinjaTemplates'
import { wasEditorFocused } from '../utils/editorUtils'

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
  /** Called when wrap text preference changes */
  onWrapTextChange?: (wrap: boolean) => void
  /** Remove padding to align text with other elements */
  noPadding?: boolean
  /** Whether to auto-focus on mount */
  autoFocus?: boolean
  /** Content for the copy button (if provided, copy button is shown) */
  copyContent?: string
  /** Show Jinja2 template tools in toolbar (for prompts) */
  showJinjaTools?: boolean
  /** Called when a modal opens/closes (for beforeunload handlers) */
  onModalStateChange?: (isOpen: boolean) => void
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
 * Insert a code block. Wraps selection in fenced code block markers, or inserts empty block at cursor.
 * Note: This inserts only; it does not detect/remove existing code blocks (that would require parsing).
 */
function insertCodeBlock(view: EditorView): boolean {
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
 *
 * This enables shortcuts like Cmd+/ (help modal) and Cmd+\ (sidebar toggle)
 * to work when the CodeMirror editor has focus. The events bubble up to
 * document-level listeners in the parent components.
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
    { key: 'Mod-Shift-h', run: (view) => wrapWithMarkers(view, '==', '==') },
    { key: 'Mod-Shift-7', run: (view) => toggleLinePrefix(view, '- [ ] ') },
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
 *
 * Uses wasEditorFocused() guard to prevent clicks on invisible buttons.
 * When the toolbar is hidden (opacity-0), clicking where a button would be
 * should just focus the editor and reveal the toolbar, not trigger the action.
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
        if (wasEditorFocused(e.currentTarget)) {
          // Editor was focused (toolbar visible) - execute action
          e.preventDefault()
          onClick()
        }
        // If editor wasn't focused, let the click naturally focus the editor
        // which will reveal the toolbar (but won't execute the action)
      }}
      title={title}
      className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
    >
      {children}
    </button>
  )
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
  onWrapTextChange,
  noPadding = false,
  autoFocus = false,
  copyContent,
  showJinjaTools = false,
  onModalStateChange: _onModalStateChange, // eslint-disable-line @typescript-eslint/no-unused-vars
}: CodeMirrorEditorProps): ReactNode {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reading mode state (local, not persisted)
  const [readingMode, setReadingMode] = useState(false)

  // Store scroll position when toggling modes to preserve reading position
  const scrollPositionRef = useRef<number>(0)

  // Toggle reading mode with scroll position preservation
  const toggleReadingMode = useCallback((): void => {
    if (!readingMode) {
      // Switching TO reading mode - save scroll position
      const scroller = containerRef.current?.querySelector('.cm-scroller')
      if (scroller) {
        scrollPositionRef.current = scroller.scrollTop
      }
    }
    setReadingMode((prev) => !prev)
  }, [readingMode])

  // Restore scroll position when switching back from reading mode
  useEffect(() => {
    if (!readingMode && scrollPositionRef.current > 0) {
      // Switching FROM reading mode - restore scroll position
      // Use requestAnimationFrame to ensure CodeMirror has rendered
      requestAnimationFrame(() => {
        const scroller = containerRef.current?.querySelector('.cm-scroller')
        if (scroller) {
          scroller.scrollTop = scrollPositionRef.current
        }
      })
    }
  }, [readingMode])

  // Derive effective reading mode - disabled editor can't be in reading mode
  // This prevents user from being stuck in reading mode when disabled
  const effectiveReadingMode = readingMode && !disabled

  // Keyboard shortcuts for editor
  // Uses capture phase to intercept before macOS converts to special character (Ω for Alt+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isMod = e.metaKey || e.ctrlKey

      // Cmd+Shift+M - toggle reading mode
      if (isMod && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault()
        e.stopPropagation()
        toggleReadingMode()
        return
      }

      // Option+Z (Alt+Z) - toggle word wrap (only when not in reading mode)
      // Uses e.code which is independent of keyboard layout
      if (e.altKey && e.code === 'KeyZ' && !effectiveReadingMode && onWrapTextChange) {
        e.preventDefault()
        e.stopPropagation()
        onWrapTextChange(!wrapText)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [toggleReadingMode, effectiveReadingMode, wrapText, onWrapTextChange])

  // Get the EditorView from ref
  const getView = useCallback((): EditorView | undefined => {
    return editorRef.current?.view
  }, [])

  /**
   * Run an action on the editor view, then refocus.
   * Centralizes the common pattern of: get view -> run action -> focus.
   */
  const runAction = useCallback((action: (view: EditorView) => boolean): void => {
    const view = getView()
    if (view) {
      action(view)
      view.focus()
    }
  }, [getView])

  // Semi-controlled mode: pass value for initial render, ignore prop updates after mount.
  // This works around a Safari bug in @uiw/react-codemirror where content disappears
  // after fast typing then pausing (controlled value sync issue).
  // See: https://github.com/uiwjs/react-codemirror/issues/694
  //
  // How it works:
  // - useState(value) captures the initial value once on mount
  // - User edits flow through onChange, keeping parent state in sync
  // - Subsequent value prop changes are ignored (initialValue never updates)
  //
  // This is safe because:
  // - Document switching uses key prop (e.g., key={note?.id}) which forces remount
  // - On remount, useState captures the new document's content fresh
  // - There's no feature that programmatically changes content mid-edit
  //
  // If programmatic content changes were needed, options would be:
  // - Change the key prop to force remount
  // - Use imperative ref to dispatch changes directly to CodeMirror
  const [initialValue] = useState(value)

  // Build extensions array with optional line wrapping and keybindings
  const extensions = useMemo(() => {
    const bindings = createMarkdownKeyBindings()
    const exts = [
      markdown(),
      Prec.highest(keymap.of(bindings)),
      markdownStyleExtension,
    ]
    if (wrapText) {
      exts.push(EditorView.lineWrapping)
    }
    return exts
  }, [wrapText])

  return (
    <div ref={containerRef} className={noPadding ? 'codemirror-no-padding' : ''}>
      {/* Toolbar - formatting buttons fade in on focus, copy button stays visible (doesn't fade) */}
      {/* Always render toolbar to prevent layout shift; buttons are disabled when editor is disabled */}
      {/* min-h and transform-gpu prevent Safari reflow issues during focus/blur transitions */}
      <div className="flex items-center justify-between px-2 py-1.5 min-h-[38px] transform-gpu border-b border-solid border-transparent group-focus-within/editor:border-gray-200 bg-transparent group-focus-within/editor:bg-gray-50/50 transition-colors">
        {/* Left: formatting buttons that fade in on focus */}
        <div className={`flex items-center gap-0.5 opacity-0 group-focus-within/editor:opacity-100 transition-opacity ${disabled ? 'pointer-events-none' : ''}`}>
          {/* Text formatting */}
          <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '**', '**'))} title="Bold (⌘B)">
            <BoldIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '*', '*'))} title="Italic (⌘I)">
            <ItalicIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '~~', '~~'))} title="Strikethrough (⌘⇧X)">
            <StrikethroughIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '==', '=='))} title="Highlight (⌘⇧H)">
            <HighlightIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '`', '`'))} title="Inline Code">
            <InlineCodeIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction(insertCodeBlock)} title="Code Block">
            <CodeBlockIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Link */}
          <ToolbarButton onClick={() => runAction(insertLink)} title="Insert Link (⌘K)">
            <LinkIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Lists */}
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, '- '))} title="Bullet List">
            <BulletListIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, '1. '))} title="Numbered List">
            <OrderedListIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, '- [ ] '))} title="Task List (⌘⇧7)">
            <TaskListIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Block elements */}
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, '> '))} title="Blockquote">
            <BlockquoteIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction(insertHorizontalRule)} title="Horizontal Rule">
            <HorizontalRuleIcon />
          </ToolbarButton>

          {/* Jinja2 template tools (for prompts) */}
          {showJinjaTools && (
            <>
              <ToolbarSeparator />
              <ToolbarButton onClick={() => runAction((v) => insertText(v, JINJA_VARIABLE))} title="Insert Variable {{ }}">
                <JinjaVariableIcon />
              </ToolbarButton>
              <ToolbarButton onClick={() => runAction((v) => insertText(v, JINJA_IF_BLOCK))} title="If Block {% if %}">
                <JinjaIfIcon />
              </ToolbarButton>
              <ToolbarButton onClick={() => runAction((v) => insertText(v, JINJA_IF_BLOCK_TRIM))} title="If Block with Whitespace Trim {%- if %}">
                <JinjaIfTrimIcon />
              </ToolbarButton>
            </>
          )}
        </div>

        {/* Right: Wrap (fades in), Reading and Copy (always visible) */}
        <div className="flex items-center gap-2">
          {/* Wrap toggle - fades in on focus, only shown when not in reading mode */}
          {onWrapTextChange && !effectiveReadingMode && (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onMouseDown={(e) => {
                if (!disabled && wasEditorFocused(e.currentTarget)) {
                  e.preventDefault()
                  onWrapTextChange(!wrapText)
                }
              }}
              title="Toggle word wrap (⌥Z)"
              className={`text-xs px-2 py-0.5 rounded transition-all opacity-0 group-focus-within/editor:opacity-100 ${
                wrapText
                  ? 'bg-gray-200 text-gray-700'
                  : 'border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              } ${disabled ? 'cursor-not-allowed' : ''}`}
            >
              Wrap
            </button>
          )}

          {/* Reading mode toggle - always visible */}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onMouseDown={(e) => {
              if (!disabled) {
                e.preventDefault()
                toggleReadingMode()
              }
            }}
            title="Toggle reading mode (⌘⇧M)"
            className={`text-xs px-2 py-0.5 rounded transition-all ${
              effectiveReadingMode
                ? 'bg-gray-200 text-gray-700'
                : 'border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            Reading
          </button>

          {/* Copy button - always visible but disabled when editor is disabled */}
          {copyContent !== undefined && (
            <CopyToClipboardButton content={copyContent} title="Copy content" disabled={disabled} />
          )}
        </div>
      </div>
      {/* Show CodeMirror for editing, Milkdown for reading */}
      {effectiveReadingMode ? (
        <MilkdownEditor
          value={value}
          onChange={() => {}} // Read-only: ignore changes
          disabled={false}
          readOnly={true}
          minHeight={minHeight}
          placeholder={placeholder}
          noPadding={noPadding}
        />
      ) : (
        <CodeMirror
          ref={editorRef}
          value={initialValue}
          onChange={onChange}
          extensions={extensions}
          minHeight={minHeight}
          placeholder={placeholder}
          editable={!disabled}
          autoFocus={autoFocus}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
          }}
          className="text-sm"
        />
      )}
    </div>
  )
}
