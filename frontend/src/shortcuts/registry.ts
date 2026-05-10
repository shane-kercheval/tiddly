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
    label: 'Focus Page Search',
    section: 'Navigation',
    keys: ['s'],
    match: { key: 's' },
  },
  {
    id: 'app.commandPalette',
    label: 'Command Palette',
    section: 'Navigation',
    keys: ['⌘', '⇧', 'P'],
    match: { mod: true, shift: true, key: 'p' },
    allowInInputs: true,
  },
  {
    id: 'app.escape',
    label: 'Close Modal / Unfocus Search',
    section: 'Navigation',
    keys: ['Esc'],
    match: { key: 'Escape' },
    allowInInputs: true,
    // Today's code intentionally lets Escape reach native targets so
    // contenteditable, native form semantics, and modal-close handlers see it.
    preventDefault: false,
  },
  // Display-only non-keyboard entries. Bound in card/relationship click handlers.
  // Distinct ids from `editor.openLinkInNewTab` (Markdown Editor section) per
  // the "Distinct ids for same display tokens in different contexts" rule.
  {
    id: 'card.openInNewTab',
    label: 'Open Card in New Tab',
    section: 'Navigation',
    keys: ['⌘', 'Click'],
    // Bound at frontend/src/components/ContentCard/ContentCard.tsx:50.
  },
  {
    id: 'relationship.openInTiddly',
    label: 'Open Bookmark Relationship in Tiddly (instead of URL)',
    section: 'Navigation',
    keys: ['⇧', 'Click'],
    // Bound at frontend/src/hooks/useLinkedNavigation.ts:21.
  },

  // --- View -----------------------------------------------------------------
  {
    id: 'app.toggleWidth',
    label: 'Toggle Full-Width Layout',
    section: 'View',
    keys: ['w'],
    match: { key: 'w' },
  },
  {
    id: 'app.toggleSidebar',
    label: 'Toggle Sidebar',
    section: 'View',
    keys: ['⌘', '\\'],
    match: { mod: true, key: '\\' },
    allowInInputs: true,
  },
  {
    id: 'app.toggleHistorySidebar',
    label: 'Toggle History Sidebar',
    section: 'View',
    keys: ['⌘', '⇧', '\\'],
    match: { mod: true, shift: true, key: '\\' },
    allowInInputs: true,
  },
  {
    id: 'app.showShortcuts',
    label: 'Show Shortcuts',
    section: 'View',
    keys: ['⌘', '⇧', '/'],
    match: { mod: true, shift: true, key: '/' },
    allowInInputs: true,
  },
  // Editor-View entries — capture-phase, code-based.
  // `match.code` is used here for two reasons:
  //   - Alt+Z/L/M/T: Mac Option-letter conversion (Option+Z reports event.key='Ω' etc.).
  //   - Cmd+Shift+M: layout-stable physical-key matching across keyboard layouts.
  // Both are documented at the schema rule in the plan; do NOT migrate to `key`.
  {
    id: 'editor.toggleReadingMode',
    label: 'Toggle Reading Mode',
    section: 'View',
    keys: ['⌘', '⇧', 'M'],
    match: { mod: true, shift: true, code: 'KeyM' },
  },
  {
    id: 'editor.toggleWordWrap',
    label: 'Toggle Word Wrap',
    section: 'View',
    keys: ['⌥', 'Z'],
    match: { alt: true, code: 'KeyZ' },
  },
  {
    id: 'editor.toggleLineNumbers',
    label: 'Toggle Line Numbers',
    section: 'View',
    keys: ['⌥', 'L'],
    match: { alt: true, code: 'KeyL' },
  },
  {
    id: 'editor.toggleMonoFont',
    label: 'Toggle Monospace Font',
    section: 'View',
    keys: ['⌥', 'M'],
    match: { alt: true, code: 'KeyM' },
  },
  {
    id: 'editor.toggleToc',
    label: 'Toggle Table of Contents',
    section: 'View',
    keys: ['⌥', 'T'],
    match: { alt: true, code: 'KeyT' },
  },

  // --- Markdown Editor -----------------------------------------------------
  // Title Case labels are the single canonical text — used both in the
  // toolbar tooltip and in the dialog/docs row.
  {
    id: 'editor.bold',
    label: 'Bold',
    section: 'Markdown Editor',
    keys: ['⌘', 'B'],
    match: { mod: true, key: 'b' },
  },
  {
    id: 'editor.italic',
    label: 'Italic',
    section: 'Markdown Editor',
    keys: ['⌘', 'I'],
    match: { mod: true, key: 'i' },
  },
  {
    id: 'editor.strikethrough',
    label: 'Strikethrough',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', 'X'],
    match: { mod: true, shift: true, key: 'x' },
  },
  {
    id: 'editor.highlight',
    label: 'Highlight',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', 'H'],
    match: { mod: true, shift: true, key: 'h' },
  },
  {
    id: 'editor.blockquote',
    label: 'Blockquote',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', '.'],
    match: { mod: true, shift: true, key: '.' },
  },
  {
    id: 'editor.inlineCode',
    label: 'Inline Code',
    section: 'Markdown Editor',
    keys: ['⌘', 'E'],
    match: { mod: true, key: 'e' },
  },
  {
    // CM variant of code block (⌘⇧E). Milkdown's ⌘⇧C lands as
    // editor.codeBlock.milkdown in M4 — disagree pattern (two ids).
    id: 'editor.codeBlock.cm',
    label: 'Code Block',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', 'E'],
    match: { mod: true, shift: true, key: 'e' },
  },
  {
    id: 'editor.bulletList',
    label: 'Bullet List',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', '7'],
    match: { mod: true, shift: true, key: '7' },
  },
  {
    id: 'editor.numberedList',
    label: 'Numbered List',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', '8'],
    match: { mod: true, shift: true, key: '8' },
  },
  {
    id: 'editor.checklist',
    label: 'Checklist',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', '9'],
    match: { mod: true, shift: true, key: '9' },
  },
  {
    id: 'editor.insertLink',
    label: 'Insert Link',
    section: 'Markdown Editor',
    keys: ['⌘', 'K'],
    match: { mod: true, key: 'k' },
  },
  {
    id: 'editor.horizontalRule',
    label: 'Horizontal Rule',
    section: 'Markdown Editor',
    keys: ['⌘', '⇧', '-'],
    match: { mod: true, shift: true, key: '-' },
  },
  // Capture-phase entry. `match.code: 'Slash'` for layout-stable matching
  // (German layout: event.key='/' requires Shift+7, conflicts with bullet-list).
  {
    id: 'editor.commandMenu',
    label: 'Command Menu',
    section: 'Markdown Editor',
    keys: ['⌘', '/'],
    match: { mod: true, code: 'Slash' },
  },
  // Display-only — non-keyboard (mouse modifier in MilkdownEditor link click plugin).
  // No `match`. Distinct from `card.openInNewTab` (Navigation section, future).
  {
    id: 'editor.openLinkInNewTab',
    label: 'Open Link in New Tab',
    section: 'Markdown Editor',
    keys: ['⌘', 'Click'],
  },
  // Display-only — upstream-owned by @codemirror/search's searchKeymap.
  // The search() extension at CodeMirrorEditor auto-registers Mod-d → selectNextOccurrence.
  // Plugin-presence smoke test in CodeMirrorEditor.test.tsx asserts the binding exists.
  {
    id: 'editor.selectNextOccurrence',
    label: 'Select Next Occurrence',
    section: 'Markdown Editor',
    keys: ['⌘', 'D'],
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
