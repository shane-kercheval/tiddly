/**
 * Milkdown-based rich markdown editor.
 * Renders markdown inline as you type (like Obsidian, Bear, Typora).
 *
 * This is the "Markdown" mode editor used by ContentEditor.
 * For plain text editing, see CodeMirrorEditor.
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
import { callCommand, $remark, getMarkdown } from '@milkdown/kit/utils'

// Custom commonmark without remarkPreserveEmptyLinePlugin
const customCommonmark = [
  schema,
  inputRules,
  markInputRules,
  commands,
  keymap,
  // Plugins (excluding remarkPreserveEmptyLinePlugin which causes empty paragraphs to serialize as <br />)
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  inlineNodesCursorPlugin,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer, // Required for parsing HTML/XML blocks - escaping is handled by cleanMarkdown
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
import { Plugin, TextSelection, EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, EditorView } from '@milkdown/kit/prose/view'
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import { keymap as createKeymap } from '@milkdown/kit/prose/keymap'
import { sinkListItem, liftListItem } from '@milkdown/kit/prose/schema-list'
import { setBlockType } from '@milkdown/kit/prose/commands'
import { Modal } from './ui/Modal'
import { CopyToClipboardButton } from './ui/CopyToClipboardButton'
import { COPY_FEEDBACK_DURATION } from '../hooks/useCopyFeedback'
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
import { cleanMarkdown } from '../utils/cleanMarkdown'
import { shouldHandleEmptySpaceClick, wasEditorFocused } from '../utils/editorUtils'
import { findCodeBlockNode, findLinkBoundaries } from '../utils/milkdownHelpers'
import type { Editor as EditorType } from '@milkdown/kit/core'

/**
 * Toolbar button component for editor formatting actions.
 *
 * IMPORTANT: This uses wasEditorFocused() guard, unlike CodeMirrorEditor's ToolbarButton.
 *
 * Safari has a quirk where clicking a button outside the ProseMirror editor causes
 * focus-within to be lost BEFORE the click event fires. This means:
 * 1. User clicks toolbar button
 * 2. Safari immediately removes focus-within (toolbar starts fading)
 * 3. Click event fires (but toolbar is already hidden/fading)
 *
 * The wasEditorFocused() check ensures we only execute the action if the editor
 * was focused (toolbar was visible) when the user initiated the click. If the
 * toolbar wasn't visible, the click just focuses the editor to reveal it.
 *
 * CodeMirrorEditor doesn't need this guard because its focus model behaves differently.
 */
interface ToolbarButtonProps {
  onAction: () => void
  title: string
  children: ReactNode
}

function ToolbarButton({ onAction, title, children }: ToolbarButtonProps): ReactNode {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => {
        if (wasEditorFocused(e.currentTarget)) {
          // Editor was focused (toolbar visible) - execute action
          e.preventDefault()
          onAction()
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
 * Formatting toolbar for the Milkdown editor.
 */
interface EditorToolbarProps {
  getEditor: () => EditorType | undefined
  onLinkClick: () => void
  onCodeBlockToggle: () => void
  onBulletListClick: () => void
  onOrderedListClick: () => void
  onTaskListClick: () => void
  showJinjaTools?: boolean
  /** Content to copy (for always-visible copy button) */
  copyContent?: string
}

function EditorToolbar({ getEditor, onLinkClick, onCodeBlockToggle, onBulletListClick, onOrderedListClick, onTaskListClick, showJinjaTools = false, copyContent }: EditorToolbarProps): ReactNode {
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

  // Focus editor when clicking anywhere on toolbar (reveals toolbar when hidden)
  const handleToolbarClick = useCallback(() => {
    const editor = getEditor()
    if (editor) {
      const view = editor.ctx.get(editorViewCtx)
      view.focus()
    }
  }, [getEditor])

  return (
    <div
      className="flex items-center justify-between px-2 py-1.5 border-b border-solid border-transparent group-focus-within/editor:border-gray-200 bg-transparent group-focus-within/editor:bg-gray-50/50 transition-colors"
      onClick={handleToolbarClick}
    >
      {/* Left: formatting buttons that fade in */}
      <div className="flex items-center gap-0.5 opacity-0 group-focus-within/editor:opacity-100 transition-opacity">
        {/* Text formatting */}
        <ToolbarButton onAction={() => runCommand(toggleStrongCommand.key)} title="Bold (⌘B)">
          <BoldIcon />
        </ToolbarButton>
        <ToolbarButton onAction={() => runCommand(toggleEmphasisCommand.key)} title="Italic (⌘I)">
          <ItalicIcon />
        </ToolbarButton>
        <ToolbarButton onAction={() => runCommand(toggleStrikethroughCommand.key)} title="Strikethrough (⌘⇧X)">
          <StrikethroughIcon />
        </ToolbarButton>
        <ToolbarButton onAction={() => runCommand(toggleInlineCodeCommand.key)} title="Inline Code (⌘E)">
          <InlineCodeIcon />
        </ToolbarButton>
        <ToolbarButton onAction={onCodeBlockToggle} title="Code Block (⌘⇧C)">
          <CodeBlockIcon />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Link */}
        <ToolbarButton onAction={onLinkClick} title="Insert Link (⌘K)">
          <LinkIcon />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Lists */}
        <ToolbarButton onAction={onBulletListClick} title="Bullet List (⌘⇧7)">
          <BulletListIcon />
        </ToolbarButton>
        <ToolbarButton onAction={onOrderedListClick} title="Numbered List (⌘⇧8)">
          <OrderedListIcon />
        </ToolbarButton>
        <ToolbarButton onAction={onTaskListClick} title="Task List (⌘⇧9)">
          <TaskListIcon />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Block elements */}
        <ToolbarButton onAction={() => runCommand(wrapInBlockquoteCommand.key)} title="Blockquote (⌘⇧.)">
          <BlockquoteIcon />
        </ToolbarButton>
        <ToolbarButton onAction={() => runCommand(insertHrCommand.key)} title="Horizontal Rule (⌘⇧-)">
          <HorizontalRuleIcon />
        </ToolbarButton>

        {/* Jinja2 template tools (for prompts) */}
        {showJinjaTools && (
          <>
            <ToolbarSeparator />
            <ToolbarButton onAction={() => insertText(JINJA_VARIABLE)} title="Insert Variable {{ }}">
              <JinjaVariableIcon />
            </ToolbarButton>
            <ToolbarButton onAction={() => insertText(JINJA_IF_BLOCK)} title="If Block {% if %}">
              <JinjaIfIcon />
            </ToolbarButton>
            <ToolbarButton onAction={() => insertText(JINJA_IF_BLOCK_TRIM)} title="If Block with Whitespace Trim {%- if %}">
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
  )
}

/**
 * Width of the clickable area for task list checkboxes (in pixels).
 * This matches the checkbox pseudo-element which is 16px wide (w-4) in index.css.
 * Only clicks directly on the checkbox should toggle it, not clicks in the gap.
 */
const CHECKBOX_CLICK_AREA_WIDTH = 16

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
  initialUrl = '',
}: LinkDialogProps): ReactNode {
  // Use provided URL or default to https:// prefix for new links
  const [url, setUrl] = useState(initialUrl !== '' ? initialUrl : 'https://')
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
 * Create a ProseMirror plugin that adds copy buttons to code blocks.
 * Uses widget decorations to insert a button element at the start of each code block.
 * The button is positioned absolutely via CSS and copies the code content on click.
 */
function createCodeBlockCopyPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = []

        state.doc.descendants((node, pos) => {
          // Only add copy button to code blocks that have content
          if (node.type.name === 'code_block' && node.textContent.trim()) {
            decorations.push(
              Decoration.widget(
                pos + 1,
                (view) => {
                  const button = document.createElement('button')
                  button.className = 'code-block-copy-btn'
                  button.setAttribute('type', 'button')
                  button.setAttribute('title', 'Copy code')
                  button.setAttribute('aria-label', 'Copy code')

                  button.innerHTML = `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>`

                  button.onclick = async (e) => {
                    e.preventDefault()
                    e.stopPropagation()

                    const resolvedPos = view.state.doc.resolve(pos)
                    const codeBlockNode = resolvedPos.nodeAfter
                    if (!codeBlockNode) return

                    try {
                      await navigator.clipboard.writeText(codeBlockNode.textContent)
                      button.classList.add('copied')
                      setTimeout(() => button.classList.remove('copied'), COPY_FEEDBACK_DURATION)
                    } catch (err) {
                      console.error('Failed to copy code:', err)
                    }
                  }

                  return button
                },
                { stopEvent: () => true, side: -1, key: `code-copy-${pos}` }
              )
            )
          }
          return true
        })

        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
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
function isInCodeBlock(state: EditorState): boolean {
  return findCodeBlockNode(state) !== null
}

/**
 * Check if cursor is at the start of a list item's content.
 * Returns the list item depth if true, -1 otherwise.
 */
function getListItemDepthAtStart(state: EditorState): number {
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
 * Create a ProseMirror plugin that makes links clickable via Cmd+Click (Mac) or Ctrl+Click (Windows/Linux).
 * Opens links in a new tab with noopener,noreferrer for security.
 */
function createLinkClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(view, event) {
          // Platform-specific modifier key detection
          // Mac: Cmd (metaKey), Windows/Linux: Ctrl (ctrlKey)
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
          const isModClick = isMac ? event.metaKey : event.ctrlKey

          if (!isModClick) return false

          // Get ProseMirror position at click location
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!coords) return false

          // Check if there's a link mark at this position
          const $pos = view.state.doc.resolve(coords.pos)
          const linkMarkType = view.state.schema.marks.link
          const linkMark = linkMarkType?.isInSet($pos.marks())

          if (linkMark) {
            const href = linkMark.attrs.href
            if (href) {
              window.open(href, '_blank', 'noopener,noreferrer')

              // CRITICAL: handleDOMEvents does NOT automatically call preventDefault()
              // You must call it explicitly yourself, even when returning true
              event.preventDefault()
              return true
            }
          }

          return false
        },
      },
    },
  })
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
      // Handle empty code blocks: convert to paragraph
      // Must be a cursor selection (not a range) for this behavior
      if (state.selection.empty) {
        const codeBlock = findCodeBlockNode(state)
        if (codeBlock && codeBlock.node.textContent === '') {
          // Empty code block - convert to paragraph
          if (dispatch) {
            const paragraphType = state.schema.nodes.paragraph
            setBlockType(paragraphType)(state, dispatch)
          }
          return true
        }
        // Code block has content, let default backspace handle it
        if (codeBlock) {
          return false
        }
      }

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
  /** Whether to auto-focus on mount */
  autoFocus?: boolean
  /** Content for the copy button (if provided, copy button is shown) */
  copyContent?: string
  /** Called when a modal opens/closes (for beforeunload handlers) */
  onModalStateChange?: (isOpen: boolean) => void
}

interface MilkdownEditorInnerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  minHeight?: string
  placeholder?: string
  noPadding?: boolean
  showJinjaTools?: boolean
  autoFocus?: boolean
  copyContent?: string
  onModalStateChange?: (isOpen: boolean) => void
}

function MilkdownEditorInner({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  noPadding = false,
  showJinjaTools = false,
  autoFocus = false,
  copyContent,
  onModalStateChange,
}: MilkdownEditorInnerProps): ReactNode {
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const autoFocusRef = useRef(autoFocus)

  // Track if component is still mounted to prevent async operations on unmounted component
  // Must set true in setup for React StrictMode which runs: setup → cleanup → setup
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Create placeholder plugin with Milkdown's $prose utility
  const placeholderPluginSlice = $prose(() => createPlaceholderPlugin(placeholder))

  // Create code block copy button plugin
  const codeBlockCopyPluginSlice = $prose(() => createCodeBlockCopyPlugin())

  // Create list keymap plugin with Milkdown's $prose utility
  // This plugin handles Tab/Shift+Tab for list indentation and Backspace at list item start
  const listKeymapPluginSlice = $prose((ctx) => {
    const listItemNodeType = listItemSchema.type(ctx)
    return createListKeymapPlugin(listItemNodeType)
  })

  // Create link click plugin for Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) to open links
  const linkClickPluginSlice = $prose(() => createLinkClickPlugin())

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

        // Configure remark-stringify options for consistent markdown output
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet: '-' as const, // Use '-' for bullet markers consistently
          bulletOrdered: '.' as const, // Use '1.' instead of '1)' for ordered lists
          rule: '-' as const, // Use '---' for horizontal rules instead of '***'
          emphasis: '*' as const, // Use *italic* not _italic_
          strong: '*' as const, // Use **bold** not __bold__
          fence: '`' as const, // Use ```code``` not ~~~code~~~
          fences: true, // Use fenced code blocks, not indented
          // Join handler to force tight lists (no blank lines between list items)
          join: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(Array.isArray((options as any).join) ? (options as any).join : []),
            // Return 0 to join list items without blank lines
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (_left: any, _right: any, parent: any) => {
              if (parent && parent.type === 'list') {
                return 0 // No blank lines between list items
              }
              return undefined // Use default behavior for other nodes
            },
          ],
        }))

        // Set up listener for changes
        // Using 'updated' instead of 'markdownUpdated' to avoid errors during unmount.
        // markdownUpdated fires during Milkdown's serialization which can error if
        // the editor context is destroyed mid-process. With 'updated', we control
        // when serialization happens and can skip it if unmounted.
        // NOTE: This only works because we fixed isMountedRef for StrictMode above.
        ctx.get(listenerCtx).updated((updatedCtx) => {
          if (!isMountedRef.current) return
          try {
            const markdown = getMarkdown()(updatedCtx)
            const cleanedMarkdown = cleanMarkdown(markdown)
            onChangeRef.current(cleanedMarkdown)
          } catch (e) {
            // Ignore errors during unmount (context destroyed)
            if (isMountedRef.current) {
              console.error('Milkdown serialization error:', e)
            }
          }
        })
      })
      .use(customCommonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
      .use(remarkTightLists)
      .use(placeholderPluginSlice)
      .use(codeBlockCopyPluginSlice)
      .use(listKeymapPluginSlice)
      .use(linkClickPluginSlice),
    []
  )

  // Auto-focus the editor on mount if requested
  useEffect(() => {
    if (autoFocusRef.current) {
      // Small delay to ensure editor is fully mounted
      const timer = setTimeout(() => {
        if (!isMountedRef.current) return
        const editor = get()
        if (!editor) return
        try {
          const view = editor.ctx.get(editorViewCtx)
          view.focus()
        } catch {
          // Editor context destroyed during unmount
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [get])

  // Link dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkDialogInitialText, setLinkDialogInitialText] = useState('')
  const [linkDialogInitialUrl, setLinkDialogInitialUrl] = useState('')
  const [linkDialogIsEdit, setLinkDialogIsEdit] = useState(false)
  const [linkDialogKey, setLinkDialogKey] = useState(0)

  // Handle link insertion from dialog
  const handleLinkSubmit = useCallback(
    (url: string, text: string) => {
      const editor = get()
      if (!editor) return

      const view = editor.ctx.get(editorViewCtx)
      const linkMarkType = view.state.schema.marks.link

      if (linkDialogIsEdit) {
        // EDITING EXISTING LINK
        // Re-detect link boundaries at submission time using helper
        // ProseMirror positions become invalid after document edits
        // Use current selection (not stale captured position) to handle any cursor movement
        const { from } = view.state.selection
        const linkBoundaries = findLinkBoundaries(view, from, linkMarkType)

        if (!linkBoundaries) {
          // Link no longer exists at cursor position
          // This can happen if:
          // 1. User deleted the link while dialog was open
          // 2. User moved cursor away from the link (if modal allows interaction)
          // Abort edit rather than creating new link at unexpected position
          console.warn('Link edit aborted - link no longer found at cursor position')
          view.focus()
          return
        }

        const tr = view.state.tr

        // Check if text was changed
        const originalText = view.state.doc.textBetween(linkBoundaries.start, linkBoundaries.end)
        if (text !== originalText) {
          // Text changed - replace entire link (new text + new URL)
          const newMark = linkMarkType.create({ href: url })
          const textNode = view.state.schema.text(text, [newMark])
          tr.replaceWith(linkBoundaries.start, linkBoundaries.end, textNode)
        } else {
          // Only URL changed - preserve existing text and formatting (bold/italic/etc)
          tr.removeMark(linkBoundaries.start, linkBoundaries.end, linkMarkType)
          const newMark = linkMarkType.create({ href: url })
          tr.addMark(linkBoundaries.start, linkBoundaries.end, newMark)
        }

        view.dispatch(tr)
        view.focus()
      } else {
        // CREATING NEW LINK
        // Existing logic works fine for new links
        const mark = linkMarkType.create({ href: url })
        const linkNode = view.state.schema.text(text || url, [mark]) // Use URL as fallback if text is empty
        const tr = view.state.tr.replaceSelectionWith(linkNode, false)
        view.dispatch(tr)
        view.focus()
      }
    },
    [get, linkDialogIsEdit]
  )

  // Handle toolbar link button click
  const handleToolbarLinkClick = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    const linkMarkType = view.state.schema.marks.link
    if (!linkMarkType) return

    // Use helper to detect if cursor is in a link
    const linkBoundaries = findLinkBoundaries(view, from, linkMarkType)

    if (linkBoundaries) {
      // Verify selection is fully inside this link
      // If selection extends beyond link, treat as "create new link"
      if (to > linkBoundaries.end) {
        // Selection spans beyond link - ambiguous, create new
        const selectedText = view.state.doc.textBetween(from, to)
        setLinkDialogInitialText(selectedText)
        setLinkDialogInitialUrl('')
        setLinkDialogIsEdit(false)
      } else {
        // EXISTING LINK: Extract href and text
        const href = linkBoundaries.mark.attrs.href || ''
        const linkText = view.state.doc.textBetween(linkBoundaries.start, linkBoundaries.end)

        setLinkDialogInitialText(linkText)
        setLinkDialogInitialUrl(href)
        setLinkDialogIsEdit(true)
      }
    } else {
      // NEW LINK: Use selected text if any
      const selectedText = view.state.doc.textBetween(from, to)
      setLinkDialogInitialText(selectedText)
      setLinkDialogInitialUrl('')
      setLinkDialogIsEdit(false)
    }

    setLinkDialogKey((k) => k + 1)
    setLinkDialogOpen(true)
    onModalStateChange?.(true)
  }, [get, onModalStateChange])

  // Handle link dialog close
  const handleLinkDialogClose = useCallback(() => {
    setLinkDialogOpen(false)
    onModalStateChange?.(false)
  }, [onModalStateChange])

  /**
   * Get the current list context for the selection.
   * Returns { listType, listItemDepth, listDepth, isTask } or null if not in a list.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getListContext = useCallback((view: any) => {
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
        if (!isMountedRef.current) return
        try {
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
        } catch {
          // Editor context destroyed during unmount
        }
      }, 0)
      return
    }

    const { isTask } = ctx

    if (isTask) {
      // Already a task - lift out of list entirely (consistent with bullet/ordered list toggle)
      const listItemNodeType = view.state.schema.nodes.list_item
      liftListItem(listItemNodeType)(view.state, view.dispatch)
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
      if (!isMountedRef.current) return
      try {
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
      } catch {
        // Editor context destroyed during unmount
      }
    }, 0)
  }, [get, getListContext])

  // Handle toolbar code block button click - toggle behavior
  const handleCodeBlockToggle = useCallback(() => {
    const editor = get()
    if (!editor) return

    const view = editor.ctx.get(editorViewCtx)
    const codeBlock = findCodeBlockNode(view.state)

    if (codeBlock) {
      // In code block - convert to paragraph using setBlockType
      const paragraphType = view.state.schema.nodes.paragraph
      setBlockType(paragraphType)(view.state, view.dispatch)
      view.focus()
      return
    }

    // Not in code block - create one
    editor.action(callCommand(createCodeBlockCommand.key))
    view.focus()
  }, [get])

  // Run a Milkdown command helper for keyboard shortcuts
  const runCommand = useCallback(
    (command: Parameters<typeof callCommand>[0]) => {
      const editor = get()
      if (editor) {
        editor.action(callCommand(command))
        const view = editor.ctx.get(editorViewCtx)
        view.focus()
      }
    },
    [get]
  )

  // Handle keyboard shortcuts (Tab/Shift+Tab handled by listKeymapPluginSlice at ProseMirror level)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const isMod = e.metaKey || e.ctrlKey

      // Cmd+K - Insert/edit link
      if (isMod && e.key === 'k') {
        e.preventDefault()
        handleToolbarLinkClick()
        return
      }

      // Cmd+Shift+X - Strikethrough
      if (isMod && e.shiftKey && e.key === 'x') {
        e.preventDefault()
        runCommand(toggleStrikethroughCommand.key)
        return
      }

      // Cmd+E - Inline code
      if (isMod && !e.shiftKey && e.key === 'e') {
        e.preventDefault()
        runCommand(toggleInlineCodeCommand.key)
        return
      }

      // Cmd+Shift+C - Code block (toggle)
      if (isMod && e.shiftKey && e.key === 'c') {
        e.preventDefault()
        handleCodeBlockToggle()
        return
      }

      // Cmd+Shift+7 - Bullet list
      if (isMod && e.shiftKey && e.key === '7') {
        e.preventDefault()
        handleBulletListClick()
        return
      }

      // Cmd+Shift+8 - Ordered list
      if (isMod && e.shiftKey && e.key === '8') {
        e.preventDefault()
        handleOrderedListClick()
        return
      }

      // Cmd+Shift+9 - Task list
      if (isMod && e.shiftKey && e.key === '9') {
        e.preventDefault()
        handleTaskListClick()
        return
      }

      // Cmd+Shift+. - Blockquote
      if (isMod && e.shiftKey && e.key === '.') {
        e.preventDefault()
        runCommand(wrapInBlockquoteCommand.key)
        return
      }

      // Cmd+Shift+- - Horizontal rule
      if (isMod && e.shiftKey && e.key === '-') {
        e.preventDefault()
        runCommand(insertHrCommand.key)
        return
      }
    },
    [get, runCommand, handleCodeBlockToggle, handleBulletListClick, handleOrderedListClick, handleTaskListClick, handleToolbarLinkClick]
  )

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
          // Only return after handling checkbox toggle
          return
        }
        // If click was outside checkbox area, fall through to let ProseMirror handle cursor placement
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
      {!disabled && <EditorToolbar getEditor={get} onLinkClick={handleToolbarLinkClick} onCodeBlockToggle={handleCodeBlockToggle} onBulletListClick={handleBulletListClick} onOrderedListClick={handleOrderedListClick} onTaskListClick={handleTaskListClick} showJinjaTools={showJinjaTools} copyContent={copyContent} />}
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
        onClose={handleLinkDialogClose}
        onSubmit={handleLinkSubmit}
        initialText={linkDialogInitialText}
        initialUrl={linkDialogInitialUrl}
      />
    </>
  )
}

/**
 * MilkdownEditor provides a rich markdown editor that renders inline.
 *
 * Features:
 * - Rich editing with inline markdown rendering
 * - Keyboard shortcuts (Cmd+B, Cmd+I, Cmd+K)
 * - Task list checkbox toggling
 * - Placeholder text when empty
 * - Copy/paste preserves markdown
 *
 * Note: This component should be used via ContentEditor which provides
 * the mode toggle between Markdown (Milkdown) and Text (CodeMirror) modes.
 */
export function MilkdownEditor({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  noPadding = false,
  showJinjaTools = false,
  autoFocus = false,
  copyContent,
  onModalStateChange,
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
        autoFocus={autoFocus}
        copyContent={copyContent}
        onModalStateChange={onModalStateChange}
      />
    </MilkdownProvider>
  )
}
