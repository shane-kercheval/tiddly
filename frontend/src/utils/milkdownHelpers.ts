/**
 * Helper utilities for Milkdown editor functionality.
 * Separated from the main component file to allow React fast refresh.
 */
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node, Mark, MarkType } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

/**
 * Result of finding a code block node in the document.
 */
export interface CodeBlockNodeResult {
  node: Node
  depth: number
}

/**
 * Find the code_block node containing the selection, if any.
 * Returns the node and its depth, or null if not in a code block.
 */
export function findCodeBlockNode(state: EditorState): CodeBlockNodeResult | null {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'code_block') {
      return { node, depth: d }
    }
  }
  return null
}

/**
 * Result of finding link boundaries in the document.
 */
export interface LinkBoundariesResult {
  start: number
  end: number
  mark: Mark
}

/**
 * Find the boundaries of a link mark at the given cursor position.
 * Uses block-scoped search for performance (O(m) where m = paragraph size).
 *
 * @param view - ProseMirror editor view
 * @param cursorPos - Cursor position to check
 * @param linkMarkType - Link mark type from schema
 * @returns Object with start, end, and mark, or null if not in a link
 */
export function findLinkBoundaries(
  view: EditorView,
  cursorPos: number,
  linkMarkType: MarkType
): LinkBoundariesResult | null {
  const $from = view.state.doc.resolve(cursorPos)

  // Check if cursor is in a link mark
  // CRITICAL: $from.marks() doesn't include marks at exact start position
  // Use nodeAfter fallback to detect cursor at link boundary
  let linkMark = linkMarkType.isInSet($from.marks())

  // Boundary case: cursor at start of link
  if (!linkMark && $from.nodeAfter) {
    linkMark = linkMarkType.isInSet($from.nodeAfter.marks)
  }

  if (!linkMark) return null

  // Find link boundaries by walking current block
  const blockStart = $from.start($from.depth)
  const blockEnd = $from.end($from.depth)

  let linkStart = cursorPos
  let linkEnd = cursorPos

  view.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === linkMarkType)) {
      const nodeEnd = pos + node.nodeSize
      // Check if this text node contains our cursor position
      if (pos <= cursorPos && nodeEnd >= cursorPos) {
        // This is part of our link - expand boundaries
        linkStart = Math.min(linkStart, pos)
        linkEnd = Math.max(linkEnd, nodeEnd)
      }
    }
  })

  return { start: linkStart, end: linkEnd, mark: linkMark }
}
