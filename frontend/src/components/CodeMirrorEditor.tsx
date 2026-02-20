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
import { languages } from '@codemirror/language-data'
import { keymap, EditorView } from '@codemirror/view'
import { markdownStyleExtension, createFontTheme } from '../utils/markdownStyleExtension'
import type { KeyBinding } from '@codemirror/view'
import { autocompletion, completionStatus } from '@codemirror/autocomplete'
import { Prec } from '@codemirror/state'
import { CopyToClipboardButton } from './ui/CopyToClipboardButton'
import { Tooltip } from './ui/Tooltip'
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
  HeadingIcon,
  SaveIcon,
  JinjaVariableIcon,
  JinjaIfIcon,
  JinjaIfTrimIcon,
  WrapIcon,
  LineNumbersIcon,
  MonoFontIcon,
  ReadingIcon,
} from './editor/EditorToolbarIcons'
import { CloseIcon } from './icons'
import { JINJA_VARIABLE, JINJA_IF_BLOCK, JINJA_IF_BLOCK_TRIM } from './editor/jinjaTemplates'
import { createSlashCommandSource, slashCommandAddToOptions, scrollFadePlugin } from '../utils/slashCommands'
import { wasEditorFocused } from '../utils/editorUtils'
import {
  toggleWrapMarkers,
  toggleLinePrefix,
  insertLink,
  insertCodeBlock,
  insertHorizontalRule,
  insertText,
} from '../utils/editorFormatting'
import { buildEditorCommands, type MenuCallbacks } from './editor/editorCommands'
import { EditorCommandMenu } from './editor/EditorCommandMenu'

/** Markdown formatting markers for wrap-style formatting. */
const MARKERS = {
  bold: { before: '**', after: '**' },
  italic: { before: '*', after: '*' },
  strikethrough: { before: '~~', after: '~~' },
  highlight: { before: '==', after: '==' },
  inlineCode: { before: '`', after: '`' },
} as const

/** Line prefixes for block-style formatting. */
const LINE_PREFIXES = {
  blockquote: '> ',
  bulletList: '- ',
  numberedList: '1. ',
  taskList: '- [ ] ',
} as const

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
  /** Whether to show line numbers */
  showLineNumbers?: boolean
  /** Called when line numbers preference changes */
  onLineNumbersChange?: (show: boolean) => void
  /** Whether to use monospace font */
  monoFont?: boolean
  /** Called when mono font preference changes */
  onMonoFontChange?: (mono: boolean) => void
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
  /** Save and close callback for command menu */
  onSaveAndClose?: () => void
  /** Discard changes callback for command menu (always shown, greyed out when !isDirty) */
  onDiscard?: () => void
  /** Whether the editor has unsaved changes (controls discard command disabled state) */
  isDirty?: boolean
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
    // Text formatting
    { key: 'Mod-b', run: (view) => toggleWrapMarkers(view, MARKERS.bold.before, MARKERS.bold.after) },
    { key: 'Mod-i', run: (view) => toggleWrapMarkers(view, MARKERS.italic.before, MARKERS.italic.after) },
    { key: 'Mod-Shift-x', run: (view) => toggleWrapMarkers(view, MARKERS.strikethrough.before, MARKERS.strikethrough.after) },
    { key: 'Mod-Shift-h', run: (view) => toggleWrapMarkers(view, MARKERS.highlight.before, MARKERS.highlight.after) },
    { key: 'Mod-Shift-.', run: (view) => toggleLinePrefix(view, LINE_PREFIXES.blockquote) },
    // Code
    { key: 'Mod-e', run: (view) => toggleWrapMarkers(view, MARKERS.inlineCode.before, MARKERS.inlineCode.after) },
    { key: 'Mod-Shift-e', run: (view) => insertCodeBlock(view) },
    // Lists (Notion convention: 7=numbered, 8=bullet, 9=task)
    { key: 'Mod-Shift-7', run: (view) => toggleLinePrefix(view, LINE_PREFIXES.numberedList) },
    { key: 'Mod-Shift-8', run: (view) => toggleLinePrefix(view, LINE_PREFIXES.bulletList) },
    { key: 'Mod-Shift-9', run: (view) => toggleLinePrefix(view, LINE_PREFIXES.taskList) },
    // Links and other
    { key: 'Mod-k', run: (view) => insertLink(view) },
    { key: 'Mod-Shift--', run: (view) => insertHorizontalRule(view) },
    // Pass through to global handlers (consume event, then dispatch globally)
    {
      key: 'Mod-/',
      run: () => {
        dispatchGlobalShortcut('/', true)
        return true // Consume to prevent CodeMirror's comment toggle
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
    <Tooltip content={title} compact delay={500}>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          // On mobile (< md), buttons are always visible so always execute
          // On desktop, only execute if editor was already focused (toolbar visible)
          const isMobileView = window.innerWidth < 768
          if (isMobileView || wasEditorFocused(e.currentTarget)) {
            e.preventDefault()
            onClick()
          }
          // If editor wasn't focused (desktop), let the click naturally focus the editor
          // which will reveal the toolbar (but won't execute the action)
        }}
        className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
      >
        {children}
      </button>
    </Tooltip>
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
  showLineNumbers = false,
  onLineNumbersChange,
  monoFont = false,
  onMonoFontChange,
  noPadding = false,
  autoFocus = false,
  copyContent,
  showJinjaTools = false,
  onModalStateChange: _onModalStateChange, // eslint-disable-line @typescript-eslint/no-unused-vars
  onSaveAndClose,
  onDiscard,
  isDirty = false,
}: CodeMirrorEditorProps): ReactNode {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Forward-declared ref for openCommandMenu (defined later, used by document-level keydown handler and CM keybinding)
  const openCommandMenuRef = useRef<() => void>(() => {})

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
        return
      }

      // Option+L (Alt+L) - toggle line numbers (only when not in reading mode)
      if (e.altKey && e.code === 'KeyL' && !effectiveReadingMode && onLineNumbersChange) {
        e.preventDefault()
        e.stopPropagation()
        onLineNumbersChange(!showLineNumbers)
        return
      }

      // Option+M (Alt+M) - toggle monospace font (only when not in reading mode)
      if (e.altKey && e.code === 'KeyM' && !effectiveReadingMode && onMonoFontChange) {
        e.preventDefault()
        e.stopPropagation()
        onMonoFontChange(!monoFont)
        return
      }

      // Cmd+Shift+/ - open command menu (works whether editor has focus or not)
      // Uses capture phase so it runs before CM's keymap handler.
      // Uses ref to avoid dependency ordering issues (openCommandMenu defined later).
      if (isMod && e.shiftKey && e.key === '/' && !effectiveReadingMode) {
        e.preventDefault()
        e.stopPropagation()
        openCommandMenuRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [toggleReadingMode, effectiveReadingMode, wrapText, onWrapTextChange, showLineNumbers, onLineNumbersChange, monoFont, onMonoFontChange])

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

  // --- Command menu state ---
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [commandMenuCoords, setCommandMenuCoords] = useState<{ x: number; y: number } | null>(null)
  const [savedSelection, setSavedSelection] = useState<{ from: number; to: number } | null>(null)

  // Build command list
  const menuCallbacks: MenuCallbacks = useMemo(() => ({
    onSaveAndClose,
    onDiscard,
  }), [onSaveAndClose, onDiscard])

  const editorCommands = useMemo(() => buildEditorCommands({
    showJinja: showJinjaTools,
    callbacks: menuCallbacks,
    isDirty,
    icons: {
      bold: () => <BoldIcon />,
      italic: () => <ItalicIcon />,
      strikethrough: () => <StrikethroughIcon />,
      highlight: () => <HighlightIcon />,
      inlineCode: () => <InlineCodeIcon />,
      codeBlock: () => <CodeBlockIcon />,
      link: () => <LinkIcon />,
      bulletList: () => <BulletListIcon />,
      orderedList: () => <OrderedListIcon />,
      taskList: () => <TaskListIcon />,
      blockquote: () => <BlockquoteIcon />,
      horizontalRule: () => <HorizontalRuleIcon />,
      heading1: () => <HeadingIcon level={1} />,
      heading2: () => <HeadingIcon level={2} />,
      heading3: () => <HeadingIcon level={3} />,
      jinjaVariable: () => <JinjaVariableIcon />,
      jinjaIf: () => <JinjaIfIcon />,
      jinjaIfTrim: () => <JinjaIfTrimIcon />,
      save: () => <SaveIcon />,
      close: () => <CloseIcon className="h-4 w-4" />,
    },
  }), [showJinjaTools, menuCallbacks, isDirty])

  // Open command menu: capture cursor position and selection.
  // Focus moves to the menu's filter input via ref callback (synchronous during commit),
  // which inherently blurs CM — no explicit blur() needed.
  const openCommandMenu = useCallback((): void => {
    const view = getView()
    if (view) {
      const sel = view.state.selection.main
      setSavedSelection({ from: sel.from, to: sel.to })
      const coords = view.coordsAtPos(sel.head)
      if (coords) {
        setCommandMenuCoords({ x: coords.left, y: coords.bottom })
      } else {
        setCommandMenuCoords(null)
      }
    } else {
      setSavedSelection(null)
      setCommandMenuCoords(null)
    }
    setCommandMenuOpen(true)
  }, [getView])

  // Close command menu and refocus editor
  const closeCommandMenu = useCallback((): void => {
    setCommandMenuOpen(false)
    const view = getView()
    if (view) {
      view.focus()
    }
  }, [getView])

  // Execute a command from the menu
  const handleCommandExecute = useCallback((command: { action: (view: EditorView) => void }): void => {
    setCommandMenuOpen(false)
    const view = getView()
    if (view) {
      view.focus()
      // Restore saved selection before running the command
      if (savedSelection) {
        view.dispatch({
          selection: { anchor: savedSelection.from, head: savedSelection.to },
        })
      }
      command.action(view)
    }
  }, [getView, savedSelection])

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
  // - Programmatic content changes (e.g., version restore) increment contentKey in the
  //   parent, which changes the key prop and forces remount with the new value
  const [initialValue] = useState(value)

  // Keep ref in sync so CM extension and document-level handler use latest callback
  useEffect(() => {
    openCommandMenuRef.current = openCommandMenu
  })

  // Build extensions array with optional line wrapping and keybindings
  const extensions = useMemo(() => {
    const bindings = createMarkdownKeyBindings()
    const slashSource = createSlashCommandSource(showJinjaTools)
    const exts = [
      markdown({ codeLanguages: languages }),
      Prec.highest(keymap.of(bindings)),
      markdownStyleExtension,
      createFontTheme(monoFont),
      autocompletion({
        override: [slashSource],
        icons: false,
        selectOnOpen: true,
        addToOptions: slashCommandAddToOptions,
      }),
      scrollFadePlugin,
      // Prevent Escape from bubbling to parent handlers (e.g. discard confirmation)
      // when closing the autocomplete dropdown. Prec.highest ensures this runs
      // before CM's keymap handler (Prec.default) which would close the dropdown
      // and break the handler loop before we can call stopPropagation.
      Prec.highest(
        EditorView.domEventHandlers({
          keydown(event, view) {
            if (event.key === 'Escape' && completionStatus(view.state) !== null) {
              event.stopPropagation()
            }
            return false // let CM's keymap close the dropdown normally
          },
        }),
      ),
    ]
    if (wrapText) {
      exts.push(EditorView.lineWrapping)
    }
    return exts
  }, [wrapText, monoFont, showJinjaTools])

  return (
    <div ref={containerRef} className={`w-full ${noPadding ? 'codemirror-no-padding' : ''}`}>
      {/* Toolbar - formatting buttons fade in on focus, copy button stays visible (doesn't fade) */}
      {/* Always render toolbar to prevent layout shift; buttons are disabled when editor is disabled */}
      {/* min-h and transform-gpu prevent Safari reflow issues during focus/blur transitions */}
      {/* Mobile: flex-wrap, all buttons visible. Desktop: no-wrap, buttons fade in on focus */}
      <div className="flex items-center flex-wrap md:flex-nowrap gap-0.5 md:gap-0 md:justify-between px-2 py-1 min-h-[34px] transform-gpu border-b border-solid border-transparent group-focus-within/editor:border-gray-200 bg-transparent group-focus-within/editor:bg-gray-50/50 transition-colors">
        {/* Left: formatting buttons - visible on mobile, fade in on focus on desktop */}
        {/* On mobile: 'contents' flattens structure so all buttons wrap together as siblings */}
        <div className={`contents md:flex md:flex-nowrap md:items-center md:gap-0.5 md:opacity-0 md:pointer-events-none md:group-focus-within/editor:opacity-100 md:group-focus-within/editor:pointer-events-auto transition-opacity ${disabled ? 'pointer-events-none' : ''}`}>
          {/* Text formatting */}
          <ToolbarButton onClick={() => runAction((v) => toggleWrapMarkers(v, MARKERS.bold.before, MARKERS.bold.after))} title="Bold (⌘B)">
            <BoldIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleWrapMarkers(v, MARKERS.italic.before, MARKERS.italic.after))} title="Italic (⌘I)">
            <ItalicIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleWrapMarkers(v, MARKERS.strikethrough.before, MARKERS.strikethrough.after))} title="Strikethrough (⌘⇧X)">
            <StrikethroughIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleWrapMarkers(v, MARKERS.highlight.before, MARKERS.highlight.after))} title="Highlight (⌘⇧H)">
            <HighlightIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, LINE_PREFIXES.blockquote))} title="Blockquote (⌘⇧.)">
            <BlockquoteIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Code */}
          <ToolbarButton onClick={() => runAction((v) => toggleWrapMarkers(v, MARKERS.inlineCode.before, MARKERS.inlineCode.after))} title="Inline Code (⌘E)">
            <InlineCodeIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction(insertCodeBlock)} title="Code Block (⌘⇧E)">
            <CodeBlockIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Lists */}
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, LINE_PREFIXES.bulletList))} title="Bullet List (⌘⇧8)">
            <BulletListIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, LINE_PREFIXES.numberedList))} title="Numbered List (⌘⇧7)">
            <OrderedListIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction((v) => toggleLinePrefix(v, LINE_PREFIXES.taskList))} title="Task List (⌘⇧9)">
            <TaskListIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Links and dividers */}
          <ToolbarButton onClick={() => runAction(insertLink)} title="Insert Link (⌘K)">
            <LinkIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => runAction(insertHorizontalRule)} title="Horizontal Rule (⌘⇧-)">
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

        {/* Right: Toggle icons (Wrap, Lines, Reading) and Copy */}
        {/* On mobile: 'contents' flattens structure so buttons flow with others. On desktop: stays at right */}
        <div className="contents md:flex md:items-center md:gap-0.5 md:ml-auto">
          {/* Separator only on mobile (other separators are hidden on mobile) */}
          <div className="w-px h-5 bg-gray-200 mx-1 md:hidden" />
          {/* Wrap toggle - always visible, only shown when not in reading mode */}
          {onWrapTextChange && !effectiveReadingMode && (
            <Tooltip content={<>Toggle word wrap<br /><span className="opacity-75">⌥Z</span></>} compact>
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!disabled) {
                    onWrapTextChange(!wrapText)
                  }
                }}
                className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                  wrapText
                    ? 'text-gray-700 bg-gray-200'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <WrapIcon />
              </button>
            </Tooltip>
          )}

          {/* Line numbers toggle - always visible, only shown when not in reading mode */}
          {onLineNumbersChange && !effectiveReadingMode && (
            <Tooltip content={<>Toggle line numbers<br /><span className="opacity-75">⌥L</span></>} compact>
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!disabled) {
                    onLineNumbersChange(!showLineNumbers)
                  }
                }}
                className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                  showLineNumbers
                    ? 'text-gray-700 bg-gray-200'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <LineNumbersIcon />
              </button>
            </Tooltip>
          )}

          {/* Mono font toggle - only shown when not in reading mode */}
          {onMonoFontChange && !effectiveReadingMode && (
            <Tooltip content={<>Toggle monospace font<br /><span className="opacity-75">⌥M</span></>} compact>
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!disabled) {
                    onMonoFontChange(!monoFont)
                  }
                }}
                className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                  monoFont
                    ? 'text-gray-700 bg-gray-200'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <MonoFontIcon />
              </button>
            </Tooltip>
          )}

          {/* Reading mode toggle - always visible */}
          <Tooltip content={<>Toggle reading mode<br /><span className="opacity-75">⌘⇧M</span></>} compact>
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
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                effectiveReadingMode
                  ? 'text-gray-700 bg-gray-200'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <ReadingIcon />
            </button>
          </Tooltip>

          {/* Copy button - always visible but disabled when editor is disabled */}
          {copyContent !== undefined && (
            <CopyToClipboardButton content={copyContent} title="Copy content" disabled={disabled} />
          )}
        </div>
      </div>
      {/* Editor area - overflow-hidden for content clipping (rounded corners handled by parent) */}
      <div className="overflow-hidden">
        {/* Reading mode: show Milkdown preview */}
        {effectiveReadingMode && (
          <MilkdownEditor
            value={value}
            onChange={() => {}} // Read-only: ignore changes
            disabled={false}
            readOnly={true}
            minHeight={minHeight}
            placeholder={placeholder}
            noPadding={noPadding}
          />
        )}
        {/* CodeMirror: always mounted to preserve state, hidden when in reading mode */}
        {/* This prevents loss of edits when toggling modes (initialValue pattern) */}
        <div className={effectiveReadingMode ? 'hidden' : ''}>
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
              lineNumbers: showLineNumbers,
              foldGutter: false,
              highlightActiveLine: false,
              autocompletion: false,
            }}

          />
        </div>
      </div>

      {/* Editor command menu (Cmd+Shift+/) — conditionally rendered so
          React unmounts/remounts it, giving fresh state each time. */}
      {commandMenuOpen && (
        <EditorCommandMenu
          onClose={closeCommandMenu}
          onExecute={handleCommandExecute}
          commands={editorCommands}
          anchorCoords={commandMenuCoords}
        />
      )}
    </div>
  )
}
