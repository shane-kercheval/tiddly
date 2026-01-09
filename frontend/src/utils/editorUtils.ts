/**
 * Utility functions for the Milkdown editor.
 */

/**
 * Determines if we should handle clicking on empty space to move cursor.
 * Returns false if there's an existing selection (e.g., from drag selection)
 * to avoid clearing the user's selection.
 */
export function shouldHandleEmptySpaceClick(
  selectionEmpty: boolean,
  target: HTMLElement
): boolean {
  // Don't interfere if there's already a selection (e.g., from drag selection)
  if (!selectionEmpty) {
    return false
  }
  // Only handle clicks on empty space (wrapper or editor container)
  const editorElement = target.closest('.ProseMirror')
  return !editorElement ||
    target === editorElement ||
    target.classList.contains('milkdown-wrapper') ||
    target.classList.contains('milkdown') ||
    target.classList.contains('editor')
}
