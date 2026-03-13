/**
 * Color interpolation utilities for progressive character limit feedback.
 *
 * Provides linear interpolation between RGB color stops to create
 * smooth color transitions as users approach character limits.
 * Matches the Chrome Extension color palette.
 */

/** RGB color tuple */
type RGB = readonly [number, number, number]

/** Color stop definitions for limit feedback */
export const LIMIT_COLORS = {
  gray:        [209, 213, 219] as RGB,  // #d1d5db (gray-300, used for short field fade-in)
  grayContent: [156, 163, 175] as RGB,  // #9ca3af (gray-400, used for content always-visible counter)
  textLight:   [17, 24, 39]   as RGB,   // #111827
  textDark:    [224, 224, 224] as RGB,   // #e0e0e0
  orangeLight: [217, 119, 6]  as RGB,   // #d97706
  orangeDark:  [251, 191, 36] as RGB,   // #fbbf24
  redLight:    [220, 38, 38]  as RGB,   // #dc2626
  redDark:     [252, 165, 165] as RGB,  // #fca5a5
} as const

/**
 * Linearly interpolate between two RGB colors.
 * @param c1 - Start color RGB tuple
 * @param c2 - End color RGB tuple
 * @param t - Interpolation factor (0 = c1, 1 = c2), clamped to [0, 1]
 * @returns Hex color string (e.g. "#9ca3af")
 */
export function lerpColor(c1: RGB, c2: RGB, t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  return '#' + c1.map((v, i) =>
    Math.round(v + (c2[i] - v) * clamped).toString(16).padStart(2, '0')
  ).join('')
}

/**
 * Get the feedback color for a given ratio of current/max length.
 *
 * For short fields (default mode):
 * - 0.7–0.85: gray → text color
 * - 0.85–1.0+: orange → red
 *
 * For content fields (alwaysShow mode):
 * - below 0.85: static gray
 * - 0.85–1.0+: orange → red
 *
 * @param ratio - current length / max length
 * @param isDark - whether dark mode is active
 * @param alwaysShow - if true, use content field color logic (gray below 85%)
 */
export function getLimitColor(ratio: number, isDark: boolean, alwaysShow: boolean = false): string {
  if (alwaysShow) {
    // Content fields: gray below 85%, orange→red from 85%+
    if (ratio < 0.85) {
      return '#9ca3af' // gray-400
    }
    const t = (ratio - 0.85) / 0.15
    const from = isDark ? LIMIT_COLORS.orangeDark : LIMIT_COLORS.orangeLight
    const to = isDark ? LIMIT_COLORS.redDark : LIMIT_COLORS.redLight
    return lerpColor(from, to, t)
  }

  // Short fields: gray→text 70-85%, orange→red 85%+
  if (ratio <= 0.85) {
    const t = (ratio - 0.7) / 0.15
    return lerpColor(LIMIT_COLORS.gray, isDark ? LIMIT_COLORS.textDark : LIMIT_COLORS.textLight, t)
  }
  const t = (ratio - 0.85) / 0.15
  const from = isDark ? LIMIT_COLORS.orangeDark : LIMIT_COLORS.orangeLight
  const to = isDark ? LIMIT_COLORS.redDark : LIMIT_COLORS.redLight
  return lerpColor(from, to, t)
}
