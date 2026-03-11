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
