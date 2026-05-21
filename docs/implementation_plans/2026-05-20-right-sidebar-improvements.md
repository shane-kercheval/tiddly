# Right Sidebar Improvements (KAN-153)

**Ticket:** https://tiddly.atlassian.net/browse/KAN-153
**Date:** 2026-05-20
**Status:** Planned — reviewed (two AI review passes + synthesis), pending implementation
**Branch:** `kan-153-right-sidebar-improvements`

> **Review note (2026-05-20):** This plan was reviewed by two independent agents and a synthesis pass. Six findings were folded back in — see the "Review-driven corrections" callouts inline and the revised Open Questions. All correctness/testing findings (#1–#5) accepted; #6 (shared maximize flag) confirmed as intended.

## Summary

Two changes to the right sidebar (Version History + Table of Contents panels), which appear on content detail pages while editing:

1. **Bug fix:** CodeMirror's Cmd+F find/replace panel renders *behind* the right sidebar instead of shifting with the main content.
2. **Feature:** Add a "max width" toggle button to the sidebar header (both panels) that expands the sidebar to its current maximum, and restores the previous user-set width on a second click. Includes a keyboard shortcut.

---

## Background: how the right sidebar works today

State lives in `frontend/src/stores/rightSidebarStore.ts`:
- `activePanel: 'history' | 'toc' | null` — only one panel open at a time.
- `width: number` — persisted to `localStorage` under `right-sidebar-width`, clamped to `>= MIN_SIDEBAR_WIDTH` (280). Default 400.
- `MIN_CONTENT_WIDTH = 600` — minimum space reserved for the editor.
- Only the `history` panel is persisted across reloads; `toc` is session-only.

`frontend/src/hooks/useResizableSidebar.ts`:
- Owns drag-to-resize and the responsive (`md` breakpoint, 768px) logic.
- `calculateMaxWidth()` (lines 10–14) computes the maximum sidebar width:
  ```
  max = window.innerWidth - leftSidebarWidth - MIN_CONTENT_WIDTH
  ```
  where `leftSidebarWidth` is read live from `document.getElementById('desktop-sidebar')`. **The left sidebar's collapsed/expanded state does factor in** (the user's hunch was correct).
- This same formula is duplicated in `Layout.tsx` `getRightSidebarMargin()` (lines 142–149).

Rendered width is `isDesktop ? Math.min(storeWidth, calculateMaxWidth()) : storeWidth`.

The sidebar panels:
- `frontend/src/components/HistorySidebar.tsx` — `fixed right-0 top-0 h-full z-50`, width via inline `style={{ width }}`. Header at lines 136–153.
- `frontend/src/components/TableOfContentsSidebar.tsx` — same positioning. Header at lines 46–55.

The main content shifts via `marginRight` in `Layout.tsx` (line 158), using `getRightSidebarMargin()`.

---

## Part 1 — Cmd+F find/replace bug

### Root cause (confirmed)

CSS only — `frontend/src/index.css:301–312`:

```css
.cm-editor .cm-panels-top {
  position: fixed !important;
  top: auto !important;
  right: 2rem !important;   /* anchored to the VIEWPORT right edge */
  left: auto !important;
  bottom: 0 !important;
  z-index: 50;
  ...
}
```

The search panel is `position: fixed`, pinned `2rem` from the **viewport** right edge. The right sidebar is also `fixed right-0` at `z-50` with width ~400px. Both are `z-50`, so DOM paint order wins and the sidebar covers the panel. The `position: fixed` is intentional (keeps the panel visible while scrolling long docs — see the comment at `index.css:297`), so we must keep it floating but offset it by the sidebar width.

### Fix

Make the panel's right offset track the sidebar margin, mirroring what the main content already does.

1. In `Layout.tsx`, in addition to (or instead of) the inline `marginRight` style on `#main-content`, write the computed margin to a CSS custom property on a stable root element so CSS can read it. Suggested: set `--right-sidebar-margin` (in px) on the `<main id="main-content">` element (or the outer layout `div`), updated from the same `getRightSidebarMargin()` value already computed.

2. Change the CSS rule to offset by that variable:
   ```css
   .cm-editor .cm-panels-top {
     ...
     right: calc(var(--right-sidebar-margin, 0px) + 2rem) !important;
   }
   ```
   The variable defaults to `0px` when the sidebar is closed, preserving current behavior.

### Notes / cautions

- The CSS variable must be set on an ancestor of the `.cm-editor` so the variable cascades to it. `#main-content` wraps the editor, so setting it there works. Verify the editor is actually a descendant of the element carrying the variable.
- Do **not** simply bump `z-index` — that would overlap the sidebar instead of moving the panel out from under it.
- The margin is animated (`transition-[margin] duration-200` on `#main-content`). The search panel's `right` will jump unless we also add a matching transition; consider `transition: right 200ms` on `.cm-panels-top` for parity (optional polish).
- Test with the left sidebar both collapsed and expanded (changes `calculateMaxWidth`), and at narrow widths where the sidebar width is clamped.

> **Review-driven correction (finding #2 — left-sidebar collapse staleness):** The CSS variable and the content margin both recompute only on render, and the only forced re-render path today is `window.resize` (`Layout.tsx:99-110` — a `setResizeCount` hack gated on `rightSidebarOpen`). Layout subscribes to `toggleCollapse` (the function) but **not** to the left sidebar's `isCollapsed` *state* (`Layout.tsx:56`). So collapsing/expanding the left sidebar (`w-12` ↔ `w-72`) does **not** recompute the right margin or the search-panel offset — they go stale until an unrelated resize. This is invisible today (right sidebar is normally narrower than max) but the maximize feature exposes it (see finding #2 under Part 2). **Fix here too:** subscribe `Layout` to `useSidebarStore((s) => s.isCollapsed)` so a left-sidebar toggle re-renders and recomputes `getRightSidebarMargin()` (and thus the `--right-sidebar-margin` variable). Reading the value is enough to subscribe. A `ResizeObserver` on `#desktop-sidebar` is the more robust alternative if we want to track the animated width frame-by-frame; the store subscription is simpler and sufficient since only the final width matters.

---

## Part 2 — Max-width toggle

### Behavior

- A toggle button in the header of both `HistorySidebar` and `TableOfContentsSidebar`.
- Click once → sidebar expands to `calculateMaxWidth()` (its current max, accounting for left sidebar + `MIN_CONTENT_WIDTH`).
- Click again → restore to the user's previous manual width.
- Keyboard shortcut toggles the same behavior.

### State design

In `rightSidebarStore.ts`:
- Add `maximized: boolean` and `toggleMaximized()` (and likely `setMaximized(bool)`).
- **Do not overwrite the user's `width`** when maximizing — that value is the "restore" target and is already persisted. Instead, when `maximized` is true, the *rendered* width becomes `calculateMaxWidth()`; the stored `width` is untouched.
- Decisions (confirmed with user):
  - **Persistence:** `maximized` persists across reloads (decision below — see Open Questions if changed).
  - **Shared vs per-panel:** single shared `maximized` flag across both panels (decision below).

### Rendering

- `useResizableSidebar.ts` should return the effective width: when `maximized`, return `calculateMaxWidth()`; otherwise the current `Math.min(storeWidth, calculateMaxWidth())`.
- `Layout.tsx` `getRightSidebarMargin()` must use the same effective width so content margin (and the Part 1 CSS variable) stay in sync. **Extract the duplicated `calculateMaxWidth()` into one shared helper** so the hook, Layout, and any toggle logic agree on a single source of truth.

  > **Review-driven correction (finding #5 — testability):** Split the helper into a **pure** `computeMaxWidth(innerWidth: number, leftSidebarWidth: number): number` (the arithmetic + `Math.max(MIN_SIDEBAR_WIDTH, …)` floor) and a thin DOM-reading wrapper that reads `window.innerWidth` / `#desktop-sidebar` and calls it. Both `Layout.tsx` and `useResizableSidebar.ts` use the wrapper. The pure function is what we unit-test (see Tests), so the maximize logic isn't silently asserting jsdom defaults (`innerWidth` 1024, `getElementById` → null → 0, which would make `computeMaxWidth` a tautology and let the 280 floor mask the logic).

- While `maximized`, dragging the resize handle should exit maximized mode and set a new manual width (natural: a drag implies the user wants a specific width). Implement by having the drag's `setWidth` also call `setMaximized(false)`.

> **Review-driven correction (finding #1 — passive resize must not corrupt the restore width):** This is the most important fix and a prerequisite for "restore to previous width" to work at all. Today the constrain effect (`useResizableSidebar.ts:32-43`) calls `setWidth(maxWidth)` whenever the viewport shrinks below the stored width, and `setWidth` **persists to localStorage** (`rightSidebarStore.ts:71-79`). This silently rewrites the user's manual width — so a user at 700px who maximizes then narrows the viewport would "restore" to the squeezed value, not 700px. Crucially this persist-on-shrink is **already redundant for display**: rendered width is independently clamped at `useResizableSidebar.ts:45` (`Math.min(storeWidth, calculateMaxWidth())`). **Fix:** remove the `setWidth(maxWidth)` call from the constrain effect (keep only `setIsDesktop(...)`), and **drop `storeWidth` from that effect's dependency array** (it's no longer read inside; leaving it causes needless listener re-subscription). Persist `width` only on explicit drag (`handleMouseMove`, lines 55-59, already does). With this, `width` always holds the user's intentional value, rendering clamps, and the maximized path computes from `computeMaxWidth()` — so the "don't overwrite width on maximize" promise holds **without** needing a separate `restoreWidth` field.

### Button

- 28×28 icon button matching the existing close button styling (`h-[28px] w-[28px] flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100`).
- Placement: in the header's **right-side group, immediately left of the close button**:
  `[Title (+ help icon)] ........ [⤢ max-width toggle] [✕ close]`
- Same in both `HistorySidebar` and `TableOfContentsSidebar`.
- Icon: an expand/collapse-horizontal style icon. Check `components/icons` for an existing one; add if needed.
- `aria-label` should reflect state ("Maximize sidebar width" / "Restore sidebar width").

### Tooltip

- Reuse the registry-driven shortcut tooltip pattern: `shortcutTooltipContent('app.toggleSidebarMaxWidth')` from `components/editor/shortcutTooltip.tsx`. It renders the registry label + platform-localized combo on a muted second line, staying in sync with the registry.
- Wrap with `<Tooltip ... compact delay={500}>` — **500ms delay** (confirmed with user; matches the formatting-toolbar buttons).
- **State-dependent label:** the tooltip text should flip between "Maximize Sidebar Width" and "Restore Sidebar Width". `shortcutTooltipContent(id)` currently pulls a fixed label from the registry. Add a small variant that accepts an optional label override, e.g. `shortcutTooltipContent(id, labelOverride?)`, so the combo stays registry-driven while the label can swap. Keep the existing single-arg call sites working.

### Keyboard shortcut

- **`⌘⌥\` (Cmd+Option+Backslash)** — deliberately pairs with the existing history-sidebar toggle `⌘⇧\` (`shortcuts/registry.ts:142`), preserving the "backslash = right sidebar" mental model.
- Add a registry entry in the `View` section of `frontend/src/shortcuts/registry.ts`:
  ```ts
  {
    id: 'app.toggleSidebarMaxWidth',
    label: 'Maximize Sidebar Width',
    section: 'View',
    keys: ['⌘', '⌥', '\\'],
    match: { mod: true, alt: true, code: 'Backslash' },
    allowInInputs: true,   // must work while editing in the editor
  }
  ```

  > **Review-driven correction (finding #3 — use `code: 'Backslash'`, not `key`):** On Mac, Option alters the produced character (Option+\ → `«`), so `key: '\\'` would silently fail for users editing — the primary use case. Use `code: 'Backslash'` from the start (no "fall back if unreliable" hedge). **Verified this works on the global path:** `useGlobalShortcuts` → `findMatchingShortcut` → `matches()` handles `code` generically (`matcher.ts`: `if (match.code !== undefined) return event.code === match.code`) on a `document` keydown listener. The `types.ts:46-48` comment ("`code` belongs to the capture-phase path; the CM keymap adapter throws on these") is scoped **only** to entries fed into CodeMirror's keymap — our id lives only in `APP_GLOBAL_IDS`, never the editor keymap, so there's no throw. Since this is the first global (non-editor) `code` matcher, **update the `types.ts:46-48` comment** so it no longer implies `code` is capture-phase-only. The display tokens stay `['⌘', '⌥', '\\']` (the registry coherence test already maps `Backslash` → `\`). `assertNoDuplicateMatchShapes` passes — distinct from `app.toggleHistorySidebar` (`⌘⇧\`) via the alt/shift flags and key-vs-code shape.

- **Register the id in the `APP_GLOBAL_IDS` tuple** (`Layout.tsx:38-46`) alongside the handler-map entry.

  > **Review-driven correction (finding #4):** `useGlobalShortcuts(APP_GLOBAL_IDS, {...})` only dispatches ids present in the tuple. A registry entry + handler without the tuple entry means the shortcut silently does nothing. This is an easy step to miss — call it out explicitly.

- Wire the handler in `Layout.tsx` (alongside `app.toggleHistorySidebar` at lines 131–133): only act when a panel is open (`isDetailPage` + `activePanel != null`), then call `toggleMaximized()`.
- Verify `⌘⌥\` does not collide with any browser/OS binding.

---

## Files to touch

- `frontend/src/index.css` — Part 1 CSS rule.
- `frontend/src/components/Layout.tsx` — expose `--right-sidebar-margin` CSS var; wire shortcut handler; use shared max-width helper.
- `frontend/src/stores/rightSidebarStore.ts` — `maximized` state + actions.
- `frontend/src/hooks/useResizableSidebar.ts` — effective width when maximized; exit-on-drag; use shared helper.
- `frontend/src/components/HistorySidebar.tsx` — toggle button in header.
- `frontend/src/components/TableOfContentsSidebar.tsx` — toggle button in header.
- `frontend/src/shortcuts/registry.ts` — new shortcut entry (`code: 'Backslash'`).
- `frontend/src/shortcuts/types.ts` — update the `code` matcher comment (lines 46-48); this becomes the first global `code` matcher.
- `frontend/src/components/editor/shortcutTooltip.tsx` — optional label-override variant.
- `frontend/src/components/icons` (or equivalent) — max-width icon if none exists.
- New shared max-width helper — pure `computeMaxWidth(innerWidth, leftSidebarWidth)` + thin DOM wrapper, to deduplicate `calculateMaxWidth()` and make the logic unit-testable.
- `Layout.tsx` — also add `'app.toggleSidebarMaxWidth'` to `APP_GLOBAL_IDS`, and subscribe to `useSidebarStore((s) => s.isCollapsed)` for left-sidebar invalidation.

## Docs to sync (per AGENTS.md)

- `frontend/src/pages/docs/DocsShortcuts.tsx` — document the new `⌘⌥\` shortcut.
- Consider `changelog/Changelog.tsx` if shipping as a user-visible change.

## Tests

- **Pure `computeMaxWidth(innerWidth, leftSidebarWidth)`** (finding #5): wide viewport; narrow viewport hitting the 280 floor; left sidebar collapsed (~48) vs expanded (~288). This is the meaningful coverage for the width math — do **not** rely on jsdom defaults via the DOM wrapper.
- **Restore width integrity (finding #1):** set width 700, simulate viewport shrink, assert the *persisted/stored* width is still 700 while the *rendered* width clamps. Update any existing resize test that asserts the old shrink-persists behavior to assert rendered-only clamping instead.
- **Maximize behavior:** effective width = max when maximized; restore to stored manual width on toggle-off; drag while maximized exits maximized and sets a new manual width.
- **Left-sidebar invalidation (finding #2):** with the right sidebar open/maximized, toggling left-sidebar collapse recomputes the right width / content margin.
- **Shortcut (findings #3, #4):** synthetic `{metaKey, altKey, code:'Backslash'}` event fires the handler; same combo without Cmd/Alt does not; handler no-ops when no panel open. `assertNoDuplicateMatchShapes` passes with the new entry.
- **Manual / visual:** Cmd+F panel position with sidebar open/closed, left sidebar collapsed/expanded (toggle live, not just on load), narrow viewport clamping. (Frontend-only change — run `make frontend-verify`; do not run backend tests.)

## Decisions (all confirmed — no open questions remain)

1. **Persistence of `maximized`** across reloads — **persisted**.
2. **Shared vs per-panel maximize flag** — **single shared flag**. The right sidebar is treated as one component with identical behavior for Version History and ToC; maximize is a property of the sidebar shell, not the panel — consistent with how `width` already behaves. **Intended consequence (finding #6):** after maximizing on History and reloading, the ToC panel will open already-maximized the next time it appears. This is by design, not a bug — recorded here so it isn't later mistaken for one. Both review agents confirmed this as the more coherent model than special-casing ToC.
3. **Shortcut `⌘⌥\`** — **agreed**, using `code: 'Backslash'` (see finding #3). Reconsider only if a browser/OS collision surfaces during implementation.
