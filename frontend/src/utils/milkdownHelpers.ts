/**
 * Helper utilities for Milkdown editor functionality.
 * Separated from the main component file to allow React fast refresh.
 */
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/prose/model'

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
