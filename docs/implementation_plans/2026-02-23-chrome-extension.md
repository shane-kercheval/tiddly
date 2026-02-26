# Chrome Extension Implementation Plan

## Overview

Build a Chrome extension (Manifest V3) that lets users save the current page as a Tiddly bookmark. Uses Personal Access Tokens (PATs) for authentication — no OAuth/Auth0 SDK needed in the extension.

### Key Design Decisions

**PAT over OAuth:** Chrome extensions + OAuth is painful (callback URLs tied to extension IDs, no Auth0 SPA SDK support in extension contexts, token refresh plumbing). PATs are already supported by the API, work with `POST /bookmarks/`, and are trivially stored in `chrome.storage.local`. The security profile of a stored PAT is equivalent to a stored OAuth token.

**Two-click save flow:** Click the extension icon → popup shows pre-filled form (URL, title, description, default tags) → user clicks Save. This prevents accidental bookmarks from mis-clicks while keeping the interaction fast. The form pre-fills from the page's DOM so the user typically just clicks Save without editing.

**DOM metadata and content extraction:** The extension reads `document.title`, `<meta name="description">`, and `document.body.innerText` from the active tab via `chrome.scripting.executeScript` (on-demand, no persistent content script). This is faster than calling the server-side `fetch-metadata` endpoint, which also blocks PATs (Auth0-only). Content is saved for search purposes — it doesn't need to be clean (readability-style extraction is future work).

**Context-aware popup:** On normal pages, the popup shows a save form. On restricted/blank pages (`chrome://newtab`, `about:blank`, etc.), it shows a search interface with recent bookmarks. This makes the extension useful even when there's nothing to save.

**Background service worker for API calls:** All `fetch()` calls to the Tiddly API go through the Manifest V3 background service worker. With `host_permissions` declared in the manifest, the service worker bypasses CORS entirely — no backend CORS changes needed. See [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

**Duplicate detection via 409:** Rather than pre-checking if a URL exists, the extension attempts creation optimistically. If the API returns 409 (`ACTIVE_URL_EXISTS` or `ARCHIVED_URL_EXISTS`), the extension shows an "already saved" message. This is simpler and matches the API design.

### Relevant API Endpoints

- `POST /bookmarks/` — Create bookmark (accepts PATs via `get_current_user`)
  - Required: `url` (HttpUrl)
  - Optional: `title` (max 100 chars), `description` (max 1000 chars), `content` (max 100,000 chars), `tags` (array of strings, auto-lowercased)
  - Returns 201 on success
  - 409 with `error_code: "ACTIVE_URL_EXISTS"` on duplicate (no bookmark ID in response)
  - 409 with `error_code: "ARCHIVED_URL_EXISTS"` and `existing_bookmark_id` on archived duplicate
- `GET /bookmarks/` — List/search bookmarks (used in search mode)
  - `q` (string) — full-text search across title, description, url, content
  - `sort_by` (string) — `created_at`, `updated_at`, `relevance`, etc. Defaults to `relevance` when `q` provided, `created_at` otherwise
  - `sort_order` — `asc` or `desc`
  - `offset` / `limit` — pagination (limit max 100)
  - Response: `{ items: [...], total, offset, limit, has_more }`
  - Each item includes: `id`, `url`, `title`, `description`, `tags`, `created_at`, `content_preview` (first 500 chars)
- `GET /tags/` — List all tags with usage counts (PAT-compatible)
  - Response: `{ tags: [{ name, content_count, filter_count }] }` sorted by usage
  - Optional: `content_types=bookmark` to scope to bookmark tags only
- `GET /users/me` — Lightweight auth check (for "test connection" in settings)

### Documentation

Read these before implementing:

- Chrome Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- `chrome.scripting.executeScript`: https://developer.chrome.com/docs/extensions/reference/api/scripting#method-executeScript
- `chrome.storage.local`: https://developer.chrome.com/docs/extensions/reference/api/storage
- Manifest V3 service workers: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- Cross-origin network requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Declare permissions and host_permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions

---

## Milestone 1: Extension Scaffold & Settings Page

### Goal & Outcome

Create the Chrome extension project structure with Manifest V3, a settings/options page, and PAT storage. After this milestone:

- Extension can be loaded in Chrome via "Load unpacked"
- User can open a settings page, enter their PAT, and save it
- "Test Connection" button calls `GET /users/me` and shows success/failure
- Settings persist across browser restarts via `chrome.storage.local`

### Implementation Outline

Create a new `chrome-extension/` directory at the repo root.

**1. `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Tiddly Bookmarks",
  "version": "0.1.0",
  "description": "Save bookmarks to Tiddly with one click",
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": [
    "https://api.tiddly.me/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options.html",
  "background": {
    "service_worker": "background.js"
  }
}
```

Notes:
- `activeTab` — grants access to the current tab only when the user clicks the extension icon
- `scripting` — for `chrome.scripting.executeScript` to extract page metadata on demand
- `storage` — for `chrome.storage.local`
- `host_permissions` — required for the service worker to make cross-origin `fetch()` calls to the API. Hardcoded to `api.tiddly.me` only. Chrome will show a permission warning at install ("Can read and change your data on api.tiddly.me"). For local development, temporarily add `http://localhost:8000/*` to the manifest and change `API_URL` in `background.js`. If self-hosted URL support is needed later, switch to `optional_host_permissions` with `chrome.permissions.request()` at runtime.
- **MV3 Content Security Policy:** All JavaScript must be in separate `.js` files. No inline `<script>` tags or `onclick`/`onsubmit` attributes in HTML — MV3 enforces a strict CSP that silently blocks inline scripts.

**2. Options page (`options.html` + `options.js`)**

Simple HTML form — no framework needed:
- **Personal Access Token** — password input with show/hide toggle
- **Default Tags** — text input, comma-separated (e.g. `reading-list, chrome`). On save, parse by splitting on commas, trim whitespace, lowercase, and filter empty strings before storing as array.
- **Test Connection** button — calls `GET /users/me` via background service worker, shows green checkmark or red error inline
- **Save** button — writes to `chrome.storage.local`
- Help link: "Get a token at https://tiddly.me/app/settings/tokens"
- Client-side validation: PAT must start with `bm_` prefix (prevents confusing 401 from pasting wrong value)

No API URL field — hardcoded to `https://api.tiddly.me` in `background.js`. For local development, change the `API_URL` constant and add `http://localhost:8000/*` to `host_permissions` in the manifest temporarily.

Storage schema:
```js
{
  "token": "bm_...",
  "defaultTags": ["reading-list"]
}
```

Use `chrome.storage.local` (not `sync`) — no reason to send a PAT through Google's sync infrastructure.

**3. Background service worker (`background.js`)**

Route all API calls through message passing. The service worker's `fetch()` bypasses CORS because `host_permissions` grants access.

Key patterns:
- **`fetchWithTimeout`**: All fetch calls wrapped with an `AbortController` timeout (15s) to prevent indefinite hangs from unresponsive servers.
- **Token guard**: `getToken()` throws if no token is stored, returning a clear error immediately instead of sending `Authorization: Bearer undefined` and getting a confusing 401.
- **`async/await`**: Handlers use async/await (cleaner than `.then()` chains). The message listener dispatches to async handler functions and calls `sendResponse` on resolution/rejection.
- **Native MV3 promises in popup**: In MV3, `chrome.runtime.sendMessage` returns a native Promise when no callback is passed. The popup uses `await chrome.runtime.sendMessage(...)` directly — no callback wrappers needed. Errors come as rejections (caught by try/catch) rather than `chrome.runtime.lastError`. This eliminates hang risk from unresponsive service workers and keeps the code consistently async/await.
- **`handleTestConnection`** uses `message.token` (not storage) because the user hasn't saved yet — this is intentional.
- **Status timer race prevention**: `showStatus()` in options.js tracks and clears the previous `setTimeout` ID before scheduling a new one, preventing a prior success timer from hiding a later error message.

```js
const API_URL = 'https://api.tiddly.me';
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  }
}

async function getToken() {
  const { token } = await chrome.storage.local.get(['token']);
  if (!token) throw new Error('Not configured — open extension settings');
  return token;
}
```

**4. Icons** — Simple placeholder PNGs (16x16, 48x48, 128x128). Can be polished later.

**5. `chrome-extension/README.md`** — Setup instructions: how to load unpacked, how to create a PAT in Tiddly, how to configure.

### Testing Strategy

Manual testing (extension is a thin client — API-side logic is already tested in the backend):

- Load unpacked in Chrome → no console errors, no permission warnings beyond expected host_permissions
- Open options, enter valid PAT, click Test Connection → green success with email shown
- Enter invalid PAT, click Test Connection → red error showing 401
- Save settings, close browser, reopen options → settings persist
- Enter empty PAT, try to save → validation prevents it
- Enter PAT without `bm_` prefix → validation error ("Token should start with bm_")
- Trigger Save validation error, then click Test Connection → prior error clears before test runs

---

## Milestone 2: Popup UI & Save Flow

### Goal & Outcome

Implement the main popup with a two-click save flow. After this milestone:

- Clicking the extension icon on a normal page shows a pre-filled form (URL, title, description, tags)
- Tags pre-filled from default tags (settings) merged with last-used tags; existing tags shown as selectable chips
- Page content (`document.body.innerText`) is captured and saved for search (truncated to 100k chars)
- User clicks Save to create the bookmark
- Restricted pages (`chrome://`, `about://`, `data:`, `blob:`, etc.) show search UI (Milestone 3)
- Error states handled: 401, 409, 429, 451, network errors
- `X-Request-Source: chrome-extension` header sent for audit trail

### Implementation Outline

**1. Restricted page detection**

Check the tab URL before attempting metadata extraction. `chrome.scripting.executeScript` throws on privileged pages — handle this upfront, not as a Milestone 3 edge case:

```js
function isRestrictedPage(url) {
  return !url || /^(chrome|about|chrome-extension|devtools|edge|data|blob|view-source):/.test(url);
}
```

Note: `file://` is intentionally excluded — users can save local files as bookmarks (`executeScript` may fail, but the try/catch fallback handles that). `data:` and `blob:` are included because they represent ephemeral content that isn't meaningful to bookmark.

If restricted, show search UI (Milestone 3). No script injection, no save button.

**2. Page metadata and content extraction**

Use `chrome.scripting.executeScript` from the popup — no persistent content script. Wrap in try/catch because `executeScript` can fail on pages that pass the restricted-page check but still block script injection (Chrome PDF viewer, Web Store pages, pages with restrictive CSP, etc.). On failure, fall back to URL-only save:

```js
const MAX_CONTENT_LENGTH = 100000;

async function getPageData(tab) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (maxLen) => ({
        url: window.location.href,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content
          || document.querySelector('meta[property="og:description"]')?.content
          || '',
        content: document.body.innerText.substring(0, maxLen)
      }),
      args: [MAX_CONTENT_LENGTH]
    });
    return result.result;
  } catch {
    // executeScript failed — fall back to URL-only data from the tab API
    return { url: tab.url, title: tab.title || '', description: '', content: '' };
  }
}
```

- `og:description` as fallback — many sites use Open Graph instead of standard meta description
- `document.body.innerText` captures visible page text for search purposes. Not clean (includes nav, footers, etc.) but sufficient for full-text search. Readability-style extraction is future work.
- Content is truncated to 100k chars (FREE tier limit) client-side to avoid 400 errors
- `document.body.innerText` can trigger layout reflow on heavy pages, taking 100ms+. The popup should render immediately with a loading/skeleton state and populate fields when extraction completes — don't block the UI on script injection.

**3. Popup states (`popup.html` + `popup.js`)**

Three states (save mode for normal pages, search mode added in Milestone 3):

**Not configured** — no PAT stored:
- "Set up your connection" message + button to open options page

**Save form** — default when configured (on non-restricted pages):
- On popup open: extract metadata + content AND fetch tags in parallel
- Pre-fill form with URL (read-only), title, description
- **Security:** Set form values via `element.value = title` and text via `element.textContent`, never `innerHTML` or string concatenation into HTML. Page metadata comes from arbitrary untrusted pages — a malicious page title could contain HTML/JS that executes in the extension context (which has access to `chrome.storage.local`, i.e., the PAT). MV3's CSP blocks inline `<script>` tags but does NOT block injected DOM event handlers in all contexts.
- Tags pre-filled from merge of default tags (settings) + last-used tags (storage)
- Content is captured silently (not shown in the form — it's just for search)
- `init()` awaits `initSaveForm(tab)` so failures surface to the top-level `.catch()` error handler (prevents blank popup on unexpected errors)
- **Defensive response handling:** API responses are guarded against unexpected shapes. Tags response validated with `Array.isArray(tagsResult.data?.tags)` before mapping. Search results use `response.data?.items ?? []` and `response.data?.has_more ?? false`. Save response uses `response?.success` (optional chaining) to guard against `undefined` response from MV3 service worker restarts.
- User optionally edits visible fields, then clicks Save
- On success: show "Saved!" confirmation, store used tags as `lastUsedTags` in `chrome.storage.local`
- On 409: show duplicate message (see error handling below)

Popup should be compact (~350px wide).

**Tag selection UI:**

On popup open, fetch existing tags via `GET /tags/?content_types=bookmark` (through background service worker). Display as selectable chips below the tags text input:

- **Default view:** Show top ~8 tags by `content_count` (most used first). This keeps the popup compact.
- **"Show all" link:** Expands to a scrollable area (max-height ~150px) showing all tags.
- **Filter as you type:** Typing in the text input filters the visible chips to matches. Start typing "read" → chips narrow to `reading-list`, `read-later`, etc.
- **Click to toggle:** Clicking a chip adds it to (or removes it from) the selected tags.
- **Accessibility:** Tag chips and "Show all" are rendered as `<button type="button">` elements (not `<span>`) for keyboard focusability, Enter/Space activation, and screen reader semantics. CSS resets default button styles to maintain the chip appearance.
- **New tags via Enter:** Typing a tag name and pressing Enter commits it as a selected tag (added to `selectedTags`, input cleared). Leftover filter text in the input is ignored on save — only explicitly selected/committed tags are submitted. This prevents accidental garbage tags from partial filter text.
- **Pre-selected chips:** Default tags from settings + last-used tags from `chrome.storage.local` are pre-selected on open.
- **Tag fetch failure:** If the tags API call fails, the chip UI is hidden and the text input still works for adding new tags via Enter (graceful degradation).

```js
// Storage for last-used tags
// On successful save:
chrome.storage.local.set({ lastUsedTags: bookmark.tags });

// On popup open, merge defaults + last used:
const { defaultTags = [], lastUsedTags = [] } = await chrome.storage.local.get(['defaultTags', 'lastUsedTags']);
const preSelectedTags = [...new Set([...defaultTags, ...lastUsedTags])];
```

**4. API call via background service worker**

Add `CREATE_BOOKMARK` handler in `background.js`:

```js
async function handleCreateBookmark(message) {
  const token = await getToken();
  const res = await fetchWithTimeout(`${API_URL}/bookmarks/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-Source': 'chrome-extension'
    },
    body: JSON.stringify(message.bookmark)
  });
  if (res.ok) return { success: true, bookmark: await res.json() };
  const body = await res.json().catch(() => null);
  const retryAfter = res.headers.get('Retry-After');
  return { success: false, status: res.status, body, retryAfter };
}
```

**5. Fetch tags via background service worker**

Add `GET_TAGS` handler in `background.js`:

```js
async function handleGetTags() {
  const token = await getToken();
  const res = await fetchWithTimeout(`${API_URL}/tags/?content_types=bookmark`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Request-Source': 'chrome-extension'
    }
  });
  if (res.ok) return { success: true, data: await res.json() };
  return { success: false, status: res.status };
}
```

**6. Error handling in popup**

| Status | UI behavior |
|--------|------------|
| 201 | "Saved!" confirmation |
| 400 | Show API error message (e.g. "URL exceeds limit of 2048 characters"). No client-side URL truncation — a truncated URL is a broken URL. This catch-all covers any current or future field validation. |
| 401 | "Invalid token" + link to open options page |
| 402 | Show API error message (e.g. "Bookmark limit reached"). The response includes `detail` with the message and `limit` with the current cap. Link to Tiddly web app to manage/delete bookmarks or upgrade. |
| 409 `ACTIVE_URL_EXISTS` | "Already saved" (no bookmark ID in response, message only) |
| 409 `ARCHIVED_URL_EXISTS` | "This bookmark is archived" + link to `https://tiddly.me/app/bookmarks/{existing_bookmark_id}` |
| 429 | "Rate limited — try again in Xs" (use `retryAfter` from response) |
| 451 | "Accept terms first" + link to Tiddly web app |
| Network error | "Can't reach server — check your connection" |

**7. Truncate long fields before sending** — title to 100 chars, description to 1000 chars. Prevents 400 errors for known fixed limits. URL is NOT truncated (a truncated URL is broken) — the 400 handler above covers URL length validation from the API.

### Testing Strategy

- Click extension on normal webpage → form shows pre-filled URL, title, description, default tags
- Click Save → bookmark created with content, "Saved!" shown
- Verify saved bookmark in web UI has content (page text captured)
- Click on page with no meta description → form shows with empty description, saves fine
- Save an already-bookmarked URL → shows "Already saved" (409 ACTIVE_URL_EXISTS)
- Save an archived URL → shows "This bookmark is archived" with link to it in Tiddly
- Click with expired/invalid PAT → auth error with link to settings
- Click when API unreachable → network error message
- Edit title and tags in form before saving → bookmark has modified values
- Check content history in web UI → `X-Request-Source: chrome-extension` appears
- Click on `chrome://` or `about:` page → search view shown (Milestone 3)
- Click on `file://` page → save form shown, falls back to URL-only if `executeScript` fails
- Click on `data:` or `blob:` URL → search view shown (restricted)
- Click on `view-source:` page → search view shown (restricted)
- Click on Chrome Web Store page → `executeScript` fails, falls back to URL + tab title
- Save when at bookmark limit → shows quota error with actionable message (402)
- Save a page with extremely long URL → shows field limit error from API (400)
- Save a page with HTML/script in its `<title>` → title displayed as plain text, no script execution
- Title > 100 chars from page → truncated in form, saves successfully
- Save, close popup, reopen on same URL, save again → 409 "Already saved"
- Open extension on a heavy page → popup appears immediately with loading state, fields populate shortly after
- Tag chips appear below input showing most-used tags (top ~8)
- Click a tag chip → tag added to selected tags; click again → removed
- Type "read" in tags input → chips filter to matching tags (e.g. `reading-list`)
- Type a new tag not in chip list, press Enter → committed as selected tag, created on save
- Type partial filter text, click Save without pressing Enter → filter text ignored (not submitted as tag)
- Click "Show all" → scrollable area with all tags
- Save a bookmark with tags `foo, bar` → reopen on new page → `foo` and `bar` pre-selected (last-used tags)
- Default tags from settings are always pre-selected
- Tags API fails → chip UI hidden, text input still works

---

## Milestone 3: Search UI on Restricted/Blank Pages

### Goal & Outcome

When the extension is opened on a restricted or blank page (where saving doesn't apply), show a search interface instead. After this milestone:

- On `chrome://newtab`, `about:blank`, and other restricted pages: popup shows a search bar and recent bookmarks
- User can search bookmarks by text query (searches title, description, URL, content)
- Results are paginated (load more on scroll or button)
- Clicking a result opens the bookmark URL in a new tab
- Recent bookmarks (sorted by `created_at` desc) shown by default before any search

### Implementation Outline

**1. Update popup state logic**

The popup now has three modes based on context:

- **Not configured** — no PAT stored → setup prompt (unchanged)
- **Save mode** — on normal pages → save form (unchanged from Milestone 2)
- **Search mode** — on restricted/blank pages → search UI (new)

Detection (same function from M2):
```js
function isRestrictedPage(url) {
  return !url || /^(chrome|about|chrome-extension|devtools|edge|data|blob|view-source):/.test(url);
}
```

This catches `chrome://newtab`, `about:blank`, `chrome://extensions`, `data:` URIs, `blob:` URIs, `view-source:` pages, etc. `file://` is intentionally NOT restricted — users can save local files (the save form handles `executeScript` failures gracefully). Note that `executeScript` can also fail on non-restricted pages (Chrome PDF viewer, Web Store, etc.) — the try/catch fallback in M2 handles those.

**2. Search UI**

- **Search input** — text field at the top, searches after a 300ms debounce (no explicit Enter needed — results update as you type)
- **Results list** — each result shows: title (linked), URL (truncated), tags, and created date
- **Default view** (no search query) — most recent 10 bookmarks, sorted by `created_at` desc
- **Pagination** — "Load more" button at the bottom when `has_more` is true. Increment `offset` by `limit` (10) on each click.
- **Empty state** — "No bookmarks yet" when results are empty with no search query; "No results" when search query has no matches
- Clicking a result title opens the URL in a new tab via `chrome.tabs.create({ url })`

**3. Background service worker**

Add `SEARCH_BOOKMARKS` message handler:

```js
async function handleSearchBookmarks(message) {
  const token = await getToken();
  const params = new URLSearchParams({
    limit: String(message.limit || 10),
    offset: String(message.offset || 0),
    sort_order: 'desc'
  });
  if (message.query) {
    params.set('q', message.query);
    // sort_by defaults to 'relevance' when q is set
  } else {
    params.set('sort_by', 'created_at');
  }
  const res = await fetchWithTimeout(`${API_URL}/bookmarks/?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Request-Source': 'chrome-extension'
    }
  });
  if (res.ok) return { success: true, data: await res.json() };
  return { success: false, status: res.status };
}
```

**4. Popup sizing**

The search results list needs more vertical space than the save form. Set the popup to a taller min-height in search mode (~400px) while keeping save mode compact (~350px). CSS uses `.popup:has(#search-view:not([hidden]))` to conditionally apply this.

**5. Robustness**

- **Stale response handling**: A monotonic `searchRequestId` counter ensures that debounced search responses arriving out of order are discarded.
- **Load More recovery**: On append errors, restore the Load More button visibility so the user can retry.
- **`await initSearchView()`**: The `init()` function awaits `initSearchView()` so failures surface to the top-level `.catch()` error handler.

### Testing Strategy

- Open extension on `chrome://newtab` → search UI shown (not save form)
- Open on `about:blank` → search UI shown
- Open on `chrome://extensions` → search UI shown
- Open on normal webpage → save form shown (not search)
- Search UI loads with recent bookmarks by default (sorted newest first)
- Type a search query → results update after debounce
- Search for a term that exists in bookmark content but not title → still found (full-text search)
- Search with no results → "No results" message
- Click "Load more" → next page of results appended
- Click a result → opens URL in new tab
- Search with expired PAT → auth error with link to settings
- Search when API unreachable → network error message
- User with no bookmarks → "No bookmarks yet" message

---

## Milestone 4: Polish & Documentation

### Goal & Outcome

Edge cases, styling, and documentation. After this milestone:

- Extension handles all edge cases gracefully
- `frontend/public/llms.txt` updated with Chrome extension section
- `chrome-extension/README.md` has complete setup and testing guide
- Extension is ready for local use

### Implementation Outline

**1. Edge cases**

- **PDF / non-HTML pages**: Metadata extraction may fail or return empty values. Fall back to saving with URL only (no content).
- **Popup closes mid-save**: The background service worker completes the fetch regardless. The bookmark still saves — the user just won't see confirmation. This is acceptable.

**2. Visual styling**

Style popup and options page with clean CSS. Keep it simple — dark/light based on `prefers-color-scheme`, clean typography, consistent with Tiddly's feel. Both save mode and search mode should feel cohesive.

**3. Update `frontend/public/llms.txt`**

Add a brief section about the Chrome extension: what it does, PAT-based auth, save with content capture, search on new tab, configurable default tags.

**4. Complete `chrome-extension/README.md`**

- What the extension does (save + search)
- How to install (load unpacked)
- How to set up (create PAT, configure extension)
- Development workflow
- Full manual testing checklist (consolidated from all milestones)

### Testing Strategy

Full manual test pass covering all items from milestones 1–3, plus:

- Extension on a local PDF file → saves with URL, handles missing title/content gracefully
- Close popup mid-save, check web UI → bookmark was still created (expect `"Attempting to use a disconnected port object"` console warning — this is benign)
- Options page help link → opens correct Tiddly tokens page
- Light mode and dark mode both look correct
- Save a bookmark with content, then search for a term only in the content → found via search UI

---

## Summary

| Milestone | Component | Scope |
|-----------|-----------|-------|
| 1 | Extension scaffold + settings | Manifest with host_permissions, options page, PAT storage, test connection |
| 2 | Popup UI + save flow | Restricted page detection, metadata + content extraction, pre-filled form, tag selection with chips, error handling |
| 3 | Search UI | Search bar + recent bookmarks on restricted/blank pages, pagination, open in new tab |
| 4 | Polish + documentation | Edge cases (PDF, mid-save close), styling, llms.txt, README |

### Not In Scope (future work)

- Chrome Web Store publishing (requires developer account, review process, stable extension ID)
- Configurable API URL / self-hosted support (hardcoded to tiddly.me for v1)
- Readability-style content extraction (cleaner than raw `innerText`)
- OAuth/Auth0 flow in the extension
- Keyboard shortcut for opening the popup
- Badge/icon showing duplicate status on tab switch
- Context menus (right-click to save)
- Firefox/Safari ports
- PAT scoping (write-only tokens)
