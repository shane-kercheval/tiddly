/**
 * Content-extra shortcut registry — shortcuts the main
 * `frontend/src/shortcuts/registry.ts` intentionally excludes, but which still
 * need an OS-agnostic `{{shortcut:<id>}}` token so they localize correctly in
 * authored content.
 *
 * Scope: these ids are renderable in ANY content surface — tip bodies
 * (`TipBody`) and docs prose (`DocsMarkdown`) both resolve `{{shortcut:id}}`
 * through the shared `resolveContentShortcut` (see
 * `components/markdown/shortcutToken.tsx`). They are deliberately NOT in the
 * keyboard registry / "Keyboard Shortcuts" help dialog, which surfaces a
 * curated subset of Tiddly-owned bindings — these are taught contextually in
 * tips/docs instead. (Note this is a curation choice, not an "upstream =
 * hidden" rule: `editor.selectNextOccurrence` is an upstream CodeMirror default
 * that we DO list in the dialog.)
 *
 * Three categories live here:
 *
 *   1. Page-scoped saves — the registry doesn't model page-scope binding
 *      context, so `⌘S` / `⌘⇧S` live in `frontend/src/shortcuts/pageScoped.ts`.
 *      We import the keys from there rather than duplicate the literals.
 *
 *   2. Chrome extension popup — bound at the OS level via
 *      `chrome-extension/manifest.json`'s `commands._execute_action.suggested_key.default`.
 *      Cross-package import isn't worth the build complexity; this entry
 *      manually mirrors the manifest. If the manifest default changes, update
 *      this entry by hand.
 *
 *   3. CodeMirror editor chords — find/go-to-line/multi-cursor bindings owned
 *      by the upstream editor (`@codemirror/search` searchKeymap and
 *      `@codemirror/commands` defaultKeymap), not bound by our own keymap. A
 *      smoke test in `components/CodeMirrorEditor.test.tsx` asserts each of
 *      these keys is actually present in the mounted keymap facet, so a future
 *      upstream change can't silently turn these tokens into a lie. Provenance
 *      is noted per entry below.
 *
 * Content that references shortcuts the main registry owns should use a
 * `ShortcutId` directly via `Tip.shortcutId` — not duplicate them here.
 */
import {
  PAGE_SCOPED_SAVE_KEYS,
  PAGE_SCOPED_SAVE_AND_CLOSE_KEYS,
} from '../../shortcuts/pageScoped'
import {
  getShortcut,
  isShortcutId,
  type ShortcutId,
} from '../../shortcuts/registry'
import type { ContentShortcutId } from './types'

/**
 * Match `{{shortcut:<id>}}` as the *entire* content of an inline code span.
 * The capture is intentionally liberal (any non-`}` run) — registry ids use
 * camelCase like `app.commandPalette` and dotted namespaces. Shared by the
 * `TipBody` render override and `validateTips` body scan so the two agree on
 * what counts as a token; id-shape enforcement lives in `resolveContentShortcut`,
 * not here.
 */
export const SHORTCUT_TOKEN_RE = /^\{\{shortcut:([^}]+)\}\}$/

/**
 * Same shape as `SHORTCUT_TOKEN_RE` but allowed to match anywhere in a string
 * — used by `validateTips` to scan a tip body's raw markdown for shortcut
 * tokens. The `g` flag is required so `String.prototype.matchAll` walks
 * every occurrence.
 */
export const SHORTCUT_TOKEN_SCAN_RE = /\{\{shortcut:([^}]+)\}\}/g

export const CONTENT_EXTRA_SHORTCUTS = {
  'page.save': { keys: PAGE_SCOPED_SAVE_KEYS },
  'page.saveAndClose': { keys: PAGE_SCOPED_SAVE_AND_CLOSE_KEYS },
  // Mirrors chrome-extension/manifest.json `commands._execute_action.suggested_key.default`.
  // OS-agnostic tokens (Alt/Shift), rendered per-OS by platform.ts.
  'extension.openPopup': { keys: ['Alt', 'Shift', 'S'] },
  // CodeMirror editor chords — see category 3 in the file header. Each key is
  // asserted present in the mounted keymap by CodeMirrorEditor.test.tsx.
  // `@codemirror/search` searchKeymap: openSearchPanel.
  'editor.find': { keys: ['Mod', 'F'] },
  // `@codemirror/search` searchKeymap: findNext.
  'editor.findNext': { keys: ['Mod', 'G'] },
  // `@codemirror/search` searchKeymap: findPrevious — the `shift` handler on
  // the Mod-g binding (not a standalone key), so the smoke test asserts Mod-g
  // carries a `shift` run rather than looking for a Mod-Shift-g key.
  'editor.findPrevious': { keys: ['Mod', 'Shift', 'G'] },
  // `@codemirror/search` searchKeymap: gotoLine.
  'editor.goToLine': { keys: ['Mod', 'Alt', 'G'] },
  // `@codemirror/commands` defaultKeymap: addCursorAbove / addCursorBelow.
  'editor.addCursorAboveBelow': { keys: ['Mod', 'Alt', '↑/↓'] },
  // The platform modifier held while clicking a link in the raw editor to open
  // it (markdownStyleExtension link-click plugin). Modifier-only on purpose: it
  // renders just ⌘/Ctrl so prose can read "hold {{token}} and click" without a
  // circular "⌘Click and click". A mouse gesture, not a keymap binding — no
  // keymap smoke test applies.
  'editor.openLinkModifier': { keys: ['Mod'] },
} as const satisfies Record<string, { keys: readonly string[] }>

export type ContentExtraShortcutId = keyof typeof CONTENT_EXTRA_SHORTCUTS

/**
 * Resolve a content shortcut id to its display tokens (OS-agnostic). Accepts an
 * arbitrary string — this sits at the markdown boundary, where `validateTips`
 * extracts ids from raw body text via regex. The wider input type is
 * load-bearing; do NOT tighten it back to `ContentShortcutId` (callers with typed
 * ids work fine — TypeScript allows passing a narrower type where `string`
 * is accepted).
 *
 * Throws on unknown ids — caller (validator) catches and re-throws with tip
 * context; render-time call sites trust their typed input.
 */
export function resolveContentShortcut(id: string): readonly string[] {
  if (isShortcutId(id)) {
    return getShortcut(id as ShortcutId).keys
  }
  // `Object.hasOwn` (not `in`) — `in` walks the prototype chain, so
  // `'toString' in CONTENT_EXTRA_SHORTCUTS` is true and we'd resolve to the
  // inherited Object.prototype.toString. Same risk for `constructor`,
  // `hasOwnProperty`, etc. Restrict to own properties.
  if (Object.hasOwn(CONTENT_EXTRA_SHORTCUTS, id)) {
    return CONTENT_EXTRA_SHORTCUTS[id as ContentExtraShortcutId].keys
  }
  throw new Error(`Unknown content shortcut id: ${id}`)
}

/** Type guard for narrowing `string` to `ContentShortcutId`. */
export function isContentShortcutId(id: string): id is ContentShortcutId {
  return isShortcutId(id) || Object.hasOwn(CONTENT_EXTRA_SHORTCUTS, id)
}
