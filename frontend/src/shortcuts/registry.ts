/**
 * Single source of truth for keyboard shortcut definitions.
 *
 * Each entry pairs display tokens (`keys`) with an event matcher (`match`).
 * Consumers (hooks, editor adapters) reference entries by stable `id`; display
 * surfaces (ShortcutsDialog, DocsShortcuts, tooltips) read tokens from here.
 *
 * SCOPE
 * -----
 * Key-combo bindings only. Commands without keyboard shortcuts (toolbar
 * buttons, slash menu items) live in their own sidecar tables and join with
 * registry entries by id.
 *
 * `match`-OMITTED ENTRIES — STRICT RULES
 * --------------------------------------
 * Omitting `match` is allowed in exactly two cases:
 *
 *   1. Upstream-owned bindings — bound by a library we don't control
 *      (Milkdown commonmark for ⌘B/⌘I; CodeMirror's searchKeymap for ⌘D).
 *      Comment on the entry must point to the upstream source. A smoke test
 *      asserts the upstream binding still works.
 *
 *   2. Non-keyboard interactions — mouse modifiers (⌘+Click, ⇧+Click) and
 *      paste-event hints. No runtime match exists.
 *
 * Anything else without `match` is a code smell. If we own the binding, the
 * registry entry MUST include `match` — otherwise the entry is documentation
 * pretending to be source-of-truth, which is exactly the drift the registry
 * is meant to prevent.
 *
 * AUTHORING CONVENTION
 * --------------------
 * Cmd-first display tokens: ⌘, then ⌥, then ⇧, then the non-modifier. Use
 * raw glyphs ('⌘', '⇧'), not `\u`-escapes. The `keys ↔ match` coherence test
 * in `registry.test.ts` enforces alignment between display and matcher.
 */

import type { Shortcut } from './types'

/**
 * The eight global shortcuts seeded in M1. Editor-section entries land in
 * later milestones. Order within a section controls dialog row order.
 */
export const SHORTCUTS = [
  // --- Navigation -----------------------------------------------------------
  {
    id: 'app.focusSearch',
    label: 'Search',
    section: 'Navigation',
    keys: ['/'],
    match: { key: '/' },
  },
  {
    id: 'app.focusPageSearch',
    label: 'Focus page search',
    section: 'Navigation',
    keys: ['s'],
    match: { key: 's' },
  },
  {
    id: 'app.commandPalette',
    label: 'Command palette',
    section: 'Navigation',
    keys: ['⌘', '⇧', 'P'],
    match: { mod: true, shift: true, key: 'p' },
    allowInInputs: true,
  },
  {
    id: 'app.escape',
    label: 'Close modal / Unfocus search',
    section: 'Navigation',
    keys: ['Esc'],
    match: { key: 'Escape' },
    allowInInputs: true,
    // Today's code intentionally lets Escape reach native targets so
    // contenteditable, native form semantics, and modal-close handlers see it.
    preventDefault: false,
  },

  // --- View -----------------------------------------------------------------
  {
    id: 'app.toggleWidth',
    label: 'Toggle full-width layout',
    section: 'View',
    keys: ['w'],
    match: { key: 'w' },
  },
  {
    id: 'app.toggleSidebar',
    label: 'Toggle sidebar',
    section: 'View',
    keys: ['⌘', '\\'],
    match: { mod: true, key: '\\' },
    allowInInputs: true,
  },
  {
    id: 'app.toggleHistorySidebar',
    label: 'Toggle history sidebar',
    section: 'View',
    keys: ['⌘', '⇧', '\\'],
    match: { mod: true, shift: true, key: '\\' },
    allowInInputs: true,
  },
  {
    id: 'app.showShortcuts',
    label: 'Show shortcuts',
    section: 'View',
    keys: ['⌘', '⇧', '/'],
    match: { mod: true, shift: true, key: '/' },
    allowInInputs: true,
  },
] as const satisfies readonly Shortcut[]

/** Compile-time-narrow id union — typos in selectors fail to compile. */
export type ShortcutId = typeof SHORTCUTS[number]['id']

/** Compile-time-narrow section union for selector signatures. */
export type Section = typeof SHORTCUTS[number]['section']

/**
 * Dialog column / section ordering. Single source of truth for layout.
 *
 * Sections are broadly typed (`string`) rather than `Section` so this
 * constant can list sections that are not yet present in `SHORTCUTS`
 * (e.g., 'Actions' and 'Markdown Editor' arrive in later milestones).
 * The forward direction — every section in `SHORTCUTS` must appear here —
 * is enforced by `registry.test.ts:section coverage`.
 */
export const SECTION_LAYOUT = [
  { column: 'left', sections: ['Actions', 'Navigation', 'View'] },
  { column: 'right', sections: ['Markdown Editor'] },
] as const satisfies readonly { column: 'left' | 'right'; sections: readonly string[] }[]

/**
 * Build the id → entry map at module load. Throw on duplicate id rather than
 * silently overwriting — duplicates are structural authoring bugs, not a
 * runtime condition we want to paper over.
 */
const SHORTCUTS_BY_ID: Map<string, Shortcut> = (() => {
  const map = new Map<string, Shortcut>()
  for (const shortcut of SHORTCUTS) {
    if (map.has(shortcut.id)) {
      throw new Error(`Duplicate shortcut id in SHORTCUTS: '${shortcut.id}'`)
    }
    map.set(shortcut.id, shortcut)
  }
  return map
})()

/**
 * Look up a shortcut by id. Throws on unknown ids — the `ShortcutId` union
 * catches typos at compile time, this is the runtime backstop.
 */
export function getShortcut(id: ShortcutId): Shortcut {
  const shortcut = SHORTCUTS_BY_ID.get(id)
  if (!shortcut) {
    throw new Error(`Unknown shortcut id: ${id}`)
  }
  return shortcut
}

/** Return all entries in the given section, in registry declaration order. */
export function getShortcutsBySection(section: Section): readonly Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.section === section)
}

/** Return all registered shortcuts in registry order. */
export function getAllShortcuts(): readonly Shortcut[] {
  return SHORTCUTS
}
