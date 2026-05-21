/**
 * Schema for the keyboard shortcut registry.
 *
 * The registry pairs *display tokens* (what we render in the dialog/docs) with
 * *event matchers* (what fires the binding) so both surfaces share one source
 * of truth.
 *
 * `ShortcutId` is derived from the SHORTCUTS array in `registry.ts` (so adding
 * a new entry expands the union automatically). `Section` is declared here as
 * an explicit literal union — narrow enough that authoring a registry entry
 * with `section: 'Navagation'` (typo) fails to compile.
 *
 * SEPARATION OF CONCERNS
 * ----------------------
 * `match` is a pure event-shape predicate read by the matcher only.
 * Dispatch policy (`allowInInputs`, `preventDefault`) lives at the entry root
 * and is read by the hook after a match fires. Keeping them apart means the
 * matcher's role stays narrow.
 */

/** Sections rendered as group headers in the shortcuts dialog and docs page. */
export type Section = 'Actions' | 'Navigation' | 'View' | 'Markdown Editor'

/**
 * Modifier flags for a `ShortcutMatch`. Strict semantics: an undefined flag
 * means the modifier MUST NOT be pressed (not "don't care"). Cmd+\ won't fire
 * while Shift is held because Cmd+Shift+\ is a different shortcut.
 */
interface ShortcutMatchBase {
  /** Cmd on Mac, Ctrl elsewhere — `event.metaKey || event.ctrlKey`. */
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

/**
 * Predicate over a keyboard event. Exactly one of `key` or `code` is set;
 * the discriminated union enforces this at compile time. Malformed entries
 * fail the `as const satisfies readonly Shortcut[]` check at the line of
 * definition.
 *
 * - `key`: compares against `event.key`. Used for almost everything (Cmd+B,
 *   Cmd+Shift+/, Escape). Single-letter keys compare case-insensitively.
 * - `code`: compares against `event.code` (physical key). Use where macOS
 *   Option-key conversion forces our hand (Option+Z reports `event.key === 'Ω'`,
 *   Option+\ reports '«'). e.g. 'KeyZ', 'KeyL', 'KeyM', 'KeyT', 'Backslash'.
 *   Capture-phase editor entries must use `code`, and the CM keymap adapter
 *   throws on `code` — but global (bubble-phase) entries dispatched via
 *   useGlobalShortcuts may also use `code`, since the matcher handles it and
 *   such entries never reach the CM adapter (e.g. app.toggleSidebarMaxWidth).
 */
export type ShortcutMatch =
  & ShortcutMatchBase
  & (
    | { key: string; code?: never }
    | { code: string; key?: never }
  )

/**
 * A registry entry: stable id, display tokens, optional matcher, optional
 * dispatch policy.
 *
 * `match` is omitted ONLY for entries in one of the two display-only
 * categories documented in `registry.ts` (upstream-owned bindings; non-keyboard
 * interactions). Anything else without `match` is a code smell.
 */
export interface Shortcut {
  /** Stable id, e.g. 'editor.bold'. The same id may be registered by multiple consumers. */
  id: string
  /** Human-readable label shown in the dialog/docs. */
  label: string
  /** Section header for grouping in the shortcuts dialog and docs page. */
  section: Section
  /**
   * Display tokens — Cmd-first authoring convention (⌘, ⌥, ⇧, then the
   * non-modifier). Use raw glyphs ('⌘', '⇧'), not `\u`-escapes.
   * Mouse interactions belong here too: ['⌘', 'Click'], ['Paste URL'].
   */
  keys: readonly string[]
  /** Event matcher. Omit only for the two display-only categories. */
  match?: ShortcutMatch
  /**
   * If true, the hook fires this shortcut even when a text input is focused.
   * Default false. Dispatch policy — read by the hook after `match` fires.
   */
  allowInInputs?: boolean
  /**
   * Whether `useGlobalShortcuts` calls `event.preventDefault()` when the
   * matcher fires. Default `true` — prevents bare-key shortcuts ('/', 's',
   * 'w') from typing into the page. Set `false` for entries like Escape
   * where today's code intentionally lets the event reach native targets.
   *
   * (Today only `useGlobalShortcuts` reads this — CM and Milkdown have their
   * own preventDefault semantics. Field describes a binding's intent shared
   * across global keydown consumers; if a future consumer needs different
   * semantics for the same id, revisit.)
   */
  preventDefault?: boolean
}
