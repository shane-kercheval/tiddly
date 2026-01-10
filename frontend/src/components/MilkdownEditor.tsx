/**
 * Milkdown-based WYSIWYG markdown editor.
 * Renders markdown inline as you type (like Obsidian, Bear, Typora).
 *
 * This is the "Visual" mode editor used by ContentEditor.
 * For raw markdown editing, see CodeMirrorEditor.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
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
  // Schema for Tab key handling
  listItemSchema,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { callCommand, $remark } from '@milkdown/kit/utils'

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

/**
 * Remark plugin to force tight lists (no blank lines between list items).
 * This sets spread: false on list and listItem nodes in the mdast before serialization,
 * which tells remark-stringify to output tight lists without blank lines.
 */
const remarkTightLists = $remark('remarkTightLists', () => () => (tree: unknown) => {
  // Manual tree traversal to avoid potential issues with visit import
  function setTightLists(node: unknown): void {
    if (node && typeof node === 'object') {
      const n = node as { type?: string; spread?: boolean; children?: unknown[] }
      if (n.type === 'list' || n.type === 'listItem') {
        n.spread = false
      }
      if (Array.isArray(n.children)) {
        n.children.forEach(setTightLists)
      }
    }
  }
  setTightLists(tree)
})

import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { $prose } from '@milkdown/kit/utils'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { keymap as createKeymap } from '@milkdown/kit/prose/keymap'
import { sinkListItem, liftListItem } from '@milkdown/kit/prose/schema-list'
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
  onBulletListClick: () => void
  onOrderedListClick: () => void
  onTaskListClick: () => void
  showJinjaTools?: boolean
}

function EditorToolbar({ getEditor, onLinkClick, onBulletListClick, onOrderedListClick, onTaskListClick, showJinjaTools = false }: EditorToolbarProps): ReactNode {
  const runCommand = useCallback(
    (command: Parameters<typeof callCommand>[0]) => {
      const editor = getEditor()
      if (editor) {
        editor.action(callCommand(command))
        // Refocus editor after command
        const view = editor.ctx.get(editorViewCtx)
        view.focus()
      }
    },
    [getEditor]
  )

  // Insert text at cursor position
  const insertText = useCallback(
    (text: string) => {
      const editor = getEditor()
      if (!editor) return
      const view = editor.ctx.get(editorViewCtx)
      const tr = view.state.tr.insertText(text)
      view.dispatch(tr)
      view.focus()
    },
    [getEditor]
  )

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50/50 opacity-0 group-focus-within/editor:opacity-100 transition-opacity">
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
      <ToolbarButton onClick={onBulletListClick} title="Bullet List">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="3" cy="6" r="2" fill="currentColor" />
          <circle cx="3" cy="12" r="2" fill="currentColor" />
          <circle cx="3" cy="18" r="2" fill="currentColor" />
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={onOrderedListClick} title="Numbered List">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h12M8 12h12M8 18h12" />
          <text x="1" y="8" fontSize="7" fill="currentColor" fontWeight="bold">1</text>
          <text x="1" y="14" fontSize="7" fill="currentColor" fontWeight="bold">2</text>
          <text x="1" y="20" fontSize="7" fill="currentColor" fontWeight="bold">3</text>
        </svg>
      </ToolbarButton>
      <ToolbarButton onClick={onTaskListClick} title="Task List (Checkbox)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="5" width="14" height="14" rx="2" strokeWidth={2} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12l3 3 5-5" />
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

      {/* Jinja2 template tools (for prompts) */}
      {showJinjaTools && (
        <>
          <ToolbarSeparator />
          <ToolbarButton onClick={() => insertText('{{ variable }}')} title="Insert Variable {{ }}">
            <span className="w-4 h-4 flex items-center justify-center text-[11px] font-mono font-bold">{'{}'}</span>
          </ToolbarButton>
          <ToolbarButton onClick={() => insertText('{% if variable %}\n\n{% endif %}')} title="If Block {% if %}">
            <span className="w-4 h-4 flex items-center justify-center text-[10px] font-mono font-bold">if</span>
          </ToolbarButton>
          <ToolbarButton onClick={() => insertText('{%- if variable %}\n\n{%- endif %}')} title="If Block with Whitespace Trim {%- if %}">
            <span className="w-4 h-4 flex items-center justify-center text-[10px] font-mono font-bold">if-</span>
          </ToolbarButton>
        </>
      )}
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

/**
 * Check if the selection is inside a code_block node.
 */
function isInCodeBlock(state: Parameters<Parameters<typeof createKeymap>[0][string]>[0]): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'code_block') {
      return true
    }
  }
  return false
}

/**
 * Check if cursor is at the start of a list item's content.
 * Returns the list item depth if true, -1 otherwise.
 */
function getListItemDepthAtStart(state: Parameters<Parameters<typeof createKeymap>[0][string]>[0]): number {
  const { $from } = state.selection

  // Must be a cursor selection (not a range)
  if (!state.selection.empty) return -1

  // Walk up to find list_item
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'list_item') {
      // Check if we're at the start of the list item's content
      // The cursor should be at position 0 within the list item's first child
      const startOfListItem = $from.start(d)
      // Account for the paragraph node inside the list item (+1 for entering the paragraph)
      const firstChildStart = startOfListItem + 1
      if ($from.pos === firstChildStart) {
        return d
      }
      return -1
    }
  }
  return -1
}

/**
 * Create a ProseMirror keymap plugin that handles Tab/Shift+Tab and Backspace.
 * - Tab: indent list item or insert 4 spaces in code blocks
 * - Shift+Tab: outdent list item or remove 4 spaces in code blocks
 * - Backspace at start of list item: lift content out of list
 *
 * @param listItemNodeType - The ProseMirror NodeType for list_item from the schema
 */
function createListKeymapPlugin(listItemNodeType: Parameters<typeof sinkListItem>[0]): Plugin {
  const INDENT = '    ' // 4 spaces

  return createKeymap({
    'Tab': (state, dispatch) => {
      // In code blocks, insert 4 spaces
      if (isInCodeBlock(state)) {
        if (dispatch) {
          dispatch(state.tr.insertText(INDENT))
        }
        return true
      }

      // In list items, try to sink (indent)
      sinkListItem(listItemNodeType)(state, dispatch)

      // Always return true to prevent focus escape
      return true
    },
    'Shift-Tab': (state, dispatch) => {
      // In code blocks, remove up to 4 spaces at start of line
      if (isInCodeBlock(state)) {
        if (dispatch) {
          const { $from } = state.selection
          // Find the start of the current line within the code block
          const lineStart = $from.start()
          const textBefore = state.doc.textBetween(lineStart, $from.pos)
          const lastNewline = textBefore.lastIndexOf('\n')
          const lineContentStart = lastNewline === -1 ? lineStart : lineStart + lastNewline + 1

          // Check how many spaces are at the start of this line
          const lineText = state.doc.textBetween(lineContentStart, $from.pos)
          const leadingSpaces = lineText.match(/^ */)?.[0].length ?? 0
          const spacesToRemove = Math.min(leadingSpaces, 4)

          if (spacesToRemove > 0) {
            dispatch(state.tr.delete(lineContentStart, lineContentStart + spacesToRemove))
          }
        }
        return true
      }

      // In list items, try to lift (outdent)
      liftListItem(listItemNodeType)(state, dispatch)

      // Always return true to prevent focus escape
      return true
    },
    'Backspace': (state, dispatch) => {
      // Check if at the start of a list item
      const listItemDepth = getListItemDepthAtStart(state)
      if (listItemDepth === -1) {
        // Not at start of list item, let default backspace handle it
        return false
      }

      // At start of list item - lift it out of the list
      // This converts the list item to a regular paragraph
      return liftListItem(listItemNodeType)(state, dispatch)
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
  /** Show Jinja2 template tools in toolbar (for prompts) */
  showJinjaTools?: boolean
}

interface MilkdownEditorInnerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  minHeight?: string
  placeholder?: string
  noPadding?: boolean
  showJinjaTools?: boolean
}

function MilkdownEditorInner({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  noPadding = false,
  showJinjaTools = false,
}: MilkdownEditorInnerProps): ReactNode {
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Create placeholder plugin with Milkdown's $prose utility
  const placeholderPluginSlice = $prose(() => createPlaceholderPlugin(placeholder))

  // Create list keymap plugin with Milkdown's $prose utility
  // This plugin handles Tab/Shift+Tab for list indentation and Backspace at list item start
  const listKeymapPluginSlice = $prose((ctx) => {
    const listItemNodeType = listItemSchema.type(ctx)
    return createListKeymapPlugin(listItemNodeType)
  })

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

        // Configure remark-stringify options
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet: '-', // Use '-' for bullet markers consistently
          rule: '-', // Use '---' for horizontal rules instead of '***'
          // Join handler to force tight lists (no blank lines between list items)
          join: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(Array.isArray((options as any).join) ? (options as any).join : []),
            // Return 0 to join list items without blank lines
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (left: any, right: any, parent: any) => {
              if (parent && parent.type === 'list') {
                return 0 // No blank lines between list items
              }
              return undefined // Use default behavior for other nodes
            },
          ],
        }))

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
      .use(remarkTightLists)
      .use(placeholderPluginSlice)
      .use(listKeymapPluginSlice),
    []
  )

  // Link dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkDialogInitialText, setLinkDialogInitialText] = useState('')
  const [linkDialogKey, setLinkDialogKey] = useState(0)

  // Handle keyboard shortcuts (Tab/Shift+Tab handled by tabKeymapPluginSlice at ProseMirror level)
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

  /**
   * Get the current list context for the selection.
   * Returns { listType, listItemDepth, listDepth, isTask } or null if not in a list.
   */
  const getListContext = useCallback((view: ReturnType<typeof get> extends EditorType | undefined ? ReturnType<ReturnType<EditorType['ctx']['get']>> : never) => {
    const { $from } = view.state.selection

    // Find if we're in a list item (may be nested)
    let listItemDepth = -1
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === 'list_item') {
        listItemDepth = d
        break
      }
    }

    if (listItemDepth < 0) return null

    // Find the parent list (bullet_list or ordered_list)
    let listDepth = -1
    let listType: 'bullet_list' | 'ordered_list' | null = null
    for (let d = listItemDepth - 1; d >= 0; d--) {
      const nodeName = $from.node(d).type.name
      if (nodeName === 'bullet_list' || nodeName === 'ordered_list') {
        listDepth = d
        listType = nodeName
        break
      }
    }

    // Check if it's a task list item
    const listItem = $from.node(listItemDepth)
    const isTask = listItem.attrs.checked !== null

    return { listType, listItemDepth, listDepth, isTask }
  }, [])

  // Handle toolbar bullet list button click - toggle behavior
  const handleBulletListClick = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const ctx = getListContext(view)

    if (!ctx) {
      // Not in a list - wrap in bullet list
      editor.action(callCommand(wrapInBulletListCommand.key))
      view.focus()
      return
    }

    const { listType, listItemDepth, isTask } = ctx

    if (listType === 'bullet_list' && !isTask) {
      // Already in bullet list (not task) - lift out
      const listItemNodeType = view.state.schema.nodes.list_item
      liftListItem(listItemNodeType)(view.state, view.dispatch)
      view.focus()
      return
    }

    // In ordered list or task list - convert to bullet list
    // First, if it's a task, remove the checked attribute
    if (isTask) {
      const { $from } = view.state.selection
      const listItem = $from.node(listItemDepth)
      const listItemPos = $from.before(listItemDepth)
      const tr = view.state.tr.setNodeMarkup(listItemPos, undefined, {
        ...listItem.attrs,
        checked: null,
      })
      view.dispatch(tr)
    }

    // If it was ordered, convert to bullet by changing the list type
    if (ctx.listType === 'ordered_list') {
      const { $from } = view.state.selection
      const listPos = $from.before(ctx.listDepth)
      const bulletListType = view.state.schema.nodes.bullet_list
      const tr = view.state.tr.setNodeMarkup(listPos, bulletListType)
      view.dispatch(tr)
    }

    view.focus()
  }, [get, getListContext])

  // Handle toolbar ordered list button click - toggle behavior
  const handleOrderedListClick = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const ctx = getListContext(view)

    if (!ctx) {
      // Not in a list - wrap in ordered list
      editor.action(callCommand(wrapInOrderedListCommand.key))
      view.focus()
      return
    }

    const { listType, listItemDepth, isTask } = ctx

    if (listType === 'ordered_list') {
      // Already in ordered list - lift out
      const listItemNodeType = view.state.schema.nodes.list_item
      liftListItem(listItemNodeType)(view.state, view.dispatch)
      view.focus()
      return
    }

    // In bullet list or task list - convert to ordered list
    // First, if it's a task, remove the checked attribute
    if (isTask) {
      const { $from } = view.state.selection
      const listItem = $from.node(listItemDepth)
      const listItemPos = $from.before(listItemDepth)
      const tr = view.state.tr.setNodeMarkup(listItemPos, undefined, {
        ...listItem.attrs,
        checked: null,
      })
      view.dispatch(tr)
    }

    // Convert to ordered list by changing the list type
    if (ctx.listType === 'bullet_list') {
      const { $from } = view.state.selection
      const listPos = $from.before(ctx.listDepth)
      const orderedListType = view.state.schema.nodes.ordered_list
      const tr = view.state.tr.setNodeMarkup(listPos, orderedListType)
      view.dispatch(tr)
    }

    view.focus()
  }, [get, getListContext])

  // Handle toolbar task list button click
  const handleTaskListClick = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const ctx = getListContext(view)

    if (!ctx) {
      // Not in a list - first create a bullet list, then convert to task
      editor.action(callCommand(wrapInBulletListCommand.key))
      // After creating bullet list, find and convert the list item to task
      // Need to get fresh state after the command
      setTimeout(() => {
        const freshView = editor.ctx.get(editorViewCtx)
        const { $from: newFrom } = freshView.state.selection
        // Find the list item we're now in
        for (let d = newFrom.depth; d >= 0; d--) {
          const node = newFrom.node(d)
          if (node.type.name === 'list_item') {
            const pos = newFrom.before(d)
            const tr = freshView.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              checked: false,
            })
            freshView.dispatch(tr)
            break
          }
        }
        freshView.focus()
      }, 0)
      return
    }

    const { listItemDepth, isTask } = ctx

    if (isTask) {
      // Already a task - toggle it off (remove checked attribute)
      const { $from } = view.state.selection
      const listItem = $from.node(listItemDepth)
      const listItemPos = $from.before(listItemDepth)
      const tr = view.state.tr.setNodeMarkup(listItemPos, undefined, {
        ...listItem.attrs,
        checked: null,
      })
      view.dispatch(tr)
      view.focus()
      return
    }

    // In a list but not a task - convert to task
    // If in ordered list, first convert to bullet list
    if (ctx.listType === 'ordered_list') {
      const { $from } = view.state.selection
      const listPos = $from.before(ctx.listDepth)
      const bulletListType = view.state.schema.nodes.bullet_list
      const tr = view.state.tr.setNodeMarkup(listPos, bulletListType)
      view.dispatch(tr)
    }

    // Now add the checked attribute
    // Need fresh state after potential list type change
    setTimeout(() => {
      const freshView = editor.ctx.get(editorViewCtx)
      const { $from: newFrom } = freshView.state.selection
      for (let d = newFrom.depth; d >= 0; d--) {
        const node = newFrom.node(d)
        if (node.type.name === 'list_item') {
          const pos = newFrom.before(d)
          const tr = freshView.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: false,
          })
          freshView.dispatch(tr)
          break
        }
      }
      freshView.focus()
    }, 0)
  }, [get, getListContext])

  // Handle mouse down - checkbox toggle and focus on empty space
  // Using mousedown instead of click to prevent focus flash (blur/refocus cycle)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement

      // Don't interfere with clicks on any content elements (let ProseMirror handle them)
      const isContentClick = target.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, code, a, ul, ol, table, td, th, tr')

      const taskListItem = target.closest('li[data-item-type="task"]') as HTMLElement | null

      if (taskListItem) {
        // Check if click was on the checkbox area (left side of the item)
        const rect = taskListItem.getBoundingClientRect()
        const clickX = e.clientX - rect.left

        if (clickX < CHECKBOX_CLICK_AREA_WIDTH) {
          const editor = get()
          if (editor) {
            const view = editor.ctx.get(editorViewCtx)

            // Find the position of this list item in the ProseMirror document
            const pos = view.posAtDOM(taskListItem, 0)
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

      // If click was on empty space (not content), focus and place cursor at end
      // Skip if clicking on any content element to let ProseMirror handle it naturally
      if (isContentClick) return

      const editor = get()
      if (editor) {
        const view = editor.ctx.get(editorViewCtx)
        if (shouldHandleEmptySpaceClick(view.state.selection.empty, target)) {
          // Prevent default to avoid focus flash (blur then refocus)
          e.preventDefault()
          view.focus()
          // Place cursor at the end of the document
          const endPos = view.state.doc.content.size
          const tr = view.state.tr.setSelection(
            TextSelection.near(view.state.doc.resolve(endPos), -1)
          )
          view.dispatch(tr)
        }
      }
    },
    [get]
  )

  return (
    <>
      {!disabled && <EditorToolbar getEditor={get} onLinkClick={handleToolbarLinkClick} onBulletListClick={handleBulletListClick} onOrderedListClick={handleOrderedListClick} onTaskListClick={handleTaskListClick} showJinjaTools={showJinjaTools} />}
      <div
        className={`milkdown-wrapper ${disabled ? 'opacity-50 pointer-events-none' : ''} ${noPadding ? 'no-padding' : ''}`}
        style={{ minHeight }}
        onMouseDown={handleMouseDown}
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
  showJinjaTools = false,
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
        showJinjaTools={showJinjaTools}
      />
    </MilkdownProvider>
  )
}
