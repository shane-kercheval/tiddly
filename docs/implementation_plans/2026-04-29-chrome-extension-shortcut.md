# Chrome Extension Keyboard Shortcut + Auto-Focus

**Date:** 2026-04-29
**Component:** `chrome-extension/`
**Status:** Planned

## Context & Goals

Users can already bind a keyboard shortcut to the Tiddly Chrome extension manually via `chrome://extensions/shortcuts`, but the extension does not suggest a default. Even with a shortcut bound, the popup is not useful keyboard-only because:

1. **Save tab**: After the popup opens, the user must mouse to the "Save Bookmark" button to save. This defeats the speed benefit of a shortcut.
2. **Search tab**: After the popup opens on a restricted page (which auto-routes to Search), focus is not on the search input, so the user must click before typing.

This plan addresses three changes:

1. Suggest a default keyboard shortcut via `manifest.json`.
2. Auto-focus the Save button when the Save view finishes loading.
3. Auto-focus the search input when the Search view activates.

### Shortcut choice

We are leaning toward **`Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows/Linux)**. Both are unbound by Chrome itself on all three platforms.

Caveats the agent should be aware of:

- Chrome's `suggested_key` is best-effort only. If another extension installed earlier already claimed the same combo, Chrome silently leaves ours unbound and the user must rebind manually at `chrome://extensions/shortcuts`.
- Suggested keys are limited to 4 per extension (we only need 1).
- The shortcut only fires when Chrome has window focus (default scope: "In Chrome"). This is the desired behavior — global scope is not needed.

### Reference Documentation

The agent should read these before implementing:

- Chrome `commands` API (manifest declaration & event handling): https://developer.chrome.com/docs/extensions/reference/api/commands
- `_execute_action` reserved command (opens the popup with no JS handler needed): https://developer.chrome.com/docs/extensions/develop/ui/shortcut-keys
- `HTMLElement.focus()` and `:focus-visible` semantics: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus

## Files Touched (expected)

- `chrome-extension/manifest.json` — add `commands` block.
- `chrome-extension/popup-core.js` — focus calls in `initSaveForm` (after form reveals) and `initSearchView` (on entry).
- `chrome-extension/test/popup-core.test.js` (and/or `popup.test.js`) — focus assertions.
- `chrome-extension/README.md` — document the default shortcut and how to rebind.

The agent should **bump `manifest.json` version** (currently `0.3.0` → `0.4.0`) since this is a user-visible change shipped to the Web Store.

## Agent Behavior

- Complete each milestone fully (code + tests + docs) before moving on.
- Stop after each milestone for human review.
- Ask clarifying questions rather than guessing.
- Run `cd chrome-extension && npm test` after each milestone — all existing tests must continue to pass.
- No backwards-compatibility constraints; this is a minor version bump and no migration is needed.

---

## Milestone 1 — Suggested keyboard shortcut

### Goal & Outcome

Declare a suggested default shortcut so new installs get `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows/Linux) auto-bound to opening the popup. No JS handler is required because we use the reserved `_execute_action` command.

After this milestone:

- A fresh install of the extension on a machine with no conflicting extension shortcut binds the chosen combo automatically to "Activate the extension."
- Existing installs are unaffected (Chrome does not retroactively apply suggested keys to already-installed extensions; users can still bind manually).
- README documents the shortcut and the rebind path.

### Implementation Outline

1. Read the Chrome `commands` and `_execute_action` documentation linked above.
2. Add a `commands` block to `manifest.json` with `_execute_action` and a `suggested_key` per platform:

   ```json
   "commands": {
     "_execute_action": {
       "suggested_key": {
         "default": "Ctrl+Shift+S",
         "mac": "Command+Shift+S"
       },
       "description": "Open Tiddly Bookmarks"
     }
   }
   ```

   Notes for the agent:
   - The `default` key applies to Windows and Linux (and ChromeOS).
   - Use the literal string `Command` (not `Cmd`) on Mac — Chrome's manifest parser is strict.
   - No `background.js` change needed; `_execute_action` opens the popup automatically.
3. Bump `manifest.json` `version` to `0.4.0`.
4. Update `chrome-extension/README.md`: add a short "Keyboard shortcut" section explaining the default combo, that it may be unbound if another extension claimed it first, and how to rebind at `chrome://extensions/shortcuts`.

### Testing Strategy

`manifest.json` is static JSON — no behavioral test is meaningful. Add a lightweight schema check (one test) in `chrome-extension/test/`:

- Load `manifest.json`, assert `commands._execute_action.suggested_key.default === "Ctrl+Shift+S"` and `.mac === "Command+Shift+S"`.
- Assert `commands._execute_action.description` is a non-empty string.
- Assert `manifest_version === 3` (sanity).

This catches accidental edits that drop or rename the block.

---

## Milestone 2 — Auto-focus the Save button

### Goal & Outcome

When the Save view finishes loading (form revealed, scrape complete or failed-but-form-shown), the **Save Bookmark** button receives focus. The user can then press Enter to save without moving the mouse. Clicking into Title/Description/Tags moves focus normally and preserves all existing behavior (textarea newlines, tags input Enter-to-add-chip).

After this milestone:

- Opening the popup on a saveable page → Title/Description/Tags populate → focus lands on the Save button → Enter saves.
- Clicking into any field works exactly as today.
- Existing tab-switch behavior (Save → Search → Save within one popup open) does not double-focus or fight the user.

### Implementation Outline

1. In `popup-core.js`, locate the points where the form is revealed:
   - Line ~437: `loadingIndicator.hidden = true; saveForm.hidden = false;` (success path)
   - Line ~393: there's an earlier `loadingIndicator.hidden = true;` — confirm whether the form is also shown there or only the loading indicator hides.
   - The agent should trace `initSaveForm` end-to-end and identify **every** path that reveals the form, then call `saveBtn.focus()` once after the form becomes visible. If there are multiple paths, factor a small helper rather than duplicating.
2. Use a plain `saveBtn.focus()` call. Do **not** add `preventScroll` or other options unless a test reveals a need.
3. Wrap the focus call in a `requestAnimationFrame` only if a test demonstrates the synchronous call doesn't take effect — Chrome popups occasionally drop focus calls made before paint. Default to the simple synchronous call first; only escalate if tests fail.
4. Do **not** alter `:focus-visible` styling. Programmatic focus on a button in Chrome does not normally trigger the focus ring; if a ring appears, surface it for human review rather than CSS-hacking it away.

### Testing Strategy

`chrome-extension/test/popup-core.test.js` already covers `initSaveForm`. Extend it:

- **Happy path**: After `initSaveForm` resolves on a valid tab + successful scrape, `document.activeElement === saveBtn`.
- **Form-revealed-before-scrape-resolves edge case** (if applicable from reading the code): if the form is shown before scrape data arrives, ensure focus lands on Save (and isn't fought by a later code path that moves focus elsewhere).
- **No regression on tab switch**: Save view opens → focus on Save button → user clicks Search tab → activates Search → user clicks back to Save tab. Focus behavior on the second activation should match what the existing tests expect (likely: not re-focusing Save, since it's a re-entry, not a fresh open). Confirm with existing tests; if uncertain, ask.
- **Restricted-page path**: when `setTabEnabled('save', false, ...)` is called and Save is disabled, `initSaveForm` is not called, so focus is not on Save. Verify nothing here breaks.

If `jsdom` does not faithfully simulate `.focus()` on hidden-then-shown elements, document the limitation in the test file rather than skipping the assertion. Ask before adding a non-standard testing library.

---

## Milestone 3 — Auto-focus the search input

### Goal & Outcome

When the Search view activates (either by user clicking the Search tab, or auto-routed because the current page is restricted), the search input receives focus so the user can type immediately.

After this milestone:

- Opening the popup on a `chrome://` page (auto-routes to Search) → focus lands on the search input.
- Clicking the Search tab from the Save view → focus lands on the search input.
- Switching back to Save → no spurious focus on search input.

### Implementation Outline

1. In `popup-core.js`, locate `initSearchView` (line ~741). Add `searchInput.focus()` near the end of initialization, after the view is rendered.
2. **Focus only on first init per popup open.** Do not re-focus on subsequent tab switches back to Search within the same popup session. This matches the existing lazy-init pattern (`searchInitialized` guard in `popup.js`). Cross-popup-open behavior is automatic: the popup's JS context is destroyed on close (see comment at `popup.js:41-42`), so every reopen re-runs init and re-applies focus.
3. No "don't steal focus" guard needed — `initSearchView` only runs on first activation, before the user has had a chance to interact.

### Testing Strategy

Extend `chrome-extension/test/popup-core.test.js`:

- **Happy path**: After `initSearchView` resolves, `document.activeElement === searchInput`.
- **Auto-route path** (restricted page): from `popup.test.js` or equivalent, assert that when Save is disabled and Search becomes the default tab, focus lands on `searchInput`.
- **Tab-switch does not re-focus**: open Save → switch to Search (focus lands on search input) → switch to Save → switch back to Search. On the second activation of Search, `initSearchView` does not run again and focus is **not** moved back to the search input.

---

## Open Questions for the Agent to Confirm Before Implementing

1. **Manifest version bump** (Milestone 1, step 3): `0.3.0 → 0.4.0` is the proposed bump. Confirm before publishing implications (Web Store re-review).
2. **README placement**: where in `chrome-extension/README.md` does the new "Keyboard shortcut" section belong? Read the README first and propose a location.
