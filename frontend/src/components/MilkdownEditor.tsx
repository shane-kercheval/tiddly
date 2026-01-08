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
} from '@milkdown/kit/preset/commonmark'

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
 * Uses the decoration system - the standard approach for ProseMirror-based editors.
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
          return DecorationSet.create(doc, [
            Decoration.widget(1, () => {
              const span = document.createElement('span')
              span.className = 'milkdown-placeholder'
              span.textContent = placeholder
              return span
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
}

interface MilkdownEditorInnerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  minHeight?: string
  placeholder?: string
}

function MilkdownEditorInner({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
}: MilkdownEditorInnerProps): ReactNode {
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Create placeholder plugin with Milkdown's $prose utility
  const placeholderPluginSlice = $prose(() => createPlaceholderPlugin(placeholder))

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

  // Handle checkbox clicks for task list items
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const listItem = target.closest('li[data-item-type="task"]') as HTMLElement | null

      if (listItem) {
        // Check if click was on the checkbox area (left side of the item)
        const rect = listItem.getBoundingClientRect()
        const clickX = e.clientX - rect.left

        // Only toggle if clicking in the first 30px (checkbox area)
        if (clickX < 30) {
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
      }
    },
    [get]
  )

  return (
    <>
      <div
        className={`milkdown-wrapper ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
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
}: MilkdownEditorProps): ReactNode {
  // Stable callback to prevent unnecessary re-renders
  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue)
    },
    [onChange]
  )

  return (
    <MilkdownProvider>
      <MilkdownEditorInner
        value={value}
        onChange={handleChange}
        disabled={disabled}
        minHeight={minHeight}
        placeholder={placeholder}
      />
    </MilkdownProvider>
  )
}
