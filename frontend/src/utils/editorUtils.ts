/**
 * Utility functions for the content editors (Milkdown and CodeMirror).
 */

/**
 * CSS class used by Tailwind group for editor focus-within styling.
 * This is the escaped form used in JavaScript selectors.
 */
const EDITOR_GROUP_SELECTOR = '.group\\/editor'

/**
 * Check if the editor was focused when an event occurred.
 * Used to gate toolbar button actions - only execute if toolbar was visible (editor focused).
 *
 * @param eventTarget - The element that received the event (e.g., button clicked)
 * @returns true if the editor had focus, false otherwise
 */
export function wasEditorFocused(eventTarget: HTMLElement): boolean {
  const editorGroup = eventTarget.closest(EDITOR_GROUP_SELECTOR)
  return editorGroup?.contains(document.activeElement) ?? false
}

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
