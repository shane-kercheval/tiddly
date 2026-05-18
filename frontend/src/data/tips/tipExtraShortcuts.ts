/**
 * Tip-only shortcut registry — covers shortcuts the main
 * `frontend/src/shortcuts/registry.ts` intentionally excludes.
 *
 * Two categories live here:
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
 * Tips that reference shortcuts the main registry owns should use a
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
import type { TipShortcutId } from './types'

/**
 * Match `{{shortcut:<id>}}` as the *entire* content of an inline code span.
 * The capture is intentionally liberal (any non-`}` run) — registry ids use
 * camelCase like `app.commandPalette` and dotted namespaces. Shared by the
 * `TipBody` render override and `validateTips` body scan so the two agree on
 * what counts as a token; id-shape enforcement lives in `resolveTipShortcut`,
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

export const TIP_EXTRA_SHORTCUTS = {
  'page.save': { keys: PAGE_SCOPED_SAVE_KEYS },
  'page.saveAndClose': { keys: PAGE_SCOPED_SAVE_AND_CLOSE_KEYS },
  // Mirrors chrome-extension/manifest.json `commands._execute_action.suggested_key.default`.
  'extension.openPopup': { keys: ['⌥', '⇧', 'S'] },
} as const satisfies Record<string, { keys: readonly string[] }>

export type TipExtraShortcutId = keyof typeof TIP_EXTRA_SHORTCUTS

/**
 * Resolve a tip shortcut id to its display tokens (Mac glyphs). Accepts an
 * arbitrary string — this sits at the markdown boundary, where `validateTips`
 * extracts ids from raw body text via regex. The wider input type is
 * load-bearing; do NOT tighten it back to `TipShortcutId` (callers with typed
 * ids work fine — TypeScript allows passing a narrower type where `string`
 * is accepted).
 *
 * Throws on unknown ids — caller (validator) catches and re-throws with tip
 * context; render-time call sites trust their typed input.
 */
export function resolveTipShortcut(id: string): readonly string[] {
  if (isShortcutId(id)) {
    return getShortcut(id as ShortcutId).keys
  }
  // `Object.hasOwn` (not `in`) — `in` walks the prototype chain, so
  // `'toString' in TIP_EXTRA_SHORTCUTS` is true and we'd resolve to the
  // inherited Object.prototype.toString. Same risk for `constructor`,
  // `hasOwnProperty`, etc. Restrict to own properties.
  if (Object.hasOwn(TIP_EXTRA_SHORTCUTS, id)) {
    return TIP_EXTRA_SHORTCUTS[id as TipExtraShortcutId].keys
  }
  throw new Error(`Unknown tip shortcut id: ${id}`)
}

/** Type guard for narrowing `string` to `TipShortcutId`. */
export function isTipShortcutId(id: string): id is TipShortcutId {
  return isShortcutId(id) || Object.hasOwn(TIP_EXTRA_SHORTCUTS, id)
}
