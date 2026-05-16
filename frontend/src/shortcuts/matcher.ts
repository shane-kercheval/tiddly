/**
 * Match a keyboard event against a registry entry's `match` shape.
 *
 * Modifier flags are STRICT: an undefined flag means the modifier MUST NOT
 * be pressed. This matches today's hand-rolled handlers (Cmd+\ doesn't fire
 * while Shift is held because Cmd+Shift+\ is a different shortcut). Permissive
 * matching plus first-wins iteration would make registry order load-bearing —
 * exactly the spooky-action-at-a-distance the registry is supposed to prevent.
 *
 * `match` is a pure event-shape predicate. Dispatch policy (allowInInputs,
 * preventDefault) lives at the entry root and is the hook's concern, not the
 * matcher's.
 */

import type { Shortcut, ShortcutMatch } from './types'

/** True if this is a single ASCII letter (regardless of case). */
function isSingleLetter(s: string): boolean {
  return s.length === 1 && /^[a-z]$/i.test(s)
}

/**
 * Test whether a keyboard event satisfies a `match` shape.
 *
 * The schema's discriminated union guarantees exactly one of `key`/`code` is
 * set per entry, so the function dispatches on which one is present.
 * Single-letter `key` values compare case-insensitively to absorb browser
 * variance for Cmd+Shift+letter (some browsers report 'M', others 'm').
 * Non-alpha keys ('/', 'Escape', '\\') compare exactly.
 */
export function matches(event: KeyboardEvent, match: ShortcutMatch): boolean {
  const wantMod = match.mod === true
  const wantShift = match.shift === true
  const wantAlt = match.alt === true

  const hasMod = event.metaKey || event.ctrlKey
  if (hasMod !== wantMod) return false
  if (event.shiftKey !== wantShift) return false
  if (event.altKey !== wantAlt) return false

  if (match.code !== undefined) {
    return event.code === match.code
  }
  // Schema XOR: when code is unset, key is set.
  if (isSingleLetter(match.key)) {
    return event.key.toLowerCase() === match.key.toLowerCase()
  }
  return event.key === match.key
}

/**
 * Walk shortcuts in order and return the first whose `match` fires for this
 * event, or undefined. Entries without `match` (display-only) are skipped.
 *
 * "First match wins" is the documented behavior — see the test
 * `findMatchingShortcut > returns the first byte-equal match in iteration order`.
 * In real usage, byte-equal duplicates are caught at hook-mount time by
 * `useGlobalShortcuts.assertNoDuplicateMatchShapes`.
 */
export function findMatchingShortcut(
  event: KeyboardEvent,
  shortcuts: readonly Shortcut[],
): Shortcut | undefined {
  for (const shortcut of shortcuts) {
    if (shortcut.match && matches(event, shortcut.match)) {
      return shortcut
    }
  }
  return undefined
}
