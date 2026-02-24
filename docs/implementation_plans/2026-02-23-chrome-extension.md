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
    "https://tiddly.me/*",
    "http://localhost:8000/*"
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
- `host_permissions` — required for the service worker to make cross-origin `fetch()` calls to the API. Hardcoded to `tiddly.me` (production) and `localhost:8000` (development). Chrome will show a permission warning at install ("Can read and change your data on tiddly.me"). If self-hosted URL support is needed later, switch to `optional_host_permissions` with `chrome.permissions.request()` at runtime.

**2. Options page (`options.html` + `options.js`)**

Simple HTML form — no framework needed:
- **Personal Access Token** — password input with show/hide toggle
- **Default Tags** — text input, comma-separated (e.g. `reading_list, chrome`)
- **Test Connection** button — calls `GET /users/me` via background service worker, shows green checkmark or red error inline
- **Save** button — writes to `chrome.storage.local`
- Help link: "Get a token at https://tiddly.me/app/settings/tokens"
- Client-side validation: PAT must start with `bm_` prefix (prevents confusing 401 from pasting wrong value)

No API URL field — hardcoded to `https://tiddly.me` (production) with `http://localhost:8000` as a dev fallback. If self-hosted support is needed later, add the field then.

Storage schema:
```js
{
  "token": "bm_...",
  "defaultTags": ["reading_list"]
}
```

Use `chrome.storage.local` (not `sync`) — no reason to send a PAT through Google's sync infrastructure.

**3. Background service worker (`background.js`)**

Route all API calls through message passing. The service worker's `fetch()` bypasses CORS because `host_permissions` grants access:

```js
const API_URL = 'https://tiddly.me';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_CONNECTION') {
    fetch(`${API_URL}/users/me`, {
      headers: { 'Authorization': `Bearer ${message.token}` }
    })
      .then(res => {
        if (res.ok) return res.json().then(data => ({ success: true, email: data.email }));
        return { success: false, status: res.status };
      })
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});
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

---

## Milestone 2: Popup UI & Save Flow

### Goal & Outcome

Implement the main popup with a two-click save flow. After this milestone:

- Clicking the extension icon on a normal page shows a pre-filled form (URL, title, description, default tags)
- Page content (`document.body.innerText`) is captured and saved for search (truncated to 100k chars)
- User clicks Save to create the bookmark
- Restricted pages (`chrome://`, `about://`, etc.) show a "Can't save this page" message (search UI comes in Milestone 3)
- Error states handled: 401, 409, 429, 451, network errors
- `X-Request-Source: chrome-extension` header sent for audit trail

### Implementation Outline

**1. Restricted page detection**

Check the tab URL before attempting metadata extraction. `chrome.scripting.executeScript` throws on privileged pages — handle this upfront, not as a Milestone 3 edge case:

```js
function isRestrictedPage(url) {
  return /^(chrome|about|chrome-extension|devtools|edge):/.test(url);
}
```

If restricted, show "Can't save this page" in the popup. No script injection, no save button. (Milestone 3 replaces this with a search UI on restricted/blank pages.)

**2. Page metadata and content extraction**

Use `chrome.scripting.executeScript` from the popup — no persistent content script:

```js
const MAX_CONTENT_LENGTH = 100000;

async function getPageData(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
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
}
```

- `og:description` as fallback — many sites use Open Graph instead of standard meta description
- `document.body.innerText` captures visible page text for search purposes. Not clean (includes nav, footers, etc.) but sufficient for full-text search. Readability-style extraction is future work.
- Content is truncated to 100k chars (FREE tier limit) client-side to avoid 400 errors

**3. Popup states (`popup.html` + `popup.js`)**

Two states:

**Not configured** — no PAT stored:
- "Set up your connection" message + button to open options page

**Save form** — default when configured (on non-restricted pages):
- On popup open: extract metadata + content, pre-fill form with URL (read-only), title, description, default tags
- Content is captured silently (not shown in the form — it's just for search)
- User optionally edits visible fields, then clicks Save
- On success: show "Saved!" confirmation
- On 409: show duplicate message (see error handling below)

Popup should be compact (~350px wide).

**4. API call via background service worker**

Add `CREATE_BOOKMARK` handler in `background.js`:

```js
if (message.type === 'CREATE_BOOKMARK') {
  chrome.storage.local.get(['token']).then(settings => {
    fetch(`${API_URL}/bookmarks/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
        'X-Request-Source': 'chrome-extension'
      },
      body: JSON.stringify(message.bookmark)
    })
      .then(async res => {
        if (res.ok) return { success: true, bookmark: await res.json() };
        const body = await res.json().catch(() => null);
        const retryAfter = res.headers.get('Retry-After');
        return { success: false, status: res.status, body, retryAfter };
      })
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
  });
  return true;
}
```

**5. Error handling in popup**

| Status | UI behavior |
|--------|------------|
| 201 | "Saved!" confirmation |
| 401 | "Invalid token" + link to open options page |
| 409 `ACTIVE_URL_EXISTS` | "Already saved" (no bookmark ID in response, message only) |
| 409 `ARCHIVED_URL_EXISTS` | "This bookmark is archived" + link to `https://tiddly.me/app/bookmarks/{existing_bookmark_id}` |
| 429 | "Rate limited — try again in Xs" (use `retryAfter` from response) |
| 451 | "Accept terms first" + link to Tiddly web app |
| Network error | "Can't reach server — check your connection" |

**6. Truncate long fields before sending** — title to 100 chars, description to 1000 chars. Prevents 400 errors from the API.

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
- Click on `chrome://` or `about:` page → "Can't save this page" (no form shown)
- Title > 100 chars from page → truncated in form, saves successfully
- Save, close popup, reopen on same URL, save again → 409 "Already saved"

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

Detection:
```js
function isRestrictedPage(url) {
  return !url || /^(chrome|about|chrome-extension|devtools|edge):/.test(url);
}
```

This catches `chrome://newtab`, `about:blank`, `chrome://extensions`, etc. — all pages where the extension can't save and where search is more useful.

**2. Search UI**

- **Search input** — text field at the top, searches on Enter or after a brief debounce (~300ms)
- **Results list** — each result shows: title (linked), URL (truncated), tags, and created date
- **Default view** (no search query) — most recent 10 bookmarks, sorted by `created_at` desc
- **Pagination** — "Load more" button at the bottom when `has_more` is true. Increment `offset` by `limit` (10) on each click.
- **Empty state** — "No bookmarks yet" when results are empty with no search query; "No results" when search query has no matches
- Clicking a result title opens the URL in a new tab via `chrome.tabs.create({ url })`

**3. Background service worker**

Add `SEARCH_BOOKMARKS` message handler:

```js
if (message.type === 'SEARCH_BOOKMARKS') {
  chrome.storage.local.get(['token']).then(settings => {
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
    fetch(`${API_URL}/bookmarks/?${params}`, {
      headers: {
        'Authorization': `Bearer ${settings.token}`,
        'X-Request-Source': 'chrome-extension'
      }
    })
      .then(async res => {
        if (res.ok) return { success: true, data: await res.json() };
        return { success: false, status: res.status };
      })
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
  });
  return true;
}
```

**4. Popup sizing**

The search results list needs more vertical space than the save form. Set the popup to a taller default in search mode (~500px) while keeping save mode compact (~350px). CSS can handle this based on which mode is active.

### Testing Strategy

- Open extension on `chrome://newtab` → search UI shown (not save form)
- Open on `about:blank` → search UI shown
- Open on `chrome://extensions` → search UI shown
- Open on normal webpage → save form shown (not search)
- Search UI loads with recent bookmarks by default (sorted newest first)
- Type a search query, press Enter → results update to matching bookmarks
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
- Close popup mid-save, check web UI → bookmark was still created
- Options page help link → opens correct Tiddly tokens page
- Light mode and dark mode both look correct
- Save a bookmark with content, then search for a term only in the content → found via search UI

---

## Summary

| Milestone | Component | Scope |
|-----------|-----------|-------|
| 1 | Extension scaffold + settings | Manifest with host_permissions, options page, PAT storage, test connection |
| 2 | Popup UI + save flow | Restricted page detection, metadata + content extraction, pre-filled form, error handling |
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
- Tag autocomplete from existing tags
- Firefox/Safari ports
- PAT scoping (write-only tokens)
