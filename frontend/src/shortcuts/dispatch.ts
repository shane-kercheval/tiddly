/**
 * Synthesize a KeyboardEvent matching a registry entry's match shape and
 * dispatch it to `document` so global keydown listeners pick it up.
 *
 * Used for CM-passthrough cases (Cmd+Shift+/) where CodeMirror binds the key
 * just to consume it before its default keymap interferes, then forwards the
 * event to the global handler.
 */

import { isMac } from '../utils/platform'
import { getShortcut, type ShortcutId } from './registry'
import { CAPTURE_PHASE_IDS } from './capturePhase'

/**
 * Throws on:
 * - Display-only entries (no match — can't dispatch what's not actionable).
 * - Capture-phase ids — synthetic events would re-traverse the capture phase.
 * - Code-based entries — capture-phase concern by design.
 *
 * Synthesizes the event per `entry.match`: `mod: true` → `metaKey: isMac()`,
 * `ctrlKey: !isMac()`. `shift`/`alt` set per match. Undefined modifiers stay
 * `false` — synthesizing arbitrary modifiers would break the strict-match
 * contract in the matcher.
 */
export function dispatchRegistryShortcut(id: ShortcutId): void {
  const shortcut = getShortcut(id)

  if (!shortcut.match) {
    throw new Error(
      `dispatchRegistryShortcut: '${id}' has no match (display-only entry); cannot dispatch.`,
    )
  }
  if (CAPTURE_PHASE_IDS.includes(id)) {
    throw new Error(
      `dispatchRegistryShortcut: '${id}' is a capture-phase id; ` +
      `synthetic dispatch would double-fire. Use only for bubble-phase ids.`,
    )
  }
  if (shortcut.match.code !== undefined) {
    throw new Error(
      `dispatchRegistryShortcut: '${id}' uses match.code (capture-phase concern); cannot dispatch.`,
    )
  }

  const wantMod = shortcut.match.mod === true
  const event = new KeyboardEvent('keydown', {
    key: shortcut.match.key,
    metaKey: wantMod && isMac(),
    ctrlKey: wantMod && !isMac(),
    shiftKey: shortcut.match.shift === true,
    altKey: shortcut.match.alt === true,
    bubbles: true,
  })
  document.dispatchEvent(event)
}
