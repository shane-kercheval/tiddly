/**
 * CodeMirror-based plain text editor.
 * Provides syntax highlighting and formatting shortcuts for markdown editing.
 *
 * This is the "Text" mode editor used by ContentEditor.
 * For rich markdown editing, see MilkdownEditor.
 */
import { useMemo, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap, EditorView } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { CopyToClipboardButton } from './ui/CopyToClipboardButton'
import {
  ToolbarSeparator,
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
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
 * Note: Unlike MilkdownEditor's ToolbarButton, this always executes the action
 * on mousedown. MilkdownEditor uses wasEditorFocused() guard because Safari
 * drops focus-within state before click events fire on toolbar buttons.
 * CodeMirror doesn't have this issue because its focus model is different.
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
            <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '**', '**'))} title="Bold (⌘B)">
              <BoldIcon />
            </ToolbarButton>
            <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '*', '*'))} title="Italic (⌘I)">
              <ItalicIcon />
            </ToolbarButton>
            <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '~~', '~~'))} title="Strikethrough (⌘⇧X)">
              <StrikethroughIcon />
            </ToolbarButton>
            <ToolbarButton onClick={() => runAction((v) => wrapWithMarkers(v, '`', '`'))} title="Inline Code">
              <InlineCodeIcon />
            </ToolbarButton>
            <ToolbarButton onClick={() => runAction(toggleCodeBlock)} title="Code Block">
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
            <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, '- [ ] '))} title="Task List">
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
