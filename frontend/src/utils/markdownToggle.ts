/**
 * Utility functions for toggling markdown markers.
 */

/**
 * Result of determining what toggle action to take.
 */
export type ToggleMarkerAction =
  | { type: 'insert' }                // No selection - insert markers
  | { type: 'wrap' }                  // Wrap selection with markers
  | { type: 'unwrap-selection' }      // Markers are inside selection - remove them
  | { type: 'unwrap-surrounding' }    // Markers are outside selection - remove them

/**
 * Determine what action to take when toggling markers.
 * Pure function for testability.
 *
 * @param selectedText - The currently selected text (empty if no selection)
 * @param surroundingBefore - Text immediately before selection (up to marker length)
 * @param surroundingAfter - Text immediately after selection (up to marker length)
 * @param before - The opening marker (e.g., '**' for bold)
 * @param after - The closing marker (e.g., '**' for bold)
 */
export function getToggleMarkerAction(
  selectedText: string,
  surroundingBefore: string,
  surroundingAfter: string,
  before: string,
  after: string
): ToggleMarkerAction {
  // No selection
  if (!selectedText) {
    // Check if cursor is between markers (e.g., **|**) - should toggle off
    if (surroundingBefore === before && surroundingAfter === after) {
      return { type: 'unwrap-surrounding' }
    }
    // Otherwise insert markers
    return { type: 'insert' }
  }

  // Check if selection already includes the markers
  if (
    selectedText.startsWith(before) &&
    selectedText.endsWith(after) &&
    selectedText.length >= before.length + after.length
  ) {
    return { type: 'unwrap-selection' }
  }

  // Check if markers are just outside the selection
  if (surroundingBefore === before && surroundingAfter === after) {
    return { type: 'unwrap-surrounding' }
  }

  // Not wrapped - wrap it
  return { type: 'wrap' }
}
