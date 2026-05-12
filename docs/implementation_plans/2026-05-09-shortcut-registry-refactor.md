# Shortcut Registry Refactor

## Goal

A single source of truth for keyboard shortcut definitions, consumed by both the binding handlers and the display surfaces. Today the same shortcut is authored as inline literals at six display sites and bound separately across three handler files; nothing connects them. We've shipped at least one display drift bug (`SettingsGeneral` advertised `⌘+/` while the binding was `⌘⇧/`, fixed in `c99ee4b`) and have at least one possible-but-uncertain binding (`⌘D` for "Select next occurrence") that the dialog promises.

## What this is and isn't

**This is:** centralized shortcut definitions + a small matcher + a CodeMirror keymap adapter. Migration replaces inline `['⌘', 'B']` literals with `getShortcut('editor.bold').keys` at each site.

**This is not:**
- A layout-safety fix. The original "use `event.code` to be layout-independent" framing was overstated. We use `event.key` for most matching (matches CodeMirror's native semantics), and `event.code` only where macOS Option-key character translation forces our hand.
- A generic command framework. Commands without keyboard bindings (toolbar buttons, slash menu items) don't go in the registry.
- A re-implementation of CodeMirror's keymap engine. The CodeMirror adapter is a translator — it takes a registry entry and emits CM's `'Mod-b'`-style string, then CM does the binding.

## Key design decisions (settled)

- **Registry is pure data.** `run` callbacks bind at the consumer site, not in the entry. The same id (e.g., `editor.bold`) has different implementations across editors.
- **Display tokens (`keys`) and event matchers (`match`) are separate fields.** Different concerns.
- **`match` is always explicit per entry.** No derivation helper. Cost: one extra line per entry. Benefit: each binding is locally readable and a typo is a unit-test failure.
- **`match` supports both `key` and `code`** (exactly one required per entry, enforced by a discriminated union):
  - `key` matches `event.key` — used for almost everything (Cmd+B, Cmd+Shift+/, etc.). Same form CodeMirror's keymap uses natively, so the adapter and matcher agree.
  - `code` matches `event.code` — physical key, layout-independent. Used in two cases:
    1. **macOS Option-letter conversion** — Option+Z reports `event.key === 'Ω'` on Mac, so we must match the physical key. Concrete ids: `editor.toggleWordWrap` (Alt+Z), `editor.toggleLineNumbers` (Alt+L), `editor.toggleMonoFont` (Alt+M), `editor.toggleToc` (Alt+T).
    2. **Intentional layout-independent physical-key matching** — shortcuts that should land on the same physical key regardless of keyboard layout, even where Mac translation isn't a factor. On a German keyboard, `event.key === '/'` requires Shift+7 (which conflicts with Cmd+Shift+7 / bullet-list); using `event.code === 'Slash'` lands on whatever physical key sits where US `/` is. Concrete ids: `editor.commandMenu` (Cmd+/, `code: 'Slash'`), `editor.toggleReadingMode` (Cmd+Shift+M, `code: 'KeyM'`).
  - The capture-phase listener consumes `code`-entries; the CM keymap adapter consumes `key`-entries (and throws on `code`-entries).
- **Strict modifier semantics in the matcher.** `mod`, `shift`, `alt` are optional booleans. **Undefined means "must NOT be pressed"** — not "don't care." This matches today's hand-rolled handlers (Cmd+\ won't fire when Shift is held because Cmd+Shift+\ is a different shortcut). Permissive matching plus first-wins iteration would silently make registry order load-bearing — that's the spooky-action-at-a-distance the registry is supposed to prevent.
- **Duplicate-match within one consumer tuple is a programming error.** `findMatchingShortcut` returns the first match; if a tuple has two entries whose `match` shapes are byte-equal, registry/tuple order silently determines behavior. M1's `useGlobalShortcuts` includes a dev-mode invariant on mount that walks the registered handler tuple and asserts no two entries share an identical `match` shape; throws on violation. (True semantic overlap with non-identical shapes — e.g., `{ mod: true, key: 'b' }` vs `{ mod: true, shift: false, key: 'b' }` — is harder to detect cheaply and is left as an open invariant; if it ever surfaces, we tighten.)
- **Allowed display-only entries (`match` omitted) — strict rules.** A `match`-omitted entry MUST be one of these two categories:
  1. **Upstream-owned bindings** — bound by a library we don't control (Milkdown's commonmark plugin for `Cmd+B`/`Cmd+I`; CodeMirror's `searchKeymap` for `Cmd+D` if confirmed). Comment on the entry points to the upstream source. Must have a smoke test asserting the upstream binding still works (so a future library upgrade dropping the binding surfaces loudly).
  2. **Non-keyboard interactions** — mouse modifiers (Cmd+Click, Shift+Click), paste URL hint. No runtime match exists.
  
  Anything else with `match` omitted is a code smell. If we own the binding, the registry entry MUST include `match`. A registry entry without `match` for an owned binding is documentation pretending to be source-of-truth — exactly the drift the registry is meant to prevent. (See the ⌘S/⌘⇧S note in M5 for an explicit carve-out.)
- **Routing is per-consumer.** Each consumer (the global document listener, the CodeMirror keymap, CodeMirror's capture-phase listener, Milkdown's hand-rolled keydown listener) maintains its own `as const` tuple of registry ids it owns. The registry tells consumers what each shortcut *is*; consumers decide *where* it fires.
- **One registry id per binding, not per concept. Two authoring patterns:**
  1. **Agree** — both editors fire the same action for the same id. Registration may differ: both editors may register it in their consumer tuples, OR one editor registers and the other relies on an upstream library binding. `editor.bold` is an Agree case where CodeMirror registers with `match` set; Milkdown's commonmark `keymap` plugin handles ⌘B upstream (in production Milkdown is read-only, so the Milkdown side is effectively inert — see M4's audit note below).
  2. **CM-only-by-design** (concept doesn't apply to Milkdown, or Milkdown silently drops it): one id; only CodeMirror's tuple registers it. `editor.toggleWordWrap`, `editor.toggleLineNumbers`, `editor.toggleMonoFont`, `editor.toggleToc`, `editor.toggleReadingMode`, `editor.highlight` all follow this pattern. The dialog row is unlabeled — users don't see two editor implementations and shouldn't be told via a parenthetical that a binding "only works" in one of them.

  The originally-planned **Disagree** pattern (two ids for different bindings, e.g., `editor.codeBlock.cm` + `editor.codeBlock.milkdown`) was removed when M4's audit found Milkdown's editable mode is unused in production. Any future "same concept, different keys per editor" case should reopen this question — but not by adding a `.milkdown` suffix-id to document a binding that doesn't fire.

  Do NOT try to encode multi-binding-per-id in the schema. If the UX team later decides editors should agree on a divergent binding, that's a separate UX change.
- **Registry's `section` is for the shortcuts dialog and docs page only.** `ShortcutsDialog` groups by `Markdown Editor` / `Actions` / `Navigation` / `View`; `editorCommands.ts` groups by `Actions` / `Format` / `Insert` / `Jinja2` for the command menu. These are different per-surface taxonomies for different purposes. The command menu keeps its own `section` field as part of `editorCommands.ts` sidecar metadata; `getCommandView(id)` joins registry's `keys` with editorCommands' `label`, `section`, and `icon`.
- **`useGlobalShortcuts` is multi-mount friendly.** The hook is mounted in two places today: `Layout.tsx:103` for app-global, `AllContent.tsx:204` for page-scoped. Each mount installs its own `document` listener with its own handler subset; listeners coexist without shared state. **Do NOT introduce a module-level mutable handler ref or any other singleton** — that breaks the multi-mount reality.
  
  **Duplicate-id contract:** when two mounts both register the same id, both handlers fire on a matching event (today's `Escape` already follows this — Layout closes the shortcuts dialog; AllContent blurs search input). Each handler must be **safe-as-no-op when its local precondition isn't met**. Adding duplicate-warning would require shared registration state (forbidden), so the discipline is on handler authors. Test: dispatch `Escape` with both Layout-style and AllContent-style mounts active; assert both run.
- **CM passthrough for Cmd+Shift+/ uses synthetic event dispatch.** CodeMirror binds `Mod-Shift-/` (currently at `CodeMirrorEditor.tsx:170`) specifically to consume it before CM's default keymap interferes. The CM keymap entry's `run` synthesizes a `KeyboardEvent` matching the registry entry and dispatches to `document`; the global listener picks it up via the matcher. This is essentially what `dispatchGlobalShortcut` does today (5 lines, tested) — keep the mechanism, rename to `dispatchRegistryShortcut(id)` so it looks up the entry from the registry instead of taking literal key/modifier args. **Semantics:**
  - Throws if the looked-up entry has no `match` (display-only entries can't be dispatched — programming error).
  - Throws if the id is registered in any consumer's capture-phase tuple (would cause double-fire as the synthetic event re-traverses the document capture phase). The dispatcher is for ids handled by `useGlobalShortcuts` only.
  - Synthesizes the event per `entry.match`: `mod: true` → `metaKey: isMac()`, `ctrlKey: !isMac()`. `shift`/`alt` set per `match`. **Undefined modifiers stay `false`** — synthesizing arbitrary modifiers would break the strict-match contract for non-mod entries (e.g., synthesizing Escape with `metaKey: true` would no-op the matcher).
- **Event ordering and listener consumption rules.** Three listeners may be installed on `document` after migration: each `useGlobalShortcuts` mount (Layout, AllContent), and CodeMirror's capture-phase listener. Plus CodeMirror's own keymap inside the editor. The contract:
  - **Capture-phase matched handlers always `event.preventDefault()` and `event.stopPropagation()`.** Matches today's per-branch behavior (`CodeMirrorEditor.tsx:305-348`). Prevents bubble-phase listeners from re-firing the same event.
  - **Bubble-phase (`useGlobalShortcuts`) matched handlers call `event.preventDefault()` per the entry's `preventDefault` flag** (default true, false for Escape). They do NOT call `stopPropagation` — multi-mount duplicate-id contract requires both listeners to see the event.
  - **`dispatchRegistryShortcut` is restricted to `useGlobalShortcuts`-owned ids** — see the dispatch semantics above. This prevents synthetic events from re-entering capture-phase listeners and double-firing.
- **Cmd-first authoring convention** (already in `platform.ts`): `⌘`, then `⌥`, then `⇧`, then the non-modifier. Use raw glyphs (`'⌘'`, `'⇧'`), not `\u`-escapes. Code review enforces.
- **`getShortcut(unknown_id)` throws.** Unknown ids are programming errors; the `ShortcutId` union catches typos at compile time, throw is the backstop.
- **Single `registry.ts` file.** ~30 entries fits comfortably; selectors handle filtering.

### Reference Documentation

- CodeMirror keymap (the `key: 'Mod-b'` DSL the adapter emits): https://codemirror.net/docs/ref/#view.keymap
- CodeMirror key names: https://codemirror.net/docs/ref/#view.KeyBinding
- Existing `frontend/src/utils/platform.ts` helpers (`isMac`, `localizeKey`, `formatShortcut`).

## Schema

```ts
export interface ShortcutMatch {
  /** Cmd on Mac, Ctrl elsewhere — event.metaKey || event.ctrlKey. */
  mod?: boolean
  shift?: boolean
  alt?: boolean
  /**
   * event.key — most shortcuts use this. e.g. 'b', '/', '\\', 'Escape'.
   * Matches CodeMirror's native keymap semantics, so the adapter and the
   * matcher agree on every entry.
   */
  key?: string
  /**
   * event.code — physical key identifier. Use ONLY for shortcuts where
   * macOS converts the keystroke before the browser sees event.key
   * (Option+letter → special character: Option+Z → 'Ω', Option+L → '¬',
   * Option+M → 'µ', Option+T → '†'). e.g. 'KeyZ', 'KeyL', 'Slash'.
   * The capture-phase listener in CodeMirrorEditor handles these.
   */
  code?: string
  /** If true, fires even when a text input is focused. Default false. */
  allowInInputs?: boolean
}
// Exactly one of `key` or `code` must be set per entry.

export interface Shortcut {
  /** Stable id, e.g. 'editor.bold'. */
  id: string
  label: string
  /**
   * Section name. Broad `string` here to avoid a circular `types.ts → registry.ts → types.ts`
   * dependency. The narrow `Section` union is derived from `SHORTCUTS` in `registry.ts` and
   * used on selector signatures (so query-side typos fail to compile).
   */
  section: string
  /**
   * Display tokens — Cmd-first convention. Use raw glyphs ('⌘', '⇧').
   * Mouse interactions and paste hints live here too:
   * keys: ['⌘', 'Click'], ['Paste URL'], etc.
   */
  keys: readonly string[]
  /**
   * Event matcher. Omit ONLY for entries in one of the two allowed
   * display-only categories (upstream-owned bindings or non-keyboard
   * interactions — see file header rules). Anything else MUST include match.
   */
  match?: ShortcutMatch
  /**
   * Whether `useGlobalShortcuts` calls `event.preventDefault()` when the
   * matcher fires. Default `true` — prevents bare-key shortcuts ('/' 's' 'w')
   * from typing literal characters into the page. Set `false` for entries
   * like Escape where today's code intentionally lets the event reach native
   * targets (contenteditable, input form semantics).
   */
  preventDefault?: boolean
}
```

```ts
export const SHORTCUTS = [ /* entries */ ] as const satisfies readonly Shortcut[]

export type ShortcutId = typeof SHORTCUTS[number]['id']
export type Section = typeof SHORTCUTS[number]['section']

export function getShortcut(id: ShortcutId): Shortcut         // throws on unknown id
export function getShortcutsBySection(section: Section): readonly Shortcut[]

/**
 * Dialog column / section ordering. Single source of truth for layout.
 * Adding a new section requires adding it here too — TypeScript will not
 * enforce that, but the `keys ↔ match coherence + section coverage` test
 * in registry.test.ts will fail loudly if a section appears in the
 * registry but not in SECTION_LAYOUT.
 */
export const SECTION_LAYOUT: readonly { column: 'left' | 'right'; sections: readonly Section[] }[]
```

`Section` is a typed union, so `getShortcutsBySection('Markdwon Editor')` fails to compile.

## Files Touched

**New (`frontend/src/shortcuts/`):**
- `types.ts`, `registry.ts`, `matcher.ts`, `useGlobalShortcuts.ts`, `usePasteUrlHandler.ts`, `adapters/codemirror.ts`. Tests for each.

**Modified:**
- `frontend/src/hooks/useKeyboardShortcuts.ts` — split into `useGlobalShortcuts` (keyboard) and `usePasteUrlHandler` (paste). Then deleted.
- `frontend/src/components/ShortcutsDialog.tsx`
- `frontend/src/pages/docs/DocsShortcuts.tsx`
- `frontend/src/components/CodeMirrorEditor.tsx`
- `frontend/src/components/MilkdownEditor.tsx`
- `frontend/src/components/CommandPalette.tsx`
- `frontend/src/components/editor/EditorCommandMenu.tsx`
- `frontend/src/components/editor/editorCommands.ts`
- `frontend/src/utils/slashCommands.ts`
- `frontend/src/components/sidebar/Sidebar.tsx`
- `frontend/src/pages/settings/SettingsGeneral.tsx`

**Deleted as part of migration (folded into the milestone that supersedes them):**
- Inline shortcut literals throughout the modified files.
- `useKeyboardShortcuts.ts` once the split lands.
- `dispatchGlobalShortcut` is renamed to `dispatchRegistryShortcut(id: ShortcutId)` and **lives in `frontend/src/shortcuts/dispatch.ts`** (or merged into `useGlobalShortcuts.ts` — but in `shortcuts/`, not in an editor component). It's a registry concern; future consumers shouldn't import dispatch from `CodeMirrorEditor.tsx`.

## Agent Behavior

- Complete each milestone fully (code + tests + dead-code deletes) before proceeding. Don't defer deletes.
- Stop after each milestone for human review. M2 is the architectural checkpoint.
- Ask before assuming. If a shortcut you're migrating doesn't appear in any of the surfaces I listed, ask first — some may be display-only or binding-only.
- No backwards-compat shims. Delete the old hook when the split lands.
- `make frontend-verify` at each milestone. New tests assert behavior, not implementation details.

---

## Milestone 0 — Pre-implementation inventory

### Goal

Resolve every dialog/docs entry's binding status before any code lands. Output is a small markdown table the agent shares at the M0 stop-and-review; reviewer signs off, the table feeds M1's seed list and the M3 inventory step.

### Implementation

For every shortcut row in `ShortcutsDialog.tsx` and `DocsShortcuts.tsx`, record three axes:

**Axis 1 — Ownership:**
- **bound (us)** — bound by code in this repo. Note the file:line.
- **upstream-owned** — bound by a library (e.g., Milkdown commonmark for Cmd+B/I; CodeMirror's `searchKeymap` for Cmd+D). Verify by **behavior test, not grep** — there is no `searchKeymap` import in this repo; `basicSetup` is a config object passed to `@uiw/react-codemirror`'s wrapper, which may or may not include search keymaps. To confirm Cmd+D: render `CodeMirrorEditor` with seeded text, fire `Cmd+D` over a word, observe whether selection extends. If yes → `upstream-owned` (M3 adds smoke test); if no → display-only with no upstream binding, decide whether to remove from dialog or implement.
- **paste-event** — `Cmd+V` "Paste URL to add bookmark" is driven by a paste listener, not keydown. Treated like non-keyboard for registry purposes (display-only, no `match`).
- **non-keyboard** — Cmd+Click, Shift+Click. Will be `match`-omitted.

**Axis 2 — Scope:**
- **app-global** — registered in `Layout.tsx`.
- **route-scoped** — registered in a page-level component (e.g., `s` for focus-page-search registered in `AllContent.tsx`). In scope for migration; consumer is the page component, not Layout.
- **editor-only** — registered inside `CodeMirrorEditor.tsx` / `MilkdownEditor.tsx`.
- **page-scoped (out of scope)** — Cmd+S, Cmd+Shift+S, Escape in Note/Bookmark/Prompt. Stays inline in the dialog (see M5 carve-out).

**Axis 3 — Engines (for editor-only entries):**
- **CM-only** — only meaningful in CodeMirror (e.g., wrap, line numbers, reading mode), OR bound in CM and silently dropped in Milkdown (Highlight). One registry id; only CodeMirror's tuple registers it. The dialog row is unlabeled — no asymmetric-suffix in the UI.
- **Milkdown-only** — only meaningful in Milkdown.
- **both (agree)** — same id, same binding in both editors.
- **both (disagree)** — different bindings (Code Block: ⌘⇧E in CM, ⌘⇧C in Milkdown). Two registry ids will be needed.

Also include a **`mounts:`** column listing every place each row is registered (helps catch multi-mount overload like `Escape`). For non-keyboard rows (Cmd+Click, paste URL), `mounts:` lists the component-level handler that owns the interaction (e.g., the `onClick` handler in the card component) rather than a hook mount.

Also confirm: ProseMirror Tab/Shift+Tab/Backspace are NOT in either user-facing surface. If they are, classify accordingly.

**Distinct ids for same display tokens in different contexts.** If two rows share display tokens but bind in different scopes (e.g., `⌘Click` "Open card in new tab" in Navigation vs `⌘Click` "Open link in new tab" in Markdown Editor), they need separate registry ids regardless of the agree/disagree pattern (e.g., `card.openInNewTab` vs `editor.openLinkInNewTab`). Flag any such pairs in the inventory.

**Docs-only rows.** `DocsShortcuts.tsx` includes some rows that `ShortcutsDialog.tsx` doesn't (e.g., `⌥T` Toggle TOC, `⌘/` Command menu). M0 surfaces these; the M0 stop-and-review reaches an explicit decision per row: (a) add to the dialog (preferred — it's a help reference, more is generally fine), or (b) if editorial says no, add a `surfaces?: ('dialog' | 'docs')[]` field on `Shortcut` for explicit per-surface inclusion. Decision is recorded in M0 before M1 starts so the schema is settled.

**unknown** entries: investigate using the same behavior-test approach as Cmd+D. Resolve all unknowns before M1.

### Stop & Review

Share the table. Reviewer confirms classifications. Once approved, no entries are "mysteries" entering M1.

---

## Milestone 1 — Scaffold

### Goal

Build the framework. Registry seeded with the eight **global** shortcut entries (data only — no consumer migrates yet). Types, selectors, matcher, hooks, CodeMirror adapter all tested. After M1 the App still uses `useKeyboardShortcuts`; the new framework is in place but unwired.

### Implementation

- `types.ts` — `Shortcut`, `ShortcutMatch`. (`Section` and `ShortcutId` are exported from `registry.ts` since they're derived from the registry array.)
- `registry.ts` —
  - `SHORTCUTS = [...] as const satisfies readonly Shortcut[]` seeded with the eight globals from `useKeyboardShortcuts.ts:71-134` (showShortcuts, commandPalette, toggleHistorySidebar, toggleSidebar, escape, focusSearch, focusPageSearch, toggleWidth).
  - `SECTION_LAYOUT` populated for the existing dialog layout (left column: Actions / Navigation / View; right column: Markdown Editor).
  - Three selectors. `getShortcut` throws on unknown id.
  - File-header comment establishes scope discipline (key-combo bindings only) AND the two allowed `match`-omitted categories. Anything else without `match` is a code smell.
- `matcher.ts` — `matches(event, match): boolean` (~25 lines: strict modifier flags, prefer `code` over `key` if both somehow set).
  - **Key-casing rule:** for single-letter `match.key` values (`/^[a-z]$/i`), both sides are lowercased before comparison — handles browser variance for Cmd+Shift+letter (`event.key` may report `'M'` or `'m'` depending on platform). Non-alpha keys (`'/'`, `'Escape'`, `'Backspace'`) compare exactly.
  - **`findMatchingShortcut(event, shortcuts)` returns the first match in tuple iteration order.** With strict modifier semantics, the byte-equal duplicate-match invariant, and the Cmd-first authoring convention (don't write `: false` on default modifier values), order-dependence is not load-bearing in practice. If a future entry surfaces semantic overlap that byte-equal misses, tighten the invariant to normalize before comparing.
- `useGlobalShortcuts.ts` — installs a `keydown` listener on `document`, runs `findMatchingShortcut` against entries the consumer registered, respects `allowInInputs` and `preventDefault`. **Multi-mount friendly:** each call site installs its own listener with its own handler subset. No shared state. No singleton.

  Call signature (matches the `CM_KEYMAP_IDS` pattern):
  ```ts
  const APP_GLOBAL_IDS = [
    'app.showShortcuts',
    'app.commandPalette',
    'app.toggleSidebar',
    // ...
  ] as const satisfies readonly ShortcutId[]

  useGlobalShortcuts(APP_GLOBAL_IDS, {
    'app.showShortcuts': () => setShortcutsOpen(true),
    'app.commandPalette': () => openPalette(),
    // ...
  } satisfies Record<typeof APP_GLOBAL_IDS[number], () => void>)
  ```
  The tuple is what the dev-mode duplicate-match invariant walks (so the invariant has a stable, typed iteration target, not `Object.keys(handlerMap)`).

  Spec:
  - "Fires only ids in the tuple. Multiple mounts may register disjoint or overlapping sets; each runs independently."
  - On match: calls `event.preventDefault()` unless the entry has `preventDefault: false` (Escape). Does NOT call `stopPropagation` — multi-mount overlap requires both listeners to see the event.
  - **Stable handler-map identity required.** The listener install/teardown effect's deps must include only stable references — tuple is `as const` (stable); handler map identity is the consumer's responsibility (memoize at the call site, or use a ref pattern). Otherwise React 19 StrictMode (or any handler-identity churn) will reinstall the listener on every render. Test: render the hook twice with the same handler map, dispatch one event, assert each handler runs exactly once per mount — not per render.
  - **Dev-mode duplicate-match invariant** (per the design decision): on mount, walk the registered tuple and assert no two entries have byte-equal `match` shapes; throw on violation.
- `usePasteUrlHandler.ts` — extracted from current `useKeyboardShortcuts.ts:138-160`. Same paste-listener behavior, separate hook. **Same stable-callback rule as `useGlobalShortcuts`** — the `onPasteUrl` callback is the consumer's responsibility to memoize; otherwise the listener reinstalls on every render. Test: render twice with the same handler, dispatch one paste, assert handler runs exactly once per mount.
- `adapters/codemirror.ts` — `toCodeMirrorKeymap(shortcuts, handlers): KeyBinding[]`. Translates `match: { mod: true, key: 'b' }` to `'Mod-b'`, `match: { mod: true, shift: true, key: '/' }` to `'Mod-Shift-/'`, etc. Translation table documented inline. Adapter test verifies the emitted form actually fires inside a real `EditorView`. **Entries with `match.code` (not `key`) are NOT translated by this adapter** — they belong to the capture-phase listener path, which uses the matcher directly. The adapter throws if asked to translate a `code`-only entry.

### Testing

- **Selectors:** filter correctness, `getShortcut(unknown)` throws.
- **Matcher:**
  - Modifier-flag combinations (strict semantics — `Cmd+\` must NOT fire when shift is held).
  - `key` mismatch returns false.
  - `code` mismatch returns false.
  - `allowInInputs` gate: matcher itself doesn't check (consumer does), but a separate hook test does.
- **`registry.test.ts` — keys ↔ match coherence test:** iterates entries with `match` set, asserts:
  - If `keys` contains `'⌘'`, `match.mod === true` (and vice versa).
  - If `keys` contains `'⇧'`, `match.shift === true`.
  - If `keys` contains `'⌥'`, `match.alt === true`.
  - The non-modifier final token of `keys` matches `match.key` (case-insensitively) or `match.code`. For `code` values that map to displayed punctuation, maintain a small explicit map in the test: `{ Slash: '/', Backslash: '\\', Minus: '-', Period: '.', Comma: ',' }` etc. For letter codes (`KeyZ`, `KeyM`), use the last segment.
  - Skips entries where `match` is omitted.
- **`registry.test.ts` — tuple sanity test:** import each consumer's `as const` tuple (initially just any M1 fixture; M2+ adds CM_KEYMAP_IDS etc.), assert `tuple.forEach(getShortcut)` doesn't throw — runtime backstop in case someone removes the `satisfies readonly ShortcutId[]` annotation.
- **`registry.test.ts` — section coverage test:** every section appearing in `SHORTCUTS` also appears in `SECTION_LAYOUT`.
- **`useGlobalShortcuts`:**
  - Dispatch a matching keydown → handler fires.
  - `allowInInputs: false` → suppressed when input focused.
  - `allowInInputs: true` → fires even when input focused.
  - Mac/Windows: `metaKey` triggers on Mac mock, `ctrlKey` triggers on Win mock.
  - **Multi-mount disjoint:** mount the hook twice with disjoint handler maps; both fire independently.
  - **Multi-mount overlap:** mount twice with the same id (the real `Escape` case); dispatch matching event; both handlers run.
  - **Stable identity:** mount with a memoized handler map; trigger a re-render without changing the map; dispatch one event; assert handler ran exactly once (not twice via re-installed listener).
  - **Dev duplicate-match invariant:** mount with a tuple containing two byte-equal `match` shapes; assert it throws.
- **`usePasteUrlHandler`:** port the existing paste tests from `useKeyboardShortcuts.test.ts`.
- **CM adapter:**
  - For each row of the translation table (letters, punctuation, modifier combinations), install the emitted `KeyBinding` into a real `EditorView`, dispatch a matching event, assert the handler fires.
  - Specifically test `key: '-'` produces literal `'Mod-Shift--'` (two dashes — guards against a naive `parts.join('-')` bug).
  - `code`-only entry → adapter throws.
- The **matcher ↔ CM adapter parity test is introduced in M2**, not M1 — M1 has no `CM_KEYMAP_IDS` to test against. Spec captured in the M2 section.
- All existing 3000+ tests pass.

### Stop & Review

**Important:** at end of M1, no consumer has migrated. The registry exists as data only. The App still uses `useKeyboardShortcuts`. Reviewers should NOT expect to see wire-up at M1.

Show: types, the matcher/adapter test results (especially the CodeMirror keymap translation form discovered), the multi-mount test for `useGlobalShortcuts`. Get sign-off before M2.

---

## Milestone 2 — Proof slice: globals + Markdown Editor section

**This is the architectural checkpoint.**

### Goal

Migrate end-to-end:
- All eight global shortcuts (already in registry from M1) — wire up consumer.
- The entire "Markdown Editor" section (~12 entries: Bold, Italic, Strikethrough, Highlight, Blockquote, Inline code, Code block, Bullet/Numbered/Checklist, Insert link, Horizontal rule).

After M2: registry is the source of truth for these entries across binding, ShortcutsDialog, DocsShortcuts, and CodeMirror toolbar tooltips. `useKeyboardShortcuts.ts` is deleted; paste handling moves to `usePasteUrlHandler`. `dispatchGlobalShortcut` is renamed to `dispatchRegistryShortcut(id)`.

### Implementation

**Step 2a — Migrate globals (consumer wire-up).**
1. Land `usePasteUrlHandler` extraction at the call site (`AllContent.tsx`). That file now calls both `useGlobalShortcuts(...)` and `usePasteUrlHandler(...)`.
2. Replace `useKeyboardShortcuts(...)` calls in `Layout.tsx` and `AllContent.tsx` with `useGlobalShortcuts(...)` keyed by registry ids. **Conditional handlers stay in the tuple unconditionally; the handler short-circuits when the precondition fails.** Today's `Layout.tsx:110-112` registers `onToggleHistorySidebar` only when `isDetailPage`. After migration, `'app.toggleHistorySidebar'` stays in `APP_GLOBAL_IDS` and the handler reads `if (!isDetailPage) return; togglePanel('history')`. Don't conditionally include/exclude tuple entries — the tuple is a stable contract between consumer and registry, and the dev-mode duplicate-match invariant requires a stable iteration target.
3. Rename `dispatchGlobalShortcut` to `dispatchRegistryShortcut(id: ShortcutId)`. It looks up the entry, synthesizes a `KeyboardEvent` per `entry.match` (see CM passthrough decision), dispatches to `document`. Update the existing `Mod-Shift-/` keymap entry in `CodeMirrorEditor.tsx` to call `dispatchRegistryShortcut('app.showShortcuts')`.
4. Delete `useKeyboardShortcuts.ts` and its test file.

**Step 2b — Markdown Editor section.**
1. Add ~12 registry entries with `section: 'Markdown Editor'`, all with `match`.
2. `CodeMirrorEditor.tsx` declares `CM_KEYMAP_IDS` tuple covering these + `'app.showShortcuts'` passthrough. Use the **prescribed typing form** so a typo fails to compile AND tuple element types stay narrow (handler-map typing depends on this):

   ```ts
   const CM_KEYMAP_IDS = [
     'editor.bold',
     'editor.italic',
     // ...
     'app.showShortcuts',  // passthrough
   ] as const satisfies readonly ShortcutId[]

   type CmHandlers = Record<typeof CM_KEYMAP_IDS[number], () => void>
   ```

   Plain `as const` permits typos silently; plain `: readonly ShortcutId[] = [...] as const` widens and breaks handler-map derivation. The `as const satisfies readonly ShortcutId[]` form is the only one that gets both. Builds keymap via `toCodeMirrorKeymap(...)`. Toolbar tooltips compute from `getShortcut(id)`.
3. `ShortcutsDialog`'s right column reads `getShortcutsBySection('Markdown Editor')`. Other sections (Actions, Navigation, View — left column) keep their inline arrays for now; the dialog renders both sources side by side, no merge logic.
4. `DocsShortcuts`'s Markdown Editor table reads the same.
5. Delete the migrated entries from inline arrays.
6. **Label canonicalization.** Toolbar tooltips today use Title Case ("Inline Code", "Code Block", "Bullet List"); the dialog uses sentence case. Pick **Title Case** as the single canonical label per registry entry — toolbar tooltips stay as-is, dialog rows update to match. No per-surface override field; one label per entry, used everywhere.

**Step 2c — Inventory mystery bindings.**
- For any dialog/docs entry without an obvious binding (notably `⌘D` "Select next occurrence"), don't migrate yet — add to a list resolved in M3.

### Testing

- Globals: port `useKeyboardShortcuts.test.ts` cases to `useGlobalShortcuts`. **Add a test asserting `Cmd+Shift+/` dispatched from inside CodeMirror invokes the global handler** (verifies `dispatchRegistryShortcut` works correctly).
- Markdown Editor entries: derivation pattern — assertion text computed from the registry entry, not hardcoded. The registry's label *is* the toolbar tooltip text:
  ```ts
  const entry = getShortcut('editor.bold')
  expect(toolbarButton).toHaveAttribute('title', `${entry.label} (${formatShortcut(entry.keys)})`)
  ```
- ShortcutsDialog renders the section sourced from the registry on Mac and Windows (mock platform per assertion).
- One end-to-end behavior test per consumer site: fire `Mod+B` in CodeMirror → Bold ran.
- **Multi-mount overlap on Escape:** Layout and AllContent both register `app.escape`; dispatch Escape; assert both handlers run (verifies the duplicate-id contract).
- Paste handler: existing tests pass under `usePasteUrlHandler`.

  *Note:* No matcher↔adapter parity loop. The matcher and adapter are independently tested in M1 (matcher unit tests, adapter translation-table + tricky-string tests covering `key: '-'` etc.). The keys↔match coherence test in `registry.test.ts` covers display↔matcher consistency. A separate parity loop would mostly verify "the synthetic event we built from `match` satisfies both functions we wrote from `match`," which is consistency-with-self testing — low signal.

### Stop & Review

Show:
1. The migrated `useGlobalShortcuts` path in both Layout and AllContent (multi-mount working).
2. Data flow for one editor entry: registry → adapter → toolbar tooltip + dialog row.
3. The passthrough working: Cmd+Shift+/ from inside CodeMirror invokes the global handler via `dispatchRegistryShortcut`.
4. Deletes (`useKeyboardShortcuts.ts`, inline literals).

If anything reads awkwardly, flag it before M3.

---

## Milestone 3 — Rest of CodeMirror; mystery bindings; strip `editorCommands.ts` shortcut field

### Goal

After M3:
- Every CodeMirror keymap entry lives in the registry; the hand-rolled `keymap.of([...])` array is gone (replaced by adapter call).
- CodeMirror's capture-phase listener (Alt-Z, Alt-L, Alt-M, Alt-T, Cmd+Shift+M for reading mode, Cmd+/ for command menu) uses the matcher against its own consumer tuple. **Capture-phase entries use `match.code` only where macOS Option-key conversion forces it (Alt+Z/L/M/T); other capture-phase entries (Cmd+Shift+M, Cmd+/) use `match.key`.**
- Mystery bindings resolved (each is bound, marked display-only with `match` omitted under one of the allowed categories, or removed from display).
- `frontend/src/components/editor/editorCommands.ts` strips its `shortcut: ['⌘', 'B']` literals **per-entry** as the corresponding registry entry is added. Commands without bindings (discard, jinja templates, headings) keep their entries unchanged.
- ShortcutsDialog's "View" section column reads from registry.

### Implementation

For each CodeMirror keymap entry and capture-phase entry:
1. Add registry entry. Choose `match.key` or `match.code` per the schema rule (see "Key design decisions"):
   - **`code` for Mac Option-letter conversion**: Alt+Z/L/M/T → `code: 'KeyZ' | 'KeyL' | 'KeyM' | 'KeyT'`.
   - **`code` for intentional layout-stable physical-key matching** (an explicit, narrow exception): Cmd+/ (command menu) keeps `code: 'Slash'`, Cmd+Shift+M (reading mode) keeps `code: 'KeyM'`. Reasoning: on a German keyboard, `event.key === '/'` requires Shift+7 (conflicts with Cmd+Shift+7 / bullet-list); using `code` lands on the same physical key regardless of layout. **Do not "clean these up" to `key`-based matching in a future pass — the `code` choice is deliberate.**
   - **`key` for everything else**: CM keymap entries (Bold, Italic, etc.).
2. Add to `CM_KEYMAP_IDS` tuple OR the capture-phase tuple (based on which listener handles it).
   - **Capture-phase tuple ownership:** `CAPTURE_PHASE_IDS` in `frontend/src/shortcuts/capturePhase.ts` is the single source. Both `dispatch.ts` and CodeMirrorEditor's capture-phase listener import the same constant. Don't fork the list.
3. Update toolbar tooltip / Tooltip component to read from registry via `tooltipFor(id)`.
4. Delete inline literal from `CodeMirrorEditor.tsx` and from `ShortcutsDialog`/`DocsShortcuts`.

**Capture-phase listener semantics:** the listener uses `findMatchingShortcut` against the capture-phase tuple. On match, each handler determines whether it acts (`didHandle: boolean`); the event is consumed (`preventDefault` + `stopPropagation`) only when the handler actually ran. This preserves matcher/handler symmetry — the matcher determines *what* would fire; the handler determines *whether* it actually fires; the event is consumed only on the conjunction. Identical behavior to the original if-cascade, which only called `preventDefault` inside each branch's success path.

**Switch must be exhaustive.** Use a typed cast and a `never`-typed default to enforce at compile time that every id in `CAPTURE_PHASE_IDS` has a switch case. Adding an id without a case fails to build, not silently no-ops.

**Duplicate-match invariant.** Call `assertNoDuplicateMatchShapes(shortcuts)` on listener install (dev mode only), same as `useGlobalShortcuts`. Keeps invariant parity across consumers.

**editorCommands.ts is NOT touched in M3.** The plan's earlier wording said to strip `shortcut:` literals per-entry as the corresponding registry entry is added. With the M5 simplification (flat `EditorCommand` shape; `keys = isShortcutId(cmd.id) ? getShortcut(cmd.id).keys : undefined` at render time), the strip step depends on renaming editorCommands ids to match registry ids — which is a single coherent change owned by M5. Splitting it across M3 + M5 would create an interim regression in command-menu shortcut display. M5 does the rename + strip + rewire as one unit.

**Navigation section migrated in M3.** Originally planned for M5, but the section had four registry entries (`app.focusSearch`, `app.focusPageSearch`, `app.commandPalette`, `app.escape`) with their display tokens duplicated in `ShortcutsDialog.tsx` and `DocsShortcuts.tsx` — an active label inconsistency (registry: Title Case; inline: sentence case) after the M3 label canonicalization. Migrated in M3 alongside View. Two new display-only entries (`card.openInNewTab`, `relationship.openInTiddly`) capture the existing mouse-modifier rows. Only the Actions section remains inline going into M5.

**Mystery binding resolution:** the bulk of this happens in M0; M3 just acts on the M0 conclusions. For any entry M0 classified as `upstream-owned`, add a registry entry with `match` omitted, a comment pointing to the upstream source, and a smoke test (next section). For entries M0 found to have no binding anywhere, delete the dialog/docs row.

**Page-scoped save shortcuts** (Cmd+S, Cmd+Shift+S in Note/Bookmark/Prompt) are NOT migrated in this PR. Their context dimension (only-this-page-mounted) needs design we're deferring. Out-of-scope, untouched. See M5 for the carve-out in the dialog.

### Testing

- For each migrated shortcut, the M2 derivation pattern (registry label + formatShortcut feeds tooltips and dialog rows).
- Existing `CodeMirrorEditor.test.tsx` tests pass; update any that asserted hardcoded `title=` strings.
- One spot-check end-to-end test per consumer surface: fire one keymap shortcut (e.g., `Cmd+B` — already in M2) plus one capture-phase shortcut (e.g., `Alt+Z`) and assert behavior. The Alt+Z test specifically exercises the `code`-based matching path.
- **Cmd+D plugin-presence smoke test**: introspect the CodeMirror keymap facet and assert a `Mod-d` binding is registered. Concretely: render `CodeMirrorEditor`, get the `EditorView` via `EditorView.findFromDOM(contentDOM)`, read `view.state.facet(keymap).flat()`, assert at least one entry has `key === 'Mod-d'`. Catches the realistic regression (`search({...})` removed from extensions) without firing `Cmd+D` or asserting upstream selection behavior.

### Stop & Review

Confirm no editor-behavior regressions; mystery bindings accounted for; `editorCommands.ts` shortcut field disappearing as expected.

---

## Milestone 4 — Milkdown audit (originally: shortcut migration)

**Audit result: most of M4's originally-planned scope was deleted.** `MilkdownEditor` is used in production only as a read-only preview inside `CodeMirrorEditor.tsx` (passed `readOnly={true}, onChange={() => {}}`). The architectural note in `ContentEditor.tsx:1-17` confirms this is intentional — editable Milkdown was retired due to AST/cursor issues. The hand-rolled keydown handler that M4 planned to migrate is vestigial from the pre-retirement state: handlers fire, but ProseMirror's `editable: false` discards mutations and `onChange` is dropped by the read-only preview parent.

The M4 first-cut migrated this dead-code handler to a registry-driven matcher, adding `editor.codeBlock.milkdown` with the disagree pattern. After the audit surfaced the read-only finding, all of that was deleted — registry shouldn't document shortcuts that don't fire.

### Goal

After M4:
- The vestigial keydown handler in `MilkdownEditor.tsx` (and its wrapper `onKeyDown` attribute) is deleted. M4's first-cut migration is reverted along with the pre-M4 dead code it migrated.
- `editor.codeBlock.milkdown` registry entry is removed. The Code Block tooltip on the (also-dead) Milkdown toolbar reverts to a hardcoded literal — the toolbar is hidden by `{!disabled && !readOnly && ...}` in production, so this is dead-code maintenance only.
- `editor.bold` / `editor.italic` stay in the registry — CodeMirror's binding is live. Milkdown's side of the Agree pattern is inert because the editor isn't editable in production. **Do not "fix" this by adding entries to a Milkdown tuple that no longer exists.**
- `createLinkClickPlugin` ⌘Click on links remains the only live Milkdown editing-adjacent binding. The plugin-presence test verifies the function's return shape (a ProseMirror plugin with `handleDOMEvents.click` set). Mount-based plugin introspection was investigated and ruled out (see "Test approach" below).
- ProseMirror structural keymap (Tab/Shift+Tab/Backspace) is untouched — editor behavior, not user-visible shortcut.

**Follow-up not in M4 scope:** the Milkdown toolbar component, `LinkDialog`, and action handlers (`handleBulletListClick`, `handleCodeBlockToggle`, etc.) are all dead in production (toolbar hidden when readOnly). Deleting them is a meaningful cleanup but warrants its own PR — M4 stays focused on the registry-related concerns.

### Implementation

1. **Revert the M4 keymap migration** in `MilkdownEditor.tsx`: delete `MILKDOWN_KEYMAP_IDS`, `MilkdownHandlers`, `milkdownHandlers`, the `assertNoDuplicateMatchShapes` call, and the `findMatchingShortcut`-based handler body.
2. **Delete the wrapper's keydown handler** entirely. Remove `onKeyDown={handleKeyDown}` from the wrapper div and delete the `handleKeyDown` declaration. The handler was dead code pre-M4 too (Milkdown is read-only in production), so this completes the cleanup rather than just reverting the migration.
3. **Delete `editor.codeBlock.milkdown`** from the registry, along with the disagree-pattern comments above `editor.codeBlock.cm`.
4. **Revert the one tooltip** that referenced the deleted entry: the Milkdown toolbar's Code Block button reverts to a hardcoded `formatShortcut(['⌘', '⇧', 'C'])` literal. Restore the `formatShortcut` import. All other toolbar tooltips keep `tooltipFor()` — they point to live registry entries used by CodeMirror.
5. **Keep `customCommonmark` exported** — it's load-bearing for read-only markdown parsing.
6. **Keep `createLinkClickPlugin` exported** — Cmd+Click on links is genuinely live in read-only Milkdown.
7. **Keep the `createLinkClickPlugin` shape test, add a markdown-pipeline mount test** — see "Test approach" below.

### Test approach

**Mount-based plugin introspection was investigated and ruled out** (~20 min time-box). Two environmental limits in jsdom block the natural approach:

- No public `EditorView.findFromDOM` for ProseMirror — there's no clean way to access the mounted editor's view from outside `MilkdownEditor` without exposing internal state via refs (API change).
- `posAtCoords` requires layout. jsdom doesn't compute layout, so synthesized Cmd+Click events on rendered `<a>` elements return `null` from `posAtCoords` and the link-click handler bails before calling `window.open`. Click-behavior tests aren't viable.

The shipped tests instead:

- **`createLinkClickPlugin` shape test** (kept, renamed with honest framing): calls the function, asserts the returned plugin has `spec.props.handleDOMEvents.click`. Catches "function removed or return shape changed."
- **Markdown-pipeline mount test** (added): renders `<MilkdownEditor value="text [link](url) more" readOnly={true} />`, awaits `.ProseMirror`, asserts the rendered `<a>` has the right href and text. Implicitly verifies `customCommonmark` is wired into the editor builder — if someone removes `.use(customCommonmark)` or breaks the markdown parsing pipeline, this test fails.

Wiring of `linkClickPluginSlice` itself isn't directly testable in jsdom; visual review + git history is the safety net for that specific regression.

### Tests removed in this milestone

- Cmd+Shift+7 wire-up test (the wired-up handler is deleted).
- Cmd+B negative test (the wrapper handler it interacted with is deleted).
- `customCommonmark.includes(commonmarkKeymap)` test (documented an inactive binding; the markdown-pipeline mount test now covers the live concern — "the editor renders markdown" — without naming specific plugin internals).
- "Code Block" rendered twice in dialog/docs tests revert to single-match.

### Stop & Review

By end of M4: registry has no fictional shortcuts. Display surface for Actions still has inline literals — M5.

---

## Milestone 5 — Remaining display surfaces

### Goal

After M5:
- `CommandPalette.tsx`, `EditorCommandMenu.tsx`, `slashCommands.ts`, `Sidebar.tsx`, `SettingsGeneral.tsx` all read shortcut **keys** from the registry.
- `frontend/src/components/editor/editorCommands.ts` is fully stripped of inline shortcut literals (any stragglers from M3/M4 cleanup).
- All inline shortcut literals across the frontend are gone outside `platform.ts` and the registry, **except the Actions section in `ShortcutsDialog.tsx` and `DocsShortcuts.tsx`**. The four page-scoped save entries (`Cmd+S`, `Cmd+Shift+S` in Note/Bookmark/Prompt) stay inline pending the page-scope-design follow-up — adding registry entries for them would create the appearance of registry sourcing without the guarantee (we own the binding; a `match`-omitted entry would silently drift). Honest about the seam.
- Note: Navigation migrated in M3, so M5's display-surface scope is smaller than originally planned (Actions only).

### Architectural framing — what the registry owns vs. what surfaces decide

The registry owns: **`id`, `keys`, and the canonical `label`** rendered in the dialog/docs and in toolbar tooltips (Title Case, e.g. `'Insert Link'`).

Per-surface UI surfaces (command menu, slash menu, sidebar prompt, settings hint) are free to render their own label text. Some are intentionally different from the registry label — verified examples: `'Link'` (menu) vs `'Insert Link'` (dialog), `'Version History'` (menu) vs `'Toggle history sidebar'` (dialog), `'Bulleted list'` (menu) vs `'Bullet list'` (dialog). These are not drift bugs; menus prefer concise nouns and dialogs prefer verb-prefixed descriptions. The registry doesn't try to reconcile them.

The only invariants are: (1) `id` is a `ShortcutId` if the command has a registry shortcut, and (2) `keys` come from `getShortcut(id).keys` (never inline). Labels are surface-local.

### Implementation

- **`editorCommands.ts`** — flat shape, no projection layer:
  ```ts
  type EditorCommand = {
    id: string                    // ShortcutId for entries with a registry shortcut; local id otherwise
    label: string                 // whatever the menu wants; may differ from registry label
    section: string
    icon: ReactNode
    action: () => void
  }
  ```
  - **Rename** entries that have a corresponding registry shortcut to use the registry id (`'bold'` → `'editor.bold'`, `'inline-code'` → `'editor.inlineCode'`, etc.). Update lookup sites in `EditorCommandMenu.tsx` and `CommandPalette.tsx` accordingly. Entries without a registry shortcut (Heading 1/2/3, Discard, Jinja templates) keep their original local ids.
  - **Strip the inline `shortcut: ['⌘', 'B']` field.** At render time:
    ```ts
    const keys = isShortcutId(cmd.id) ? getShortcut(cmd.id).keys : undefined
    ```
    `isShortcutId` is a simple type guard against `SHORTCUTS_BY_ID`. No `EditorCommandSpec` discriminated union, no `EditorCommandView` projection helper, no `getCommandView` join — just look up keys when rendering.
  - **No identity test on labels.** Menu labels and registry labels may match or differ; that's a UX choice, not a drift class. The framing above documents this so future contributors don't try to reconcile them.
- **`CommandPalette.tsx`** and **`EditorCommandMenu.tsx`** — read `cmd.label` directly; look up `keys` via the helper above when displaying the keyboard hint.
- **`slashCommands.ts`** — `SHORTCUT_MAP` is keyed by completion type (`'bullet'`, `'number'`, etc.), not by registry id. Add a small `COMPLETION_TYPE_TO_SHORTCUT_ID: Record<string, ShortcutId>` adapter map, replace `SHORTCUT_MAP` lookups with `getShortcut(map[completion.type]).keys`.
- **`Sidebar.tsx`** — `formatShortcut(getShortcut('app.commandPalette').keys)` instead of hardcoded literal.
- **`SettingsGeneral.tsx`** — same pattern.

### Testing

- For each surface, the derivation pattern asserting rendered text comes from the registry.
- `Sidebar.test.tsx`'s existing Mac/Windows tests adapted to derive expected text from the registry.

### Stop & Review

Final milestone. Run `make frontend-verify` and a quick manual smoke test on the dev server: open shortcuts dialog, hover toolbar buttons, open command palette, fire `Cmd+Shift+/` and `Cmd+B`. Confirm the four `Cmd+S`/`Cmd+Shift+S` literals in `ShortcutsDialog.tsx` are documented as a known carve-out.

---

## Out of Scope

- **Page-scoped shortcuts in Note/Bookmark/Prompt** (Cmd+S, Cmd+Shift+S, Escape). They stay as-is, untouched, and remain inline in `ShortcutsDialog.tsx`. Migrating them needs a context/scope dimension this PR doesn't design.
- **ProseMirror structural keymaps** (Tab, Shift+Tab, Backspace) — editor behavior, not user-visible shortcuts.
- **Layout-sensitivity for non-US punctuation** (Cmd+Shift+/, Cmd+\). Today's `event.key`-based matching is fragile across some non-US layouts and stays that way. The proposed `event.code` alternative creates worse fragility (US-physical-position) for non-US users on punctuation. A real cross-layout solution would likely re-bind on non-US layouts (VS Code-style) and is a separate ticket.
- **Generic command framework.** Registry stays a shortcut registry.
