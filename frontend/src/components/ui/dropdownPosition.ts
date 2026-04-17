/**
 * Pure positioning logic for dropdown portals.
 *
 * No DOM dependency — takes measurements as inputs, returns a CSS left value.
 * Unit testable with zero browser environment needed.
 */

/** Shared dropdown width constants (px). Used for both CSS width and positioning math. */
export const DROPDOWN_WIDTH = {
  /** Single-column tag dropdown (non-AI) */
  TAG: 170,
  /** Single column width within the two-column layout */
  TAG_COLUMN: 170,
  /** Two-column tag dropdown (AI enabled): 2 × TAG_COLUMN */
  TAG_AI: 340,
  /** Relationship search dropdown */
  RELATIONSHIP: 256,
} as const

/**
 * Compute the horizontal `left` position for a fixed-position dropdown.
 *
 * Strategy: left-align by default. If left-aligning would overflow the right
 * edge of the viewport, right-align instead (dropdown's right edge matches
 * anchor's right edge). If right-aligning would overflow the left edge,
 * clamp to left: 0.
 *
 * @param anchorLeft    - anchor element's left edge (from getBoundingClientRect)
 * @param anchorRight   - anchor element's right edge
 * @param dropdownWidth - width of the dropdown content in pixels
 * @param viewportWidth - viewport width (window.innerWidth)
 * @returns the CSS `left` value in pixels
 */
export function computeDropdownLeft(
  anchorLeft: number,
  anchorRight: number,
  dropdownWidth: number,
  viewportWidth: number,
): number {
  // Try left-align: dropdown's left edge at anchor's left edge
  if (anchorLeft + dropdownWidth <= viewportWidth) {
    return anchorLeft
  }

  // Left-align overflows right — try right-align: dropdown's right edge at anchor's right edge
  const rightAligned = anchorRight - dropdownWidth
  if (rightAligned >= 0) {
    return rightAligned
  }

  // Right-align also overflows left — clamp to viewport left edge
  return 0
}
