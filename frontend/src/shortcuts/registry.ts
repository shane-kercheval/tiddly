/**
 * Keyboard shortcut registry — loads and validates the canonical data in
 * `shortcuts.json`.
 *
 * SOURCE OF TRUTH
 * ---------------
 * `shortcuts.json` is the single source. Each entry sets exactly one of:
 *   - `match` — the event matcher for a keyboard shortcut. The OS-agnostic
 *     display tokens (`keys`) are *derived* from it (`deriveDisplayTokens`), so
 *     display can never drift from the binding — there is no separate `keys`
 *     field to keep in sync.
 *   - `display` — explicit OS-agnostic tokens for the matchless display-only
 *     categories (upstream-owned bindings; non-keyboard interactions like mouse
 *     modifiers and paste hints), which have no matcher to derive from.
 * Plus dispatch flags and a maintainer `note`. Code reads it; nothing else
 * defines shortcut data. The same data (projected) is served to agents/clients.
 * Display tokens are OS-agnostic (`Mod`/`Alt`/`Shift`); the matcher uses `mod`
 * (= Cmd-or-Ctrl) — see `types.ts` for the no-Control note.
 *
 * COMPILE-TIME IDS
 * ----------------
 * `ShortcutId` is the hand-maintained union below. TypeScript can't derive a
 * literal union from a runtime-loaded JSON file, so the union is authored here
 * and a test (`registry.test.ts`) asserts it matches `shortcuts.json` exactly —
 * add a shortcut to the JSON without adding its id here and the test fails loudly.
 * This keeps build-time typo-safety on the ~40 selector call sites while the JSON
 * stays the data source.
 */

import shortcutsData from './shortcuts.json'
import { assertNoLegacyShortcutGlyphs } from '../utils/platform'
import type { Section, Shortcut, ShortcutMatch } from './types'

export type { Section } from './types'

/**
 * Every shortcut id. Kept in sync with `shortcuts.json` by a test. Order is not
 * significant here (the registry's order comes from the JSON array).
 */
export const SHORTCUT_IDS = [
  'bookmark.pasteUrl',
  'bookmark.openLinkSilent',
  'app.focusSearch',
  'app.focusPageSearch',
  'app.commandPalette',
  'app.escape',
  'card.openInNewTab',
  'relationship.openInTiddly',
  'app.toggleWidth',
  'app.toggleSidebar',
  'app.toggleHistorySidebar',
  'app.toggleSidebarMaxWidth',
  'app.showShortcuts',
  'editor.toggleReadingMode',
  'editor.toggleWordWrap',
  'editor.toggleLineNumbers',
  'editor.toggleMonoFont',
  'editor.toggleToc',
  'editor.bold',
  'editor.italic',
  'editor.strikethrough',
  'editor.highlight',
  'editor.blockquote',
  'editor.inlineCode',
  'editor.codeBlock',
  'editor.bulletList',
  'editor.numberedList',
  'editor.checklist',
  'editor.insertLink',
  'editor.horizontalRule',
  'editor.commandMenu',
  'editor.openLinkInNewTab',
  'editor.selectNextOccurrence',
  'editor.selectAllOccurrences',
] as const

/** Compile-time-narrow id union — typos in selectors fail to compile. */
export type ShortcutId = typeof SHORTCUT_IDS[number]

const VALID_SECTIONS: ReadonlySet<Section> = new Set<Section>([
  'Actions',
  'Navigation',
  'View',
  'Markdown Editor',
])

// Physical `code` values that display as punctuation rather than a letter/digit.
const CODE_TO_SYMBOL: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Period: '.',
  Comma: ',',
  Equal: '=',
  Quote: "'",
  Semicolon: ';',
}

// `event.key` values with a conventional short display name.
const KEY_TO_SYMBOL: Record<string, string> = {
  Escape: 'Esc',
}

/** The display symbol for a match's non-modifier key (from `key` or `code`). */
function keyDisplay(match: ShortcutMatch, hasModifier: boolean): string {
  if (match.code !== undefined) {
    const letter = /^Key([A-Z])$/.exec(match.code)
    if (letter) return letter[1]
    const digit = /^Digit([0-9])$/.exec(match.code)
    if (digit) return digit[1]
    return CODE_TO_SYMBOL[match.code] ?? match.code
  }
  const key = match.key
  if (KEY_TO_SYMBOL[key] !== undefined) return KEY_TO_SYMBOL[key]
  // Single letters render uppercase when combined with a modifier (⌘B), but
  // bare keys render lowercase (`s`, `w`) to signal "no Shift" to the reader.
  if (/^[a-z]$/i.test(key)) return hasModifier ? key.toUpperCase() : key.toLowerCase()
  return key
}

/**
 * Derive OS-agnostic display tokens from a matcher: modifier-first (Mod, Alt,
 * Shift) then the key symbol. This is why keyboard entries don't store `keys` —
 * display is a pure projection of the matcher, so the two can't drift.
 */
function deriveDisplayTokens(match: ShortcutMatch): string[] {
  // Strict `=== true` to mirror the matcher (matcher.ts), so display can't
  // advertise a modifier the matcher won't require (and vice versa).
  const tokens: string[] = []
  if (match.mod === true) tokens.push('Mod')
  if (match.alt === true) tokens.push('Alt')
  if (match.shift === true) tokens.push('Shift')
  tokens.push(keyDisplay(match, tokens.length > 0))
  return tokens
}

const ALLOWED_MATCH_FIELDS = new Set(['mod', 'shift', 'alt', 'key', 'code'])

/**
 * Validate the `match` object: only known fields, modifier flags boolean,
 * key/code string, exactly one of key/code. Restores the excess-property and
 * type safety the old `as const satisfies` gave — a typo like `shfit` or a
 * mistyped `"mod": "true"` now fails at load instead of silently mis-binding.
 */
function validateMatch(id: string, raw: unknown): ShortcutMatch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Shortcut '${id}' match must be an object.`)
  }
  const match = raw as Record<string, unknown>
  for (const field of Object.keys(match)) {
    if (!ALLOWED_MATCH_FIELDS.has(field)) {
      throw new Error(`Shortcut '${id}' match has unknown field '${field}' (allowed: mod, shift, alt, key, code).`)
    }
  }
  for (const flag of ['mod', 'shift', 'alt'] as const) {
    if (match[flag] !== undefined && typeof match[flag] !== 'boolean') {
      throw new Error(`Shortcut '${id}' match.${flag} must be a boolean.`)
    }
  }
  const hasKey = match.key !== undefined
  const hasCode = match.code !== undefined
  if (hasKey === hasCode) {
    throw new Error(`Shortcut '${id}' match must set exactly one of 'key' or 'code'.`)
  }
  if (hasKey && typeof match.key !== 'string') {
    throw new Error(`Shortcut '${id}' match.key must be a string.`)
  }
  if (hasCode && typeof match.code !== 'string') {
    throw new Error(`Shortcut '${id}' match.code must be a string.`)
  }
  return match as unknown as ShortcutMatch
}

/** Validate an optional boolean dispatch flag. */
function validateBooleanFlag(id: string, name: string, value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`Shortcut '${id}' ${name} must be a boolean when present.`)
  }
  return value
}

/**
 * Validate one raw JSON entry and build a `Shortcut` (with derived `keys`).
 * Fail-fast with an actionable message — a malformed entry is an authoring bug,
 * not a runtime condition to paper over (this replaces the compile-time
 * `as const satisfies` guarantee the old TS array gave).
 *
 * An entry sets exactly one of `match` (keyboard — `keys` derived from it) or
 * `display` (the matchless display-only categories — explicit tokens).
 */
function validateEntry(raw: unknown): Shortcut {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Shortcut entry is not an object: ${JSON.stringify(raw)}`)
  }
  const entry = raw as Record<string, unknown>
  const id = entry.id
  if (typeof id !== 'string') {
    throw new Error(`Shortcut entry is missing a string id: ${JSON.stringify(raw)}`)
  }
  if (typeof entry.label !== 'string' || entry.label.length === 0) {
    throw new Error(`Shortcut '${id}' is missing a label.`)
  }
  if (typeof entry.section !== 'string' || !VALID_SECTIONS.has(entry.section as Section)) {
    throw new Error(`Shortcut '${id}' has an invalid section: ${JSON.stringify(entry.section)}`)
  }
  if (entry.note !== undefined && typeof entry.note !== 'string') {
    throw new Error(`Shortcut '${id}' note must be a string when present.`)
  }

  const hasMatch = entry.match !== undefined
  const hasDisplay = entry.display !== undefined
  if (hasMatch === hasDisplay) {
    throw new Error(`Shortcut '${id}' must set exactly one of 'match' (keyboard) or 'display' (display-only).`)
  }

  const base = {
    id,
    label: entry.label,
    section: entry.section as Section,
    allowInInputs: validateBooleanFlag(id, 'allowInInputs', entry.allowInInputs),
    preventDefault: validateBooleanFlag(id, 'preventDefault', entry.preventDefault),
    note: entry.note as string | undefined,
  }

  if (hasMatch) {
    const match = validateMatch(id, entry.match)
    return { ...base, match, keys: deriveDisplayTokens(match) }
  }

  const display = entry.display
  if (!Array.isArray(display) || display.length === 0 || !display.every((k) => typeof k === 'string')) {
    throw new Error(`Shortcut '${id}' display must be a non-empty array of string tokens.`)
  }
  assertNoLegacyShortcutGlyphs(display, `Shortcut '${id}' display`)
  return { ...base, keys: display as string[] }
}

/**
 * Validate raw shortcut data (the parsed `shortcuts.json`) into typed entries.
 * Exported so tests can drive it with malformed inputs without re-triggering the
 * module-load side effect.
 */
export function validateShortcutsData(raw: unknown): Shortcut[] {
  if (!Array.isArray(raw)) {
    throw new Error('shortcuts.json must be an array of shortcut entries.')
  }
  return raw.map(validateEntry)
}

/**
 * The registry, in JSON declaration order. Order is load-bearing: dialog/docs
 * rows render in this order within each section.
 */
export const SHORTCUTS: readonly Shortcut[] = validateShortcutsData(shortcutsData)

/**
 * id → entry map. Throws on a duplicate id, or on an id outside `SHORTCUT_IDS`
 * (the JSON drifted from the hand-maintained union).
 */
const SHORTCUTS_BY_ID: Map<string, Shortcut> = (() => {
  const allowed = new Set<string>(SHORTCUT_IDS)
  const map = new Map<string, Shortcut>()
  for (const shortcut of SHORTCUTS) {
    if (map.has(shortcut.id)) {
      throw new Error(`Duplicate shortcut id in shortcuts.json: '${shortcut.id}'`)
    }
    if (!allowed.has(shortcut.id)) {
      throw new Error(
        `shortcuts.json has id '${shortcut.id}' not in SHORTCUT_IDS — add it to the union in registry.ts.`,
      )
    }
    map.set(shortcut.id, shortcut)
  }
  return map
})()

/** Type guard for narrowing `string` to `ShortcutId`. */
export function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUTS_BY_ID.has(id)
}

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

/** Return all entries in the given section, in declaration (JSON) order. */
export function getShortcutsBySection(section: Section): readonly Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.section === section)
}

/** Return all registered shortcuts in declaration (JSON) order. */
export function getAllShortcuts(): readonly Shortcut[] {
  return SHORTCUTS
}
