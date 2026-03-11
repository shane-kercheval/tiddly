# Chrome Extension: Dynamic Character Limits from Server

## Context

The Chrome extension hardcodes character limits in two places: HTML attributes (`maxlength="100"` on title, `maxlength="1000"` on description) for browser enforcement, and JS constants (`MAX_TITLE_LENGTH=500`, `MAX_DESCRIPTION_LENGTH=1000`, `MAX_CONTENT_LENGTH=25000`) for truncation in `initSaveForm` and `handleSave`. Neither matches the backend's tier-based limits (e.g. FREE tier: title=100, description=1000, content=100,000). When a user types or pastes text exceeding the limit, the browser's `maxlength` attribute silently truncates it with no feedback. The frontend web app already handles this correctly — it fetches limits from `GET /users/me/limits`, sets `maxLength` dynamically, and shows "Character limit reached (X)" when at the limit. The extension should match this behavior.

### Reference files

- Backend endpoint: `GET /users/me/limits` — returns `UserLimits` object with `max_title_length`, `max_description_length`, `max_bookmark_content_length`, etc.
- Frontend validation pattern: `frontend/src/constants/validation.ts` — `characterLimitMessage(limit)` returns `"Character limit reached (X)"`
- Frontend limits hook: `frontend/src/hooks/useLimits.ts` — fetches and caches limits
- Frontend usage example: `frontend/src/components/Bookmark.tsx` — sets `maxLength` on inputs, truncates fetched metadata to limits

---

## Milestone 1: Add `GET_LIMITS` handler to background.js, update popup.html/css, and wire up dynamic limits in popup.js

### Goal & Outcome

Replace hardcoded character limits in the Chrome extension with server-fetched, cached limits. After this milestone:

- Extension fetches limits from `GET /users/me/limits` on popup open
- Tags and limits are cached alongside the draft — reopening the popup on the same URL skips API calls entirely
- Navigating to a different URL or saving a bookmark clears the cache, ensuring fresh data on the next attempt
- `maxLength` is set dynamically on title/description inputs based on server limits — values exceeding the limit are truncated (scraped page data on initial population, and browser-enforced on user input)
- Red "Character limit reached (X)" feedback appears when a field is at its limit (matching the frontend web app pattern)
- Page content scraping uses a generous fixed cap (200,000) since the actual server limit is applied when populating the form
- If limits can't be fetched and no cache exists, an error message is shown instead of the form

### Implementation Outline

#### 1. `chrome-extension/background.js` — Add `GET_LIMITS` message handler

Follow the existing `GET_TAGS` pattern (lines 28-33, 68-80):

- Add a `GET_LIMITS` case in the `onMessage` listener that calls `handleGetLimits()`
- `handleGetLimits()` calls `GET /users/me/limits` with the PAT token and `X-Request-Source: chrome-extension` header
- Returns `{ success: true, data: <limits object> }` on success, `{ success: false, status }` on failure

```js
// In listener (after GET_TAGS block):
if (message.type === 'GET_LIMITS') {
  handleGetLimits().then(sendResponse).catch(err =>
    sendResponse({ success: false, error: err.message })
  );
  return true;
}

// Handler function (after handleGetTags):
async function handleGetLimits() {
  const token = await getToken();
  const res = await fetchWithTimeout(`${API_URL}/users/me/limits`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Request-Source': 'chrome-extension'
    }
  });
  if (res.ok) {
    return { success: true, data: await res.json() };
  }
  return { success: false, status: res.status };
}
```

#### 2. `chrome-extension/popup.html` — Remove hardcoded `maxlength`, add feedback spans

- Remove `maxlength="100"` from the title input (line 36)
- Remove `maxlength="1000"` from the description textarea (line 40)
- Add `<span class="field-limit" id="title-limit" hidden></span>` after the title input
- Add `<span class="field-limit" id="description-limit" hidden></span>` after the description textarea

#### 3. `chrome-extension/popup.css` — Add `.field-limit` styles

```css
.field-limit {
  display: block;
  font-size: 11px;
  color: #dc2626;
  margin-top: 2px;
}

@media (prefers-color-scheme: dark) {
  .field-limit {
    color: #fca5a5;
  }
}
```

#### 4. `chrome-extension/popup.js` — Fetch, cache, and apply dynamic limits

**Remove** the three hardcoded constants: `MAX_CONTENT_LENGTH`, `MAX_TITLE_LENGTH`, `MAX_DESCRIPTION_LENGTH`.

**Add** module-level state:

```js
// Practical cap for DOM text extraction to avoid freezing the page. The server's
// max_bookmark_content_length may exceed this for higher tiers (e.g. PRO = 1,000,000),
// meaning some page content may not be captured via the extension. This is an accepted
// limitation — the extension is a convenience tool, not the primary interface. The web
// app handles full content limits.
const SCRAPE_CAP = 200000;
let limits = null; // populated from server or cache
```

**Add** DOM references for feedback spans:

```js
const titleLimit = document.getElementById('title-limit');
const descriptionLimit = document.getElementById('description-limit');
```

**Add** helper functions:

```js
function characterLimitMessage(limit) {
  return `Character limit reached (${limit.toLocaleString()})`;
}

function updateLimitFeedback(input, feedbackEl, maxLength) {
  if (input.value.length >= maxLength) {
    feedbackEl.textContent = characterLimitMessage(maxLength);
    feedbackEl.hidden = false;
  } else {
    feedbackEl.hidden = true;
  }
}

function applyLimits(limitsObj) {
  limits = limitsObj;
  titleInput.maxLength = limitsObj.max_title_length;
  descriptionInput.maxLength = limitsObj.max_description_length;
  // Truncate content to server limit
  if (pageContent.length > limitsObj.max_bookmark_content_length) {
    pageContent = pageContent.substring(0, limitsObj.max_bookmark_content_length);
  }
}
```

**Modify `getPageData(tab)`:** Use `SCRAPE_CAP` (200,000) instead of the removed `MAX_CONTENT_LENGTH`. Remove `url` from the return value — the URL should always come from `tab.url` (the Chrome tabs API), not from the content script's `window.location.href`, to avoid subtle mismatches with hash fragments or redirects.

**Modify the draft/cache strategy:**

The draft is split into two storage keys scoped to the current URL. When the popup opens on a different URL, both are ignored and overwritten. This avoids redundant API calls and page scraping when the user reopens the popup on the same page (e.g. to copy text from the page into the form), while avoiding writing large immutable data on every keystroke.

- **`DRAFT_KEY`** — mutable form fields, written on every keystroke (same as today plus `url`):
  ```js
  // Written by saveDraft() on every input event
  { url, title, description, tags }
  ```
- **`DRAFT_IMMUTABLE_KEY`** — immutable data, written once on init after fresh fetch:
  ```js
  // Written once in initSaveForm after fetching fresh data
  { url, pageContent, allTags, limits }
  ```
- **`saveDraft()`** — writes only `DRAFT_KEY` (mutable form fields), same as today:
  ```js
  function saveDraft() {
    chrome.storage.local.set({
      [DRAFT_KEY]: {
        url: urlInput.value,
        title: titleInput.value,
        description: descriptionInput.value,
        tags: [...selectedTags],
      }
    });
  }
  ```
- **`clearDraft()`** — removes both keys:
  ```js
  function clearDraft() {
    chrome.storage.local.remove([DRAFT_KEY, DRAFT_IMMUTABLE_KEY]);
  }
  ```

**Modify `initSaveForm(tab)`:**

1. Load both `DRAFT_KEY` and `DRAFT_IMMUTABLE_KEY` from `chrome.storage.local` alongside `defaultTags`/`lastUsedTags`
2. Use `tab.url` for the draft match check (available immediately, no scraping needed). Check if both draft and immutable cache exist, both have `url === tab.url`, immutable cache has `allTags`, and `isValidLimits(immutableCache.limits)` passes
3. **If draft matches current URL with valid cached data** → skip `getPageData`, `GET_TAGS`, and `GET_LIMITS` entirely. Restore form fields from `DRAFT_KEY`, and `pageContent`, `allTags`, `limits` from `DRAFT_IMMUTABLE_KEY`. Set `urlInput.value = tab.url`.
4. **If no matching draft** → set `urlInput.value = tab.url`, fire `getPageData`, `GET_LIMITS`, and `GET_TAGS` in parallel
   - Validate the limits response using `isValidLimits()`. If invalid, treat as a failed fetch.
   - If fresh limits fetch succeeds and is valid → use fresh limits
   - If status is 401 → call `showSaveStatus('Invalid token.', 'error', { text: 'Update in settings', onClick: () => chrome.runtime.openOptionsPage() })`, hide loading indicator, keep `saveForm` hidden, return early
   - Else (network error, other failures) → call `showSaveStatus("Can't load account limits", 'error')`, hide loading indicator, keep `saveForm` hidden, return early
5. Call `applyLimits()` with the resolved limits object
6. Populate form fields — truncate scraped page title/description to the dynamic limits (instead of hardcoded constants)
7. Only write `DRAFT_IMMUTABLE_KEY` if both limits and tags were fetched successfully — write `{ url: tab.url, pageContent, allTags, limits }`. If tags failed (but limits succeeded), the form still works (no tag chips, user can type tags manually), but don't cache the immutable data so next reopen will retry both. Call `saveDraft()` once for the mutable form fields — this ensures the draft is populated even if the user never interacts with the form
8. Wire up `input` event listeners on title and description to call `updateLimitFeedback` (in addition to existing `saveDraft` call)
9. After populating fields, call `updateLimitFeedback` for each field to show feedback if pre-populated values are at the limit

**Add `isValidLimits(obj)` helper** — validates that the three required fields (`max_title_length`, `max_description_length`, `max_bookmark_content_length`) exist and are positive numbers. Used for both fresh API responses and cached limits on read:
```js
function isValidLimits(obj) {
  return obj
    && typeof obj.max_title_length === 'number' && obj.max_title_length > 0
    && typeof obj.max_description_length === 'number' && obj.max_description_length > 0
    && typeof obj.max_bookmark_content_length === 'number' && obj.max_bookmark_content_length > 0;
}
```

**Modify `handleSave()`:**
- Add a guard at the top: `if (!limits) { showSaveStatus("Can't load account limits", 'error'); return; }` — this should never trigger (the form is hidden when limits fail), but provides user feedback if the invariant breaks
- Replace `substring(0, MAX_TITLE_LENGTH)` and `substring(0, MAX_DESCRIPTION_LENGTH)` with `substring(0, limits.max_title_length)` and `substring(0, limits.max_description_length)`
- `clearDraft()` already runs on successful save — this clears the cached tags/limits too, so the next popup open fetches fresh data

### Testing Strategy

This is a Chrome extension with no automated test infrastructure — all testing is manual.

**Core limit behavior:**

1. **Fresh open (no draft):** Open extension on any page → loading indicator shows, limits and tags are fetched, form renders with correct `maxLength` attributes on title (100 for FREE tier) and description (1000)
2. **Long page title:** Open extension on a page with a title >100 chars → title should be truncated to 100 chars, "Character limit reached (100)" feedback should appear
3. **Paste into title:** Paste a long string into the title field → browser `maxLength` truncates it, feedback appears
4. **Type to exact limit:** Type in title until exactly at limit → feedback appears; delete one char → feedback disappears
5. **Content scraping:** Open extension on a page with lots of text → content is scraped (up to 200k cap) and truncated to `max_bookmark_content_length` when limits are applied
6. **Dark mode:** Verify "Character limit reached" text uses the lighter red color (`#fca5a5`) in dark mode

**Draft caching (tags + limits skip API calls on same URL):**

7. **Same-URL reopen skips API calls:** Open popup on a page, edit the title, close popup, reopen on same page → form restores draft values, no `GET_TAGS` or `GET_LIMITS` network requests fired (verify in DevTools Network tab or background script console)
8. **Cached tags are used:** Open popup, note the tag chips, close popup, reopen on same page → same tag chips appear without a `GET_TAGS` call
9. **Cached limits are used:** Open popup, inspect `maxLength` on title input (should be 100), close popup, reopen on same page → `maxLength` is still 100, no `GET_LIMITS` call
10. **Different URL overwrites cache:**
    1. Open popup on Page A, edit the title to something custom (e.g. "My Custom Title"), close popup
    2. Navigate to Page B, open popup
    3. Verify `GET_TAGS` and `GET_LIMITS` network calls are fired (check DevTools Network tab or background script console)
    4. Verify form shows Page B's scraped title and URL — not Page A's custom title
    5. Close popup without interacting, reopen on Page B → form shows Page B's data (draft was saved during form population)
    6. Navigate back to Page A, open popup → fresh `GET_TAGS` and `GET_LIMITS` calls are fired again (Page A's old draft was overwritten by Page B's)
11. **Save clears cache:** Open popup, save bookmark successfully, close popup, reopen on same page → fresh `GET_TAGS` and `GET_LIMITS` calls are made (draft was cleared on save)
12. **Copy-paste workflow:** Open popup on a page, close it, copy some text from the page, reopen popup, paste into description → form restores instantly from draft (no loading delay), tags and limits are cached

**Error / fallback scenarios:**

13. **Network failure, no draft:** Clear extension storage, disconnect network, open popup → error message "Can't load account limits" shown, form not rendered
14. **Network failure, has draft for same URL:** Open popup on a page (caches draft), disconnect network, close and reopen popup on same page → form renders from cached draft with correct limits and tags
15. **Network failure, draft for different URL:** Open popup on Page A (caches draft), disconnect network, navigate to Page B, open popup → draft URL doesn't match, fresh fetch attempted, fails, error message shown
16. **401 on GET_LIMITS:** Set an invalid token in extension settings, clear storage, open popup → shows "Invalid token." with "Update in settings" link (not generic "Can't load account limits")

**Save behavior:**

17. **Save with dynamic limits:** Save a bookmark with title/description at their limits → succeeds (server accepts the data)
18. **Truncation in handleSave:** Verify `handleSave` uses `limits.max_title_length` / `limits.max_description_length` for its `substring` calls (not hardcoded values)
19. **Save preserves page content from cache:** Open popup on a page, close it, reopen on same page (draft hit), save → inspect the network request body and verify `content` is non-empty (pageContent was restored from draft, not lost)

**Limits response validation:**

20. **GET_TAGS failure not cached:** If GET_TAGS fails but GET_LIMITS succeeds, form renders without tag chips. Close and reopen on same page → GET_TAGS is retried (not cached as empty), tag chips appear if retry succeeds
21. **Malformed limits response:** If `GET_LIMITS` returns data missing required fields (e.g. no `max_title_length`), treat as a failed fetch — show error if no draft cache, use draft cache if available

---

## Milestone 2: Test Infrastructure & Automated Tests

### Goal & Outcome

Add vitest + jsdom test infrastructure for the Chrome extension and write automated tests covering the critical logic introduced in Milestone 1. After this milestone:

- `chrome-extension/` has its own `package.json` with vitest + jsdom as dev dependencies
- Logic is split into side-effect-free core modules (`popup-core.js`, `background-core.js`) that tests import directly, with thin entry points (`popup.js`, `background.js`) that handle DOM wiring and initialization
- Tests cover pure helpers, limit validation, draft caching logic, `initSaveForm` flows, and `handleSave` behavior
- Tests run via `npm test` from the `chrome-extension/` directory

### Implementation Outline

#### 1. Split into core modules + entry points

ESM `import()` executes all top-level code in the imported module. Since `popup.js` has top-level DOM lookups (`document.getElementById`), event listener registrations, and an `init()` call, importing it in tests would trigger side effects requiring full DOM and Chrome API setup just to survive the import. The clean solution: separate pure/testable logic from side effects.

**`chrome-extension/popup-core.js`** (new file) — All functions, constants, and state. No top-level DOM lookups, no `init()` call, no event listener registration. Exports everything tests need:

```js
export {
  SCRAPE_CAP, DRAFT_KEY, DRAFT_IMMUTABLE_KEY, INITIAL_CHIPS_COUNT,
  isRestrictedPage, isValidLimits, characterLimitMessage,
  updateLimitFeedback, applyLimits,
  saveDraft, clearDraft, getPageData,
  initSaveForm, handleSave, renderTagChips,
  showView, showSaveStatus, handleSaveError,
};
```

Functions that currently reference module-level DOM element variables (e.g. `titleInput`, `descriptionInput`, `saveForm`, `loadingIndicator`) need those references passed in or initialized via an explicit setup call. Two approaches:

**Option A — `init` function receives DOM refs:** Add a `setupDOM(elements)` function that stores DOM references in module-level variables. The entry point calls it once; tests call it with mock/real elements from jsdom.

```js
// popup-core.js
let titleInput, descriptionInput, urlInput, ...;

export function setupDOM(elements) {
  titleInput = elements.titleInput;
  descriptionInput = elements.descriptionInput;
  // ...etc
}
```

**Option B — Lazy lookup:** Replace direct references with getter functions that call `document.getElementById` on first access. Less explicit but requires no parameter passing.

**Recommendation:** Option A — explicit dependency passing is clearer and more testable. The entry point does the DOM lookups and passes them in; tests create elements directly or use `document.body.innerHTML` and call `setupDOM()`.

**`chrome-extension/popup.js`** (entry point) — Thin wrapper. Imports from `popup-core.js`, does DOM lookups, calls `setupDOM()`, wires event listeners, calls `init()`:

```js
import { setupDOM, initSaveForm, ... } from './popup-core.js';

const elements = {
  titleInput: document.getElementById('title'),
  descriptionInput: document.getElementById('description'),
  // ...all DOM refs
};
setupDOM(elements);

// Wire settings links, init logic, etc.
async function init() { ... }
init().catch(...);
```

**`popup.html`** — Change the script tag:
```html
<script type="module" src="popup.js"></script>
```

**`chrome-extension/background-core.js`** (new file) — Exports handler functions (`handleGetLimits`, `handleGetTags`, `handleCreateBookmark`, `handleSearchBookmarks`) and helpers (`fetchWithTimeout`, `getToken`). No `chrome.runtime.onMessage` listener registration.

**`chrome-extension/background.js`** (entry point) — Imports handlers from `background-core.js`, registers the `onMessage` listener.

**`manifest.json`** — Add `"type": "module"` to the background service worker:
```json
"background": {
  "service_worker": "background.js",
  "type": "module"
}
```

#### 2. Add test infrastructure

**`chrome-extension/package.json`:**
```json
{
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "jsdom": "^27.0.1"
  }
}
```

**`chrome-extension/vitest.config.js`:**
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.js',
  },
});
```

**`chrome-extension/test/setup.js`** — Global Chrome API mock:

Sets up `globalThis.chrome` with mock implementations of the APIs used by the extension:
- `chrome.storage.local.get` / `set` / `remove` — backed by an in-memory object, returns Promises
- `chrome.runtime.sendMessage` — vi.fn() (configured per-test)
- `chrome.runtime.openOptionsPage` — vi.fn()
- `chrome.tabs.query` — vi.fn()
- `chrome.scripting.executeScript` — vi.fn()

Provide a helper function `setupPopupDOM()` that populates `document.body.innerHTML` with the popup HTML structure and calls `setupDOM()` from `popup-core.js` with the resulting elements.

A `resetChromeStorage()` helper clears the in-memory storage between tests.

#### 3. Test files

**`chrome-extension/test/popup-core.test.js`** — Tests for popup-core.js logic:

**Pure function tests:**
- `isValidLimits`: valid object, missing fields, zero values, negative values, non-number types, null/undefined input
- `characterLimitMessage`: formats number with locale separators (e.g. `1,000`)
- `isRestrictedPage`: chrome://, about:, data:, normal URLs, null/undefined

**`updateLimitFeedback` tests:**
- Shows feedback when input length >= maxLength
- Hides feedback when input length < maxLength
- Correct message text in feedback element

**`applyLimits` tests:**
- Sets `maxLength` on title and description inputs
- Truncates `pageContent` when it exceeds `max_bookmark_content_length`
- Does not truncate when content is under the limit

**`initSaveForm` — fresh fetch (no cache) tests:**
- Fetches limits, tags, and page data in parallel; populates form fields; shows form
- Truncates scraped title/description to server limits
- Writes immutable cache when both limits and tags succeed
- Does NOT write immutable cache when tags fail (but form still renders)
- Calls `saveDraft()` to persist mutable form fields
- Shows limit feedback if pre-populated values are at the limit
- URL comes from `tab.url`, not from content script

**`initSaveForm` — cache hit tests:**
- Restores form from draft + immutable cache when URL matches `tab.url`
- Skips `GET_TAGS`, `GET_LIMITS`, and `getPageData` when cache is valid
- Applies cached limits (sets `maxLength` on inputs)

**`initSaveForm` — cache miss tests:**
- Fetches fresh data when draft URL doesn't match `tab.url`
- Fetches fresh data when immutable cache has invalid limits
- Fetches fresh data when immutable cache has non-array `allTags`

**`initSaveForm` — error handling tests:**
- Shows "Invalid token." with settings link on 401 from GET_LIMITS
- Shows "Can't load account limits" on network failure
- Shows "Can't load account limits" on malformed limits response
- Hides loading indicator and keeps form hidden on error

**`handleSave` tests:**
- Truncates title/description using `limits.max_title_length` / `limits.max_description_length`
- Truncates content using `limits.max_bookmark_content_length`
- Shows error if `limits` is null (guard)
- Calls `clearDraft()` (both keys) on successful save
- Sends correct bookmark payload via `CREATE_BOOKMARK` message

**`saveDraft` / `clearDraft` tests:**
- `saveDraft` writes `DRAFT_KEY` with url, title, description, tags
- `clearDraft` removes both `DRAFT_KEY` and `DRAFT_IMMUTABLE_KEY`

**`chrome-extension/test/background-core.test.js`** — Tests for background-core.js:

- `handleGetLimits`: calls correct endpoint, returns `{ success: true, data }` on 200, returns `{ success: false, status }` on non-200
- `handleGetTags`: same pattern
- `handleCreateBookmark`: sends correct payload, handles success/error responses
- All handlers throw on missing token

#### 4. Testing notes

Since `popup-core.js` has no top-level side effects, tests import it directly — no `vi.resetModules()` or dynamic imports needed for pure function tests.

For integration tests (`initSaveForm`, `handleSave`), call `setupPopupDOM()` in `beforeEach` to populate the DOM and initialize module-level element references via `setupDOM()`. Mock `chrome.runtime.sendMessage` to return appropriate responses for `GET_LIMITS` and `GET_TAGS`, and mock `chrome.scripting.executeScript` to return page data. Each test scenario configures the mocks before calling the function under test.

For `background-core.js` tests, mock `globalThis.fetch` (or the imported `fetchWithTimeout`) and `chrome.storage.local.get` for token retrieval.

Add `chrome-extension/node_modules` to the root `.gitignore`.
