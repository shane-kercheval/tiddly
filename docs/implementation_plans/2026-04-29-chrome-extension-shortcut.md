# Chrome Extension Keyboard Shortcut + Auto-Focus

**Date:** 2026-04-29
**Component:** `chrome-extension/`
**Status:** Planned

## Context & Goals

Users can already bind a keyboard shortcut to the Tiddly Chrome extension manually via `chrome://extensions/shortcuts`, but the extension does not suggest a default. Even with a shortcut bound, the popup is not useful keyboard-only because:

1. **Save tab**: After the popup opens, the user must mouse to the "Save Bookmark" button to save. Worse, on sites like Reddit and X.com the scraped title or description routinely exceeds the server-side character limits, which **disables** the Save button entirely — so even a hypothetical "press Enter to save" shortcut would do nothing until the user manually trims the offending field.
2. **Search tab**: After the popup opens on a restricted page (which auto-routes to Search), focus is not on the search input, so the user must click before typing.

This plan addresses four changes:

1. Suggest a default keyboard shortcut via `manifest.json`.
2. Truncate scraped title and description against server limits so the Save button is enabled out of the box. (Prerequisite for #3 — without this, auto-focus on Save lands on a disabled button on the sites where speed matters most.)
3. Auto-focus the Save button when the Save view finishes loading.
4. Auto-focus the search input when the Search view activates.

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

- `chrome-extension/manifest.json` — add `commands` block, bump version.
- `chrome-extension/popup-core.js` — truncate scraped title/description against server limits in `initSaveForm` (M2); focus calls in `initSaveForm` after form reveals (M3) and `initSearchView` on entry (M4).
- `chrome-extension/popup.js` — focus call on the setup-view CTA when no token is configured (so the no-token first-run experience matches the rest of the feature).
- `chrome-extension/test/popup-core.test.js` — unit-level assertions inside `initSaveForm` (truncation behaviors, focus on `saveBtn` after form reveal) and `initSearchView` (focus on `searchInput`).
- `chrome-extension/test/popup.test.js` — controller-level assertions (no-token setup CTA focus, restricted URL → Search default with focus on `searchInput`, regular URL → Save default with focus on `saveBtn`, tab-switch behaviors). The controller (`popup.js`) makes default-tab and `setTabEnabled` decisions, so these assertions cannot meaningfully live in `popup-core.test.js`.
- `chrome-extension/test/manifest.test.js` (new file) — manifest schema tripwire test. Independent of the popup DOM harness.
- `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — primary user-facing docs: the default shortcut, the silent-collision rebind path, and the auto-focus behaviors. End users read this page, not the repo README.
- `frontend/src/pages/changelog/Changelog.tsx` — add a user-facing changelog entry under the current month, tagged `extension`, covering the default shortcut, auto-focus on Save / Search, and the silent-collision rebind path. The changelog already has prior Chrome-extension entries (e.g., lines 165, 201) — match that format.
- `chrome-extension/README.md` — engineer/agent-facing brief note (one short paragraph) stating the default combo and the rebind path. Keep it terse; the docs page is the canonical source.
- `frontend/public/llms.txt` — if it references Chrome extension features, add the new shortcut so LLM-driven discovery picks it up.

The agent should **bump `manifest.json` version** (currently `0.3.0` → `0.4.0`) since this is a user-visible change shipped to the Web Store.

## Agent Behavior

- Complete each milestone fully (code + tests + docs) before moving on.
- Stop after each milestone for human review.
- Ask clarifying questions rather than guessing.
- Run `make chrome-ext-verify` after each milestone — all existing tests must continue to pass. (This is the canonical verify command per the Makefile and matches the project preference for scoped verify targets over raw `npm test`.)
- **Manual Chrome smoke test gate after M3 and M4 — human-driven.** jsdom does not simulate Chrome's popup-open focus race: programmatic `focus()` calls fired before the popup window finishes painting are silently dropped by real Chrome, but jsdom will report them as successful. The agent cannot perform this verification itself. After finishing M3 (and again after M4), the agent must **stop and ask the user** to load the unpacked extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked → `chrome-extension/`) and confirm focus visibly lands on the Save button (M3) and the search input (M4). Do not declare the milestone done until the user reports back. If the user reports focus does not land, escalate to `requestAnimationFrame(() => el.focus())` and ask for re-test.
- **M2 prerequisite:** the auto-focus milestones (M3, M4) depend on M2 (truncating pre-populated values) landing first. Without M2, auto-focus on the Save button on sites like Reddit and X.com lands on a *disabled* button (because the scraped title or description exceeds the limit), and Enter does nothing — defeating the entire purpose of the keyboard shortcut. Do not implement M3 before M2 is merged.
- No backwards-compatibility constraints; this is a minor version bump and no migration is needed.

### jsdom focus assertion fallback

If `document.activeElement === el` assertions don't work in jsdom for any of the focus tests in M3 / M4 / setup-view sub-task, the **only acceptable fallback** is:

```js
const focusSpy = vi.spyOn(el, 'focus');
// ... run the code under test ...
expect(focusSpy).toHaveBeenCalledTimes(1);
```

This proves the code path runs the focus call without claiming jsdom faithfully simulates focus. Do **not** use weakened assertions like `expect(document.activeElement).toBeTruthy()` — those are vacuous and will silently pass even if the focus code is deleted. Add a comment in the test explaining why the spy fallback was chosen so future readers don't "fix" it back to a vacuous assertion.

### Web Store re-review scope

Adding the `commands` block does not change `permissions` or `host_permissions`, so the Chrome Web Store deeper-review trigger (see `chrome-extension/README.md` §Common gotchas, "permissions changes") does **not** apply. Standard re-review only. The agent does not need to ask about this — proceed with the manifest edit.

---

## Milestone 1 — Suggested keyboard shortcut

### Goal & Outcome

Declare a suggested default shortcut so new installs get `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows/Linux) auto-bound to opening the popup. No JS handler is required because we use the reserved `_execute_action` command.

After this milestone:

- A fresh install of the extension on a machine with no conflicting extension shortcut binds the chosen combo automatically to "Activate the extension."
- Existing installs are unaffected (Chrome does not retroactively apply suggested keys to already-installed extensions; users can still bind manually).
- The public docs page (`DocsExtensionsChrome.tsx`) documents the shortcut and the rebind path as a top-level section. The repo `README.md` has a brief one-paragraph note covering the same for engineers/agents.

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
4. Update `frontend/src/pages/docs/DocsExtensionsChrome.tsx`. There is already a single "Keyboard shortcut" bullet in the "Tips" section at the bottom that just points to `chrome://extensions/shortcuts`. Promote it to a proper top-level section (between "Search Tab" and "Tips" feels natural), and structure it so the silent-collision rebind path is the **first** thing the user sees, not a footnote:
   - State the default: `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows/Linux) opens the popup.
   - Lead with the warning: if another extension already owns the combo, Chrome silently leaves Tiddly's shortcut unbound — there is no error message. Users who hit this must visit `chrome://extensions/shortcuts` and bind it manually (or pick a different combo). Include explicit step-by-step rebind instructions (open `chrome://extensions/shortcuts`, find "Tiddly Bookmarks", click the pencil icon next to "Activate the extension", press the desired combo, click OK).
   - Note that pressing Enter while the popup is open will save (Save tab) or jump straight to typing in search (Search tab) thanks to the auto-focus from M3/M4 — this ties the milestones together as one user-visible feature.
   - Remove the now-redundant single bullet from the Tips section.

   **Tangential cleanup while editing this file:** Line ~97 currently says "up to 25,000 characters" but the actual client cap is `SCRAPE_CAP = 200000` and the server further caps via `max_bookmark_content_length`. Replace with the looser, accurate wording: **"up to your plan's content limit"**. Single-line fix; do it in the same edit since the file is already open.

5. Update `chrome-extension/README.md`: add a brief paragraph (under "Features" or as its own short section, not a full subsection) saying: "Default keyboard shortcut: `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows/Linux). If silently unbound (combo already claimed by another extension), rebind at `chrome://extensions/shortcuts`. See the public docs for full instructions." Keep it terse — the user-facing docs are the canonical source.

6. Check `frontend/public/llms.txt`: if it lists Chrome-extension features, append the keyboard shortcut so LLM-driven site indexing surfaces it.

### Testing Strategy

`manifest.json` is static JSON — no behavioral test is meaningful. The check below is a **tripwire** against future accidental deletion or rename of the `commands` block during unrelated edits, **not** coverage of binding behavior. Only the manual Chrome smoke test (see Agent Behavior) actually proves the shortcut works in real Chrome. Be honest about this in the test file's comments.

**Create `chrome-extension/test/manifest.test.js`** (new file). 1:1 mapping (manifest → manifest.test.js) keeps the tripwire greppable and discoverable. Load `manifest.json` via `fs.readFileSync` + `JSON.parse` (same loading pattern used in `chrome-extension/test/popup.test.js:1-6`); keep this file independent of the popup DOM harness — no `setupPopupDOM` import, no Chrome API mocks needed.

Assertions:

- Load `manifest.json`, assert `commands._execute_action.suggested_key.default === "Ctrl+Shift+S"` and `.mac === "Command+Shift+S"`.
- Assert `commands._execute_action.description` is a non-empty string.
- Assert `manifest_version === 3` (sanity).

---

## Milestone 2 — Truncate pre-populated title and description

### Goal & Outcome

When the Save view scrapes title and description from the current page, truncate each to the server-provided limit before populating the form. This unblocks the keyboard-only flow: today on sites like Reddit and X.com, the scraped title/description routinely exceed `max_title_length` / `max_description_length`, which disables the Save button (`popup-core.js:283`). M3's auto-focus on the Save button is meaningless if Enter does nothing because the button is disabled.

User-typed and pasted content is **not** affected — the existing "warn at ≥70%, mark exceeded at >100%, disable Save" flow continues to work exactly as today. Only the **scraped** values are silently truncated.

After this milestone:

- Opening the popup on a Reddit thread or X.com post pre-populates a title at exactly the limit (e.g., `200/200`), Save button is enabled, character counter renders in the warning gradient as the natural visual indicator that something was trimmed.
- User can still type or paste over the limit; the existing exceeded-state UI takes over (red message, Save disabled).
- Cached drafts continue to restore whatever the user had — no migration needed because `saveDraft()` writes from the inputs, which after this fix only ever contain truncated scraped values (or whatever the user intentionally typed).

### Implementation Outline

1. In `popup-core.js`, in the fresh-fetch branch of `initSaveForm` (around lines 408-409), change:

   ```js
   titleInput.value = pageData.title || '';
   descriptionInput.value = pageData.description || '';
   ```

   to use **code-point-aware truncation** against the limits returned from the server. **Do not use `.substring()`** — it operates on UTF-16 code units and can split a surrogate pair (e.g., an emoji at the limit boundary), producing an unpaired surrogate that Postgres in UTF-8 encoding rejects with a 422 — a worse failure mode than today's "Save disabled." Reddit and X.com titles routinely end with emoji, which is exactly the population we're targeting.

   Add a small helper near the top of the file (next to `SCRAPE_CAP`):

   ```js
   function truncateByCodePoints(str, max) {
     const s = str || '';
     const codePoints = Array.from(s);
     return codePoints.length <= max ? s : codePoints.slice(0, max).join('');
   }
   ```

   Then in `initSaveForm`:

   ```js
   titleInput.value = truncateByCodePoints(pageData.title, limitsResult.data.max_title_length);
   descriptionInput.value = truncateByCodePoints(pageData.description, limitsResult.data.max_description_length);
   ```

   **Known limitation:** grapheme clusters (e.g., flag emojis composed of two regional indicator code points, or `family` emoji built from ZWJ sequences) may still split awkwardly. Accepted trade-off — the priority is preventing invalid UTF-8 from reaching the API, not perfect grapheme-aware truncation. If this becomes a real user complaint, escalate to `Intl.Segmenter`.

2. **Delete the existing test at `chrome-extension/test/popup-core.test.js:375-393`** ("does not truncate scraped title/description and disables save when exceeded"). It encodes pre-M2 behavior and is being intentionally inverted by this milestone. The new tests in this milestone (below) replace it. This is one of the rare cases where deleting a test is the correct action — the *behavior* is what's changing, not the test quality.

   Note: the related test at `popup-core.test.js:450` ("shows limit feedback if pre-populated values are at the limit", `'a'.repeat(100)` against `max_title_length: 100`) **stays valid** — exact-limit values are not truncated, so the "100 / 100 — Character limit reached" feedback still renders. Preserve this test as-is; it covers the exact-limit boundary case.

3. Do **not** truncate in the cached-data path (lines 372-380). Cached drafts represent prior user state — they were saved by `saveDraft()` from the inputs. Touching the cached path would override user intent.
4. No silent truncation of `pageContent` is needed — `applyLimits()` already handles this at lines 309-310.
5. No new UI affordance ("Title shortened to fit" notice or similar). The existing character counter, which becomes visible at ratio ≥ 0.7 and renders in the warning gradient, is the visual signal. Adding a notice would be redundant noise.

### Testing Strategy

Extend `chrome-extension/test/popup-core.test.js`:

- **Title truncation**: mock `getPageData` to return a title longer than `max_title_length`, run `initSaveForm`, assert `Array.from(titleInput.value).length === max_title_length`. (Use `Array.from(...).length` to count code points, not `.length`, since the helper truncates by code points.)
- **Description truncation**: same, for description against `max_description_length`.
- **Save stays enabled after truncation**: the regression guard for the M3 dependency. After init with over-limit scraped values, assert `saveBtn.disabled === false`. Without this test, a future regression could silently break the entire keyboard-only flow.
- **Under-limit values pass through unchanged**: mock `getPageData` with values comfortably under the limits, assert `titleInput.value === pageData.title` exactly (no spurious slicing).
- **Boundary cases for both title and description:**
  - `length === limit`: title at exactly `max_title_length` chars passes through unchanged. (The existing test at `popup-core.test.js:450` covers this for title; preserve it and mirror for description.)
  - `length === limit + 1`: title at `max_title_length + 1` chars trims to exactly `max_title_length`. Off-by-one bugs slip through "comfortably under / comfortably over" tests.
- **Surrogate-pair safety (emoji at boundary)**: mock `getPageData` with `pageData.title = 'a'.repeat(max_title_length - 1) + '🚀'` (the emoji is 2 UTF-16 code units; naive `.substring(0, max_title_length)` would split its surrogate pair). After init, assert `titleInput.value` contains no unpaired surrogates: `expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(titleInput.value)).toBe(false)`. This is the test that proves the code-point-aware helper is being used; without it, a future "simplification" back to `.substring()` would silently regress.
- **User typing over the limit still disables Save**: after init, simulate `titleInput.value = 'x'.repeat(maxTitleLength + 1)` followed by an `input` event, assert `saveBtn.disabled === true`. This confirms we did not regress the existing "user can exceed, with warning" behavior.
- **Cached path is untouched**: with `DRAFT_KEY` containing a title at `maxTitleLength + 50`, assert `titleInput.value.length === maxTitleLength + 50` after init — the cached path does not truncate. **This test guards two real-world scenarios:** (1) intentional user-typed over-limit drafts (the existing "warn at >100%, disable Save" UX is preserved); (2) **legacy cached drafts** produced by pre-M2 versions (0.3.0 and earlier) that stored untrimmed scraped values into `DRAFT_KEY`. Both will exist in real-world installs after M2 ships. Don't remove this test thinking the state is impossible.

---

## Milestone 3 — Auto-focus the Save button

### Goal & Outcome

When the Save view finishes loading (form revealed, scrape complete or failed-but-form-shown), the **Save Bookmark** button receives focus. The user can then press Enter to save without moving the mouse. Clicking into Title/Description/Tags moves focus normally and preserves all existing behavior (textarea newlines, tags input Enter-to-add-chip).

After this milestone:

- Opening the popup on a saveable page → Title/Description/Tags populate → focus lands on the Save button → Enter saves.
- Clicking into any field works exactly as today.
- Existing tab-switch behavior (Save → Search → Save within one popup open) does not double-focus or fight the user.

### Implementation Outline

1. In `popup-core.js`, locate the single point where the form is revealed:
   - Line ~437: `loadingIndicator.hidden = true; saveForm.hidden = false;` — this is the **only** path that reveals the form. Both the cached-data branch (lines ~372-380) and the fresh-fetch branch (lines ~381-432) fall through to this same line.
   - Line ~393's earlier `loadingIndicator.hidden = true;` is on the limits-error branch, which calls `showSaveStatus(...)` and `return`s without revealing the form. No focus call needed there.
   - Add one synchronous `saveBtn.focus()` immediately after line 437. No helper function needed since there is only one reveal site.
2. Use a plain `saveBtn.focus()` call. Do **not** add `preventScroll` or other options unless a test reveals a need.
3. Wrap the focus call in a `requestAnimationFrame` only if a test demonstrates the synchronous call doesn't take effect — Chrome popups occasionally drop focus calls made before paint. Default to the simple synchronous call first; only escalate if tests fail.
4. Do **not** alter `:focus-visible` styling. A focus ring on the Save button is **expected and desired** — it's the visual signal that "Enter will save." Do not suppress it via CSS. Only flag for human review if a ring appears on an unexpected element (e.g., a tab button, an input).

### Sub-task: Setup-view focus (no token configured)

A first-time user who hits the new shortcut before configuring a PAT lands on the setup view. The same keyboard-only intent applies: their next keystroke should do the most useful thing without needing the mouse. In `popup.js` (around lines 90-95), after `setPopupMode('setup')` runs and the `open-options` click listener is attached, call `document.getElementById('open-options').focus()` so Enter activates the CTA. One line of code.

The same jsdom-vs-real-Chrome focus caveat applies here as to the Save button — `setPopupMode('setup')` flips `setupView.hidden = false` immediately before the focus call, which is the same hidden-then-shown pattern. If the test fails in jsdom, use the spy fallback documented in Agent Behavior. Include this state in the manual Chrome smoke test gate: ask the user to also verify focus on the "Open Settings" button when opening the popup with no token configured.

### Testing Strategy

Tests are split by layer. **`popup-core.test.js`** for unit-level assertions inside `initSaveForm`. **`popup.test.js`** for controller-level assertions that exercise `popup.js`'s init flow (token check, `setTabEnabled`, default-tab routing) — these cannot meaningfully live in `popup-core.test.js` because the controller is what makes those decisions.

**In `popup-core.test.js`** (extend existing):

- **Happy path (fresh fetch)**: After `initSaveForm` resolves on a valid tab + successful scrape, `document.activeElement === saveBtn`.
- **Cached-data path**: After `initSaveForm` resolves with cached `DRAFT_KEY` + `DRAFT_IMMUTABLE_KEY` for the current URL (skipping the API), `document.activeElement === saveBtn`. Both paths share the same reveal line, but a separate test guards against future refactors that diverge them.

**In `popup.test.js`** (controller-level — uses the existing `runPopup()` harness that loads `popup.html` + imports `popup.js`):

- **No-token setup CTA focus**: with no `token` in storage, after `runPopup()` settles, `document.activeElement === document.getElementById('open-options')`.
- **Regular URL → Save default + focused**: with a token and a regular `https://` tab URL, after `runPopup()` settles, `document.activeElement === document.getElementById('save-btn')`.
- **Restricted URL → Search default + focused**: with a token and a `chrome://newtab/` (or other restricted) tab URL, after `runPopup()` settles, the Save tab has `aria-disabled="true"` and `document.activeElement === document.getElementById('search-input')`. This is the auto-route flow that motivates M4.

Note: tab-switch re-focus behavior is automatically protected by the existing `saveInitialized` / `searchInitialized` guards in `popup.js:43-55` — `initSaveForm` and `initSearchView` each run at most once per popup open, so no test for "tab switch back to X doesn't re-steal focus" is needed. This is **deliberate**, not an oversight: once the user has touched the mouse to switch tabs mid-session, focus management belongs to them, not us.

**Reminder:** jsdom-passing tests do not prove the feature works in real Chrome — see "Manual Chrome smoke test gate" in Agent Behavior. If jsdom does not faithfully simulate `.focus()` on hidden-then-shown elements, use the spy fallback documented under "jsdom focus assertion fallback" in Agent Behavior. Ask before adding a non-standard testing library.

---

## Milestone 4 — Auto-focus the search input

### Goal & Outcome

When the Search view activates (either by user clicking the Search tab, or auto-routed because the current page is restricted), the search input receives focus so the user can type immediately.

After this milestone:

- Opening the popup on a `chrome://` page (auto-routes to Search) → focus lands on the search input.
- Clicking the Search tab from the Save view → focus lands on the search input.
- Switching back to Save → no spurious focus on search input.

### Implementation Outline

1. In `popup-core.js`, locate `initSearchView` (line ~741). Add `searchInput.focus()` as the **last line** of the function, after all listener wiring. Nothing in `initSearchView` or in the fire-and-forget `loadBookmarks(...)` call would steal focus from the search input, so placement is mostly stylistic — putting it last makes the intent unambiguous.
2. **Focus only on first init per popup open.** Do not re-focus on subsequent tab switches back to Search within the same popup session. This matches the existing lazy-init pattern (`searchInitialized` guard in `popup.js`). Cross-popup-open behavior is automatic: the popup's JS context is destroyed on close (see comment at `popup.js:41-42`), so every reopen re-runs init and re-applies focus.

   This is a **deliberate UX choice**, not a side-effect of the lazy-init pattern: auto-focus is a service to the keyboard-only user. Once the user has touched the mouse to switch tabs mid-session, they're driving manually, and us auto-stealing focus would override their intent. The keyboard-only flows (shortcut → popup opens → first init runs → focus applied) are fully covered by first-init-only.
3. No "don't steal focus" guard needed — `initSearchView` only runs on first activation, before the user has had a chance to interact.

### Testing Strategy

Tests are split by layer (same convention as M3).

**In `popup-core.test.js`** (unit-level):

- **Happy path**: After `initSearchView` resolves, `document.activeElement === searchInput`.

**In `popup.test.js`** (controller-level — covered by the M3 "Restricted URL → Search default + focused" test, which already proves the auto-route path lands focus on `searchInput`):

- **Tab-switch does not re-focus**: open the popup on a regular URL (Save is the default), then simulate clicking the Search tab → focus lands on `searchInput` (first init), then simulate clicking the Save tab → focus does not get re-stolen, then simulate clicking Search again → on the second activation of Search, `initSearchView` does not run again and focus is **not** moved back to `searchInput` (it stays wherever the click landed). This proves the `searchInitialized` guard correctly prevents re-stealing.

---

## Open Questions for the Agent to Confirm Before Implementing

The agent should not need to ask additional clarifying questions before starting M1 — earlier rounds of plan review have closed the previously-open items (shortcut combo, focus-target choice, first-init-only UX rationale, doc target split). The bump itself (`0.3.0 → 0.4.0`) is a one-line code edit included in M1's Implementation Outline and **does not require user confirmation** — packaging (`make chrome-ext-zip`) and Web Store upload are separate user-driven release actions per `chrome-extension/README.md` §Releasing a New Version, and are out of scope for the implementing agent.

If the agent encounters genuinely new ambiguity not addressed by this plan, ask before proceeding.

## Release Notes (for the human at release time, not the implementing agent)

When releasing this version bump:

- **Chrome Web Store listing description**: update per `chrome-extension/README.md:91` (step 7 of Releasing a New Version) if you want the public listing to mention the new keyboard-first flow. Optional — the listing isn't required to enumerate every feature.
- **Store assets / screenshots**: not required for this change unless you intentionally want the screenshots to showcase the keyboard-first flow.
- **Changelog**: already covered as part of M1's Files Touched — should be in `main` before the Web Store upload, not after.
