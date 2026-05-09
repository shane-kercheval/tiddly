/**
 * Platform detection and shortcut formatting helpers.
 *
 * Shortcut data throughout the app is authored using Mac glyphs (⌘ ⌥ ⇧) since
 * that's the most compact form. These helpers translate those tokens to the
 * Windows/Linux convention ("Ctrl", "Alt", "Shift") at render time.
 */

const MAC_GLYPH_CMD = '⌘'
const MAC_GLYPH_OPT = '⌥'
const MAC_GLYPH_SHIFT = '⇧'

// Authoring convention for shortcut arrays consumed by these helpers:
// always lead with ⌘, then ⌥, then ⇧, then the non-modifier key. This
// matches each platform's native modifier order on render — Mac displays
// ⌘⇧B, Windows displays Ctrl+Shift+B (the canonical Windows order). We
// canonicalize at the data layer rather than re-sorting inside formatShortcut
// so the helper stays a pure transform of its input.
const MAC_TO_WINDOWS: Record<string, string> = {
  [MAC_GLYPH_CMD]: 'Ctrl',
  [MAC_GLYPH_OPT]: 'Alt',
  [MAC_GLYPH_SHIFT]: 'Shift',
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPhone/iPad/iPod with hardware keyboards use Cmd as the modifier, like Mac.
  return /MAC|IPHONE|IPAD|IPOD/.test(navigator.platform.toUpperCase())
}

/**
 * Translate a single key token to the current platform's display form.
 * Mac glyphs pass through on Mac and become "Ctrl"/"Alt"/"Shift" elsewhere.
 * Non-modifier tokens (letters, "Click", "Esc", "/") pass through unchanged.
 */
export function localizeKey(key: string): string {
  if (isMac()) return key
  return MAC_TO_WINDOWS[key] ?? key
}

/** Apply localizeKey across a list of tokens (for the shortcuts dialog). */
export function localizeKeys(keys: string[]): string[] {
  return keys.map(localizeKey)
}

/**
 * Format a shortcut as a single string suitable for a tooltip / aria-label.
 * Mac: tokens joined with no separator (e.g. "⌘⇧B").
 * Windows/Linux: tokens joined with "+" (e.g. "Ctrl+Shift+B").
 */
export function formatShortcut(keys: string[]): string {
  if (isMac()) return keys.join('')
  return keys.map(localizeKey).join('+')
}
