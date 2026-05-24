/**
 * Display tokens for the page-scoped save shortcuts.
 *
 * `Cmd+S` and `Cmd+Shift+S` bind in Note/Bookmark/Prompt page handlers, not
 * in the main registry — the registry doesn't model page-scope binding
 * context (only-this-page-mounted), so a `match`-omitted entry would imply
 * the binding lives globally when it doesn't. The carve-out is real.
 *
 * But the *display* tokens can still come from one source. Three surfaces
 * render these keys: `ShortcutsDialog.tsx`, `DocsShortcuts.tsx`, and the
 * `save-and-close` entry in `editorCommands.ts` (via its `shortcutKeys`
 * carve-out). All three import from here. Change the combo in one place →
 * every display surface updates.
 *
 * The binding side of the carve-out still exists: the Note/Bookmark/Prompt
 * page-scoped handlers each declare these key combos independently. Closing
 * that gap requires modeling page-scope in the registry, which the plan
 * deferred. This module closes the *display* drift surface only.
 */

// OS-agnostic display tokens (`Mod`/`Shift`), rendered per-OS by platform.ts.
export const PAGE_SCOPED_SAVE_KEYS = ['Mod', 'S'] as const
export const PAGE_SCOPED_SAVE_AND_CLOSE_KEYS = ['Mod', 'Shift', 'S'] as const
