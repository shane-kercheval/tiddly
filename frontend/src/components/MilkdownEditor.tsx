/**
 * Milkdown-based WYSIWYG markdown editor.
 * Renders markdown inline as you type (like Obsidian, Bear, Typora).
 *
 * This is the "Visual" mode editor used by ContentEditor.
 * For raw markdown editing, see CodeMirrorEditor.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  // Import individual parts instead of full commonmark to exclude remarkPreserveEmptyLinePlugin
  schema,
  inputRules,
  markInputRules,
  commands,
  keymap,
  // Individual plugins (excluding remarkPreserveEmptyLinePlugin which adds <br /> for empty paragraphs)
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  inlineNodesCursorPlugin,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkMarker,
  // remarkPreserveEmptyLinePlugin, -- EXCLUDED: causes empty paragraphs to serialize as <br />
  syncHeadingIdPlugin,
  syncListOrderPlugin,
  // Commands for toolbar
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  insertHrCommand,
  createCodeBlockCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { callCommand } from '@milkdown/kit/utils'

// Custom commonmark without remarkPreserveEmptyLinePlugin
const customCommonmark = [
  schema,
  inputRules,
  markInputRules,
  commands,
  keymap,
  // Plugins (without remarkPreserveEmptyLinePlugin)
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  inlineNodesCursorPlugin,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkMarker,
  syncHeadingIdPlugin,
  syncListOrderPlugin,
].flat()

import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { $prose } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { Modal } from './ui/Modal'
import { cleanMarkdown } from '../utils/cleanMarkdown'
import { shouldHandleEmptySpaceClick } from '../utils/editorUtils'
import type { Editor as EditorType } from '@milkdown/kit/core'

/**
 * Toolbar button component for editor formatting actions.
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
      onClick={onClick}
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
 * Formatting toolbar for the Milkdown editor.
 */
interface EditorToolbarProps {
  getEditor: () => EditorType | undefined
  onLinkClick: () => void
  onTaskListClick: () => void
}

function EditorToolbar({ getEditor, onLinkClick, onTaskListClick }: EditorToolbarProps): ReactNode {
  const runCommand = useCallback(
    (command: Parameters<typeof callCommand>[0]) => {
      const editor = getEditor()
      if (editor) {
        editor.action(callCommand(command))
      }
    },
    [getEditor]
  )

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50/50 opacity-0 group-hover/editor:opacity-100 group-focus-within/editor:opacity-100 transition-opacity">
      {/* Text formatting */}
      <ToolbarButton onClick={() => runCommand(toggleStrongCommand.key)} title="Bold (⌘B)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={() => runCommand(toggleEmphasisCommand.key)} title="Italic (⌘I)">
        <span className="w-4 h-4 flex items-center justify-center text-[17px] font-serif italic">I</span>
      </ToolbarButton>
      <ToolbarButton onClick={() => runCommand(toggleStrikethroughCommand.key)} title="Strikethrough">
        <span className="w-4 h-4 flex items-center justify-center text-[17px] line-through">S</span>
      </ToolbarButton>
      <ToolbarButton onClick={() => runCommand(toggleInlineCodeCommand.key)} title="Inline Code">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={() => runCommand(createCodeBlockCommand.key)} title="Code Block">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h6" />
        </svg>
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Link */}
      <ToolbarButton onClick={onLinkClick} title="Insert Link (⌘K)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Lists */}
      <ToolbarButton onClick={() => runCommand(wrapInBulletListCommand.key)} title="Bullet List">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="2" cy="6" r="1" fill="currentColor" />
          <circle cx="2" cy="12" r="1" fill="currentColor" />
          <circle cx="2" cy="18" r="1" fill="currentColor" />
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={() => runCommand(wrapInOrderedListCommand.key)} title="Numbered List">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6h13M7 12h13M7 18h13" />
          <text x="1" y="8" fontSize="6" fill="currentColor" fontWeight="bold">1</text>
          <text x="1" y="14" fontSize="6" fill="currentColor" fontWeight="bold">2</text>
          <text x="1" y="20" fontSize="6" fill="currentColor" fontWeight="bold">3</text>
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={onTaskListClick} title="Task List (Checkbox)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="5" width="14" height="14" rx="2" strokeWidth={2} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l2 2 4-4" />
        </svg>
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Block elements */}
      <ToolbarButton onClick={() => runCommand(wrapInBlockquoteCommand.key)} title="Blockquote">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={() => runCommand(insertHrCommand.key)} title="Horizontal Rule">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
        </svg>
      </ToolbarButton>
    </div>
  )
}

/**
 * Width of the clickable area for task list checkboxes (in pixels).
 * This must match the CSS styling for li[data-item-type="task"]::before in index.css.
 * The checkbox pseudo-element is ~16px wide with ~8px margin, totaling ~24px.
 * We use 30px to provide a comfortable click target.
 */
const CHECKBOX_CLICK_AREA_WIDTH = 30

/**
 * Link dialog for inserting/editing links.
 */
interface LinkDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (url: string, text: string) => void
  initialText?: string
  initialUrl?: string
}

function LinkDialog({
  isOpen,
  onClose,
  onSubmit,
  initialText = '',
  initialUrl = 'https://',
}: LinkDialogProps): ReactNode {
  const [url, setUrl] = useState(initialUrl)
  const [text, setText] = useState(initialText)

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (url && url !== 'https://') {
      onSubmit(url, text || url)
      onClose()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Insert Link" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="link-text" className="label mb-1">
            Link Text
          </label>
          <input
            id="link-text"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Display text for the link"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="link-url" className="label mb-1">
            URL
          </label>
          <input
            id="link-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="input"
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Insert Link
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Create a ProseMirror plugin that shows placeholder text when the editor is empty.
 * Uses a node decoration to add a class to the empty paragraph, then CSS ::before
 * displays the placeholder. This approach doesn't insert DOM nodes that could
 * interfere with click handling.
 */
function createPlaceholderPlugin(placeholder: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const doc = state.doc
        // Check if document is empty (single empty paragraph)
        if (
          doc.childCount === 1 &&
          doc.firstChild?.isTextblock &&
          doc.firstChild.content.size === 0
        ) {
          // Add a decoration to the empty paragraph with data attribute for CSS
          return DecorationSet.create(doc, [
            Decoration.node(0, doc.firstChild.nodeSize, {
              class: 'is-empty',
              'data-placeholder': placeholder,
            }),
          ])
        }
        return DecorationSet.empty
      },
    },
  })
}

interface MilkdownEditorProps {
  /** Current content value (markdown string) */
  value: string
  /** Called when content changes */
  onChange: (value: string) => void
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Minimum height for the editor */
  minHeight?: string
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Remove padding to align text with other elements */
  noPadding?: boolean
}

interface MilkdownEditorInnerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  minHeight?: string
  placeholder?: string
  noPadding?: boolean
}

function MilkdownEditorInner({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  noPadding = false,
}: MilkdownEditorInnerProps): ReactNode {
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Create placeholder plugin with Milkdown's $prose utility
  const placeholderPluginSlice = $prose(() => createPlaceholderPlugin(placeholder))

  // Initialize the Milkdown editor.
  // Note: The empty dependency array is intentional. The editor is initialized once
  // with the initial value and placeholder. Changing these props after mount requires
  // remounting the component (via React key prop). This is by design - reinitializing
  // the editor would lose cursor position, selection, and undo history.
  const { get } = useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, initialValueRef.current)

        // Set up listener for changes
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          const cleanedMarkdown = cleanMarkdown(markdown)
          onChangeRef.current(cleanedMarkdown)
        })
      })
      .use(customCommonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
      .use(placeholderPluginSlice),
    []
  )

  // Link dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkDialogInitialText, setLinkDialogInitialText] = useState('')
  const [linkDialogKey, setLinkDialogKey] = useState(0)

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Cmd+K or Ctrl+K to insert/edit link
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()

        const editor = get()
        if (!editor) return

        const view = editor.ctx.get(editorViewCtx)
        const { from, to } = view.state.selection
        const selectedText = view.state.doc.textBetween(from, to)

        setLinkDialogInitialText(selectedText)
        setLinkDialogKey((k) => k + 1)
        setLinkDialogOpen(true)
      }
    },
    [get]
  )

  // Handle link insertion from dialog
  const handleLinkSubmit = useCallback(
    (url: string, text: string) => {
      const editor = get()
      if (!editor) return

      const view = editor.ctx.get(editorViewCtx)

      // Get the link mark type from the schema
      const linkMark = view.state.schema.marks.link
      if (!linkMark) return

      // Create the link mark with href attribute
      const mark = linkMark.create({ href: url })

      // Create a text node with the link mark applied
      const linkNode = view.state.schema.text(text, [mark])

      // Replace selection with the linked text
      const tr = view.state.tr.replaceSelectionWith(linkNode, false)
      view.dispatch(tr)

      // Focus back on editor
      view.focus()
    },
    [get]
  )

  // Handle toolbar link button click
  const handleToolbarLinkClick = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    const selectedText = view.state.doc.textBetween(from, to)

    setLinkDialogInitialText(selectedText)
    setLinkDialogKey((k) => k + 1)
    setLinkDialogOpen(true)
  }, [get])

  // Handle toolbar task list button click
  const handleTaskListClick = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const { $from } = view.state.selection

    // Check if we're already in a list item
    const listItem = $from.node($from.depth)
    if (listItem.type.name === 'list_item') {
      // Toggle the checked attribute on the current list item
      const listItemPos = $from.before($from.depth)
      const currentChecked = listItem.attrs.checked
      const tr = view.state.tr.setNodeMarkup(listItemPos, undefined, {
        ...listItem.attrs,
        checked: currentChecked === null ? false : null, // null = not a task, false = unchecked task
      })
      view.dispatch(tr)
    } else {
      // Insert task list syntax - the input rule will convert it
      const tr = view.state.tr.insertText('- [ ] ')
      view.dispatch(tr)
    }
    view.focus()
  }, [get])

  // Handle clicks - checkbox toggle and focus on empty space
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const listItem = target.closest('li[data-item-type="task"]') as HTMLElement | null

      if (listItem) {
        // Check if click was on the checkbox area (left side of the item)
        const rect = listItem.getBoundingClientRect()
        const clickX = e.clientX - rect.left

        if (clickX < CHECKBOX_CLICK_AREA_WIDTH) {
          const editor = get()
          if (editor) {
            const view = editor.ctx.get(editorViewCtx)

            // Find the position of this list item in the ProseMirror document
            const pos = view.posAtDOM(listItem, 0)
            if (pos === null || pos === undefined) return

            // Find the node at this position
            const $pos = view.state.doc.resolve(pos)

            // Walk up to find the list_item node
            for (let depth = $pos.depth; depth >= 0; depth--) {
              const node = $pos.node(depth)
              if (node.type.name === 'list_item') {
                const nodePos = $pos.before(depth)
                const currentChecked = node.attrs.checked

                // Create transaction to update the checked attribute
                const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
                  ...node.attrs,
                  checked: !currentChecked,
                })

                view.dispatch(tr)
                break
              }
            }
          }
        }
        return
      }

      // If click was on empty space (wrapper or editor container), focus and place cursor at end
      const editor = get()
      if (editor) {
        const view = editor.ctx.get(editorViewCtx)
        if (shouldHandleEmptySpaceClick(view.state.selection.empty, target)) {
          view.focus()
          // Place cursor at the end of the document
          const endPos = view.state.doc.content.size
          const tr = view.state.tr.setSelection(
            view.state.selection.constructor.near(view.state.doc.resolve(endPos), -1)
          )
          view.dispatch(tr)
        }
      }
    },
    [get]
  )

  return (
    <>
      {!disabled && <EditorToolbar getEditor={get} onLinkClick={handleToolbarLinkClick} onTaskListClick={handleTaskListClick} />}
      <div
        className={`milkdown-wrapper ${disabled ? 'opacity-50 pointer-events-none' : ''} ${noPadding ? 'no-padding' : ''}`}
        style={{ minHeight }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Milkdown />
      </div>
      <LinkDialog
        key={linkDialogKey}
        isOpen={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onSubmit={handleLinkSubmit}
        initialText={linkDialogInitialText}
      />
    </>
  )
}

/**
 * MilkdownEditor provides a WYSIWYG markdown editor that renders inline.
 *
 * Features:
 * - WYSIWYG editing with inline markdown rendering
 * - Keyboard shortcuts (Cmd+B, Cmd+I, Cmd+K)
 * - Task list checkbox toggling
 * - Placeholder text when empty
 * - Copy/paste preserves markdown
 *
 * Note: This component should be used via ContentEditor which provides
 * the mode toggle between Visual (Milkdown) and Markdown (CodeMirror) modes.
 */
export function MilkdownEditor({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  noPadding = false,
}: MilkdownEditorProps): ReactNode {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner
        value={value}
        onChange={onChange}
        disabled={disabled}
        minHeight={minHeight}
        placeholder={placeholder}
        noPadding={noPadding}
      />
    </MilkdownProvider>
  )
}
