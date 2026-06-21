/**
 * Translate registry entries to CodeMirror KeyBindings.
 *
 * The adapter is a pure translator — CodeMirror still binds and dispatches.
 *
 * TRANSLATION TABLE (match → CM keymap string):
 *   { mod: true, key: 'b' }                   → 'Mod-b'
 *   { mod: true, shift: true, key: 'x' }      → 'Mod-Shift-x'
 *   { mod: true, shift: true, key: '/' }      → 'Mod-Shift-/'
 *   { mod: true, shift: true, key: '-' }      → 'Mod-Shift--'  (literal dash)
 *   { mod: true, shift: true, key: '7' }      → 'Mod-Shift-7'
 *   { alt: true, shift: true, key: 'x' }      → 'Alt-Shift-x'
 *   { key: 'Escape' }                         → 'Escape'
 *
 * THROWS on entries with `match.code` set — those belong to the capture-phase
 * listener path, not CodeMirror's keymap.
 *
 * THROWS on entries without `match` — display-only entries (upstream-owned,
 * non-keyboard) cannot be CM keymap entries. Silent-skip would let an
 * accidentally-included display-only id disappear into a "binding never fires"
 * mystery — exactly the drift the registry prevents.
 */

import type { KeyBinding, EditorView } from '@codemirror/view'
import { getShortcut, type ShortcutId } from '../registry'
import type { ShortcutMatch } from '../types'

/**
 * @param ids - Tuple of registered shortcut ids the editor owns.
 * @param handlers - Map from id to CodeMirror command. Returning `true`
 *   consumes the event (preventing fallback bindings); `false` lets it flow.
 */
export function toCodeMirrorKeymap<Ids extends readonly ShortcutId[]>(
  ids: Ids,
  handlers: Record<Ids[number], (view: EditorView) => boolean>,
): KeyBinding[] {
  const bindings: KeyBinding[] = []
  for (const id of ids) {
    const shortcut = getShortcut(id)
    if (!shortcut.match) {
      // Display-only entry (upstream-owned or non-keyboard). A direct test for
      // this throw will be possible once an upstream-owned, no-match entry (e.g.
      // Cmd+D) becomes a real registry entry that could accidentally end up in
      // CM_KEYMAP_IDS.
      throw new Error(
        `toCodeMirrorKeymap: shortcut '${shortcut.id}' has no match (display-only entry); ` +
        `CM keymap tuples must contain only actionable bindings.`,
      )
    }
    if (shortcut.match.code !== undefined) {
      throw new Error(
        `toCodeMirrorKeymap: shortcut '${shortcut.id}' uses match.code; ` +
        `code-based entries belong to the capture-phase listener, not the CM keymap.`,
      )
    }
    const handler = handlers[id as Ids[number]]
    bindings.push({
      key: matchToKeyString(shortcut.match),
      run: handler,
    })
  }
  return bindings
}

/**
 * Exported for direct unit testing of the translation table. Not intended
 * for general consumption — use `toCodeMirrorKeymap` instead.
 *
 * Validation rules mirror `toCodeMirrorKeymap`: throws on `match.code` set
 * (capture-phase concern) and on missing `match.key` (malformed entry).
 */
export function matchToKeyString(match: ShortcutMatch): string {
  if (match.code !== undefined) {
    throw new Error(
      'matchToKeyString: match.code is for the capture-phase listener path, not CM keymap.',
    )
  }
  if (match.key === undefined) {
    throw new Error('matchToKeyString: match.key is required')
  }
  const parts: string[] = []
  if (match.mod) parts.push('Mod')
  if (match.alt) parts.push('Alt')
  if (match.shift) parts.push('Shift')
  parts.push(match.key)
  return parts.join('-')
}
