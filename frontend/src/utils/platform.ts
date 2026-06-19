/**
 * Platform detection and shortcut formatting helpers.
 *
 * Shortcut `keys` are authored as OS-agnostic modifier tokens — `Mod`, `Alt`,
 * `Shift` — followed by the non-modifier key. These helpers render each token to
 * the current platform's form at display time: `Mod` → ⌘ on Mac, "Ctrl"
 * elsewhere. No OS is privileged in the stored data.
 *
 * Authoring convention: modifier-first (`Mod`, then `Alt`, then `Shift`, then the
 * key). Mac renders ⌘⇧B; Windows/Linux renders Ctrl+Shift+B. There is no `Control`
 * token because no shortcut binds the literal Control key (see shortcuts/types.ts).
 */

const MODIFIER_DISPLAY: Record<string, { mac: string; other: string }> = {
  Mod: { mac: '⌘', other: 'Ctrl' },
  Alt: { mac: '⌥', other: 'Alt' },
  Shift: { mac: '⇧', other: 'Shift' },
}

// Legacy Mac glyphs that authored display tokens must NOT use — shortcut data is
// OS-agnostic (`Mod`/`Alt`/`Shift`), rendered to glyphs only at display time.
const LEGACY_MODIFIER_GLYPHS = ['⌘', '⌥', '⇧', '⌃']

/**
 * Reject authored shortcut display tokens that contain a legacy Mac glyph.
 * Used wherever display tokens are hand-authored (registry `display` entries,
 * `Tip.shortcut`) so the OS-agnostic contract is enforced, not just documented.
 * We check only the modifier glyphs — non-modifier tokens are free display
 * strings (`Click`, `↑/↓`, `/`, `\\`), not an enumerable key vocabulary.
 */
export function assertNoLegacyShortcutGlyphs(tokens: readonly string[], context: string): void {
  for (const token of tokens) {
    for (const glyph of LEGACY_MODIFIER_GLYPHS) {
      if (token.includes(glyph)) {
        throw new Error(
          `${context}: token "${token}" uses the Mac glyph "${glyph}" — author OS-agnostic tokens (Mod/Alt/Shift).`,
        )
      }
    }
  }
}

/**
 * Reject a legacy Mac glyph anywhere in a free-text string (tip title/body, docs
 * prose). Where a hardcoded `⌘`/`⌥`/`⇧`/`⌃` renders raw to Windows/Linux users,
 * authors must instead cite shortcuts via `{{shortcut:<id>}}` tokens, which
 * localize at render. Companion to `assertNoLegacyShortcutGlyphs` (which guards
 * authored token *arrays*); this guards prose. We deliberately scan only the
 * four modifier glyphs, not English words like "Cmd"/"Option" — those would
 * false-positive on legitimate prose ("command palette", "command menu").
 */
export function assertNoLegacyGlyphsInText(text: string, context: string): void {
  for (const glyph of LEGACY_MODIFIER_GLYPHS) {
    if (text.includes(glyph)) {
      throw new Error(
        `${context}: contains the Mac glyph "${glyph}" — cite shortcuts via {{shortcut:<id>}} tokens, which localize per-OS.`,
      )
    }
  }
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPhone/iPad/iPod with hardware keyboards use Cmd as the modifier, like Mac.
  return /MAC|IPHONE|IPAD|IPOD/.test(navigator.platform.toUpperCase())
}

/**
 * Translate a single key token to the current platform's display form.
 * Modifier tokens (`Mod`/`Alt`/`Shift`) render per-OS; non-modifier tokens
 * (letters, "Click", "Esc", "/") pass through unchanged.
 */
export function localizeKey(key: string): string {
  const modifier = MODIFIER_DISPLAY[key]
  if (modifier === undefined) return key
  return isMac() ? modifier.mac : modifier.other
}

/** Apply localizeKey across a list of tokens (for the shortcuts dialog). */
export function localizeKeys(keys: readonly string[]): string[] {
  return keys.map(localizeKey)
}

/**
 * Format a shortcut as a single string suitable for a tooltip / aria-label.
 * Mac: tokens joined with no separator (e.g. "⌘⇧B").
 * Windows/Linux: tokens joined with "+" (e.g. "Ctrl+Shift+B").
 */
export function formatShortcut(keys: readonly string[]): string {
  const separator = isMac() ? '' : '+'
  return keys.map(localizeKey).join(separator)
}
