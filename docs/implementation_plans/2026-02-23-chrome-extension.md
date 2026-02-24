# Chrome Extension Implementation Plan

## Overview

Build a Chrome extension (Manifest V3) that lets users save the current page as a Tiddly bookmark with one click. Uses Personal Access Tokens (PATs) for authentication — no OAuth/Auth0 SDK needed in the extension.

### Key Design Decisions

**PAT over OAuth:** Chrome extensions + OAuth is painful (callback URLs tied to extension IDs, no Auth0 SPA SDK support in extension contexts, token refresh plumbing). PATs are already supported by the API, work with `POST /bookmarks/`, and are trivially stored in `chrome.storage.local`. The security profile of a stored PAT is equivalent to a stored OAuth token.

**One-click save as default mode:** Click the extension icon → bookmark is saved immediately with default tags → brief "Saved!" confirmation. Users can expand an edit form to modify title/tags/description before or after saving. This matches the "reading list" use case and is how Pocket/Raindrop work.

**DOM metadata extraction:** The extension reads `document.title` and `<meta name="description">` from the active tab via `chrome.scripting.executeScript` (on-demand, no persistent content script). This is faster than calling the server-side `fetch-metadata` endpoint, which also blocks PATs (Auth0-only).

**Background service worker for API calls:** All `fetch()` calls to the Tiddly API go through the Manifest V3 background service worker. This avoids CORS issues entirely (service worker requests aren't subject to CORS), so no backend CORS changes are needed.

**Duplicate detection via 409:** Rather than pre-checking if a URL exists, the extension attempts creation optimistically. If the API returns 409 (`ACTIVE_URL_EXISTS` or `ARCHIVED_URL_EXISTS`), the extension shows an "already saved" message. This is simpler and matches the API design.

### Relevant API Endpoints

- `POST /bookmarks/` — Create bookmark (accepts PATs via `get_current_user`)
  - Required: `url` (HttpUrl)
  - Optional: `title` (max 100 chars), `description` (max 1000 chars), `tags` (array of strings, auto-lowercased)
  - Returns 201 on success, 409 with `error_code: "ACTIVE_URL_EXISTS"` or `"ARCHIVED_URL_EXISTS"` on duplicate
- `GET /users/me` — Lightweight auth check (for "test connection" in settings)

### Documentation

Read these before implementing:

- Chrome Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- `chrome.scripting.executeScript`: https://developer.chrome.com/docs/extensions/reference/api/scripting#method-executeScript
- `chrome.storage.local`: https://developer.chrome.com/docs/extensions/reference/api/storage
- `chrome.commands`: https://developer.chrome.com/docs/extensions/reference/api/commands
- Manifest V3 service workers: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers

---

## Milestone 1: Extension Scaffold & Settings Page

### Goal & Outcome

Create the Chrome extension project structure with Manifest V3, a settings/options page, and PAT storage. After this milestone:

- Extension can be loaded in Chrome via "Load unpacked"
- User can open a settings page, enter their API URL and PAT, and save them
- "Test Connection" button calls `GET /users/me` and shows success/failure
- Settings persist across browser restarts via `chrome.storage.local`
- Keyboard shortcut declared in manifest (user-configurable via `chrome://extensions/shortcuts`)

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
  },
  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Alt+Shift+B" },
      "description": "Save current page as bookmark"
    }
  }
}
```

Notes:
- `activeTab` — grants access to the current tab only when the user clicks the extension icon (no broad host permissions)
- `scripting` — for `chrome.scripting.executeScript` to extract page metadata on demand
- `storage` — for `chrome.storage.local`
- No `host_permissions` needed — background service worker fetch requests aren't subject to CORS
- `_execute_action` — built-in command that triggers the popup; user can rebind via `chrome://extensions/shortcuts`

**2. Options page (`options.html` + `options.js`)**

Simple HTML form — no framework needed:
- **API URL** — text input, default `https://tiddly.me`
- **Personal Access Token** — password input with show/hide toggle
- **Default Tags** — text input, comma-separated (e.g. `reading_list, chrome`)
- **Test Connection** button — calls `GET /users/me` via background service worker, shows green checkmark or red error inline
- **Save** button — writes to `chrome.storage.local`
- Help link: "Get a token at [your-api-url]/app/settings/tokens"
- Client-side validation: PAT must start with `bm_` prefix (prevents confusing 401 from pasting wrong value)

Storage schema:
```js
{
  "apiUrl": "https://tiddly.me",
  "token": "bm_...",
  "defaultTags": ["reading_list"]
}
```

Use `chrome.storage.local` (not `sync`) — no reason to send a PAT through Google's sync infrastructure.

**3. Background service worker (`background.js`)**

Route all API calls through message passing so CORS is never an issue:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_CONNECTION') {
    fetch(`${message.apiUrl}/users/me`, {
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

- Load unpacked in Chrome → no console errors
- Open options, enter valid PAT + API URL, click Test Connection → green success with email shown
- Enter invalid PAT, click Test Connection → red error showing 401
- Enter unreachable URL, click Test Connection → network error message
- Save settings, close browser, reopen options → settings persist
- Enter empty PAT, try to save → validation prevents it
- Enter PAT without `bm_` prefix → validation error ("Token should start with bm_")
- Enter URL without `https://` → auto-prepend or show validation hint

---

## Milestone 2: Popup UI & One-Click Save

### Goal & Outcome

Implement the main popup with one-click save. After this milestone:

- Clicking the extension icon saves the current page immediately with default tags (one-click flow)
- Brief "Saved!" confirmation shown in popup
- User can expand an edit form to modify title, description, and tags
- Error states handled: 401, 409, 429, 451, network errors
- `X-Request-Source: chrome-extension` header sent for audit trail

### Implementation Outline

**1. Page metadata extraction**

Use `chrome.scripting.executeScript` from the popup — no persistent content script:

```js
async function getPageMetadata(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: window.location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content
        || document.querySelector('meta[property="og:description"]')?.content
        || ''
    })
  });
  return result.result;
}
```

Also grab `og:description` as fallback — many sites use Open Graph instead of standard meta description.

**2. Popup states (`popup.html` + `popup.js`)**

Three states:

**Not configured** — no PAT stored:
- "Set up your connection" message + button to open options page

**Saving/Saved** — default when configured (one-click flow):
- On popup open: extract metadata → send `POST /bookmarks/` with default tags
- Show brief spinner then "Saved!" with bookmark title
- "Edit" link expands to edit form
- On 409: show "Already saved" message

**Edit form** — expanded:
- URL (read-only)
- Title (editable, pre-filled from page)
- Description (editable, pre-filled from meta)
- Tags (editable, pre-filled with default tags, comma-separated)
- Save button

Popup should be compact (~350px wide).

**3. API call via background service worker**

Add `CREATE_BOOKMARK` handler in `background.js`:

```js
if (message.type === 'CREATE_BOOKMARK') {
  const settings = await chrome.storage.local.get(['apiUrl', 'token']);
  fetch(`${settings.apiUrl}/bookmarks/`, {
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
      return { success: false, status: res.status, body };
    })
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
}
```

**4. Error handling in popup**

| Status | UI behavior |
|--------|------------|
| 201 | "Saved!" confirmation |
| 401 | "Invalid token" + link to open options page |
| 409 `ACTIVE_URL_EXISTS` | "Already saved" |
| 409 `ARCHIVED_URL_EXISTS` | "Archived" — with link to open bookmark in Tiddly |
| 429 | "Rate limited — try again in Xs" (read `Retry-After` header) |
| 451 | "Accept terms first" + link to Tiddly web app |
| Network error | "Can't reach server — check your API URL in settings" |

**5. Truncate long fields before sending** — title to 100 chars, description to 1000 chars. Prevents 400 errors from the API.

### Testing Strategy

- Click extension on normal webpage → bookmark created with correct URL, title, description, default tags
- Click on page with no meta description → saves with empty description (no crash)
- Click on already-bookmarked URL → shows "Already saved" (409)
- Click with expired/invalid PAT → auth error with link to settings
- Click when API unreachable → network error message
- Expand edit form, change title and tags, save → bookmark has modified values
- Check content history in web UI → `X-Request-Source: chrome-extension` appears
- Click on `chrome://` or `about:` page → graceful error ("Can't save this page")
- Keyboard shortcut `Alt+Shift+B` opens the popup
- Title > 100 chars from page → truncated, saves successfully
- Rapid double-click → 409 handles the second attempt (no duplicate)

---

## Milestone 3: Polish & Documentation

### Goal & Outcome

Edge cases, styling, and documentation. After this milestone:

- Extension handles all edge cases gracefully
- `frontend/public/llms.txt` updated with Chrome extension section
- `chrome-extension/README.md` has complete setup and testing guide
- Extension is ready for local use

### Implementation Outline

**1. Edge cases**

- **Privileged pages** (`chrome://`, `about:`, `chrome-extension://`): `chrome.scripting.executeScript` fails on these. Check tab URL before attempting injection; show "Can't save this page" in popup.
- **PDF / non-HTML pages**: Metadata extraction may fail or return empty values. Fall back to saving with URL only.
- **Popup closes mid-save**: The background service worker completes the fetch regardless. The bookmark still saves — the user just won't see confirmation. This is acceptable.

**2. Visual styling**

Style popup and options page with clean CSS. Keep it simple — dark/light based on `prefers-color-scheme`, clean typography, consistent with Tiddly's feel.

**3. Update `frontend/public/llms.txt`**

Add a brief section about the Chrome extension: what it does, PAT-based auth, one-click save with configurable default tags.

**4. Complete `chrome-extension/README.md`**

- What the extension does
- How to install (load unpacked)
- How to set up (create PAT, configure extension)
- Development workflow
- Full manual testing checklist (consolidated from milestones 1 and 2)

### Testing Strategy

Full manual test pass covering all items from milestones 1 and 2, plus:

- Extension on `chrome://extensions` page → "Can't save this page"
- Extension on a local PDF file → saves with URL, handles missing title
- Close popup mid-save, check web UI → bookmark was still created
- Options page help link → opens correct Tiddly tokens page
- Light mode and dark mode both look correct

---

## Summary

| Milestone | Component | Scope |
|-----------|-----------|-------|
| 1 | Extension scaffold + settings | Manifest, options page, PAT storage, test connection, keyboard shortcut |
| 2 | Popup UI + one-click save | Metadata extraction, auto-save, error handling, edit form |
| 3 | Polish + documentation | Edge cases, styling, llms.txt, README |

### Not In Scope (future work)

- Chrome Web Store publishing (requires developer account, review process, stable extension ID)
- OAuth/Auth0 flow in the extension
- Badge/icon showing duplicate status on tab switch
- Context menus (right-click to save)
- Tag autocomplete from existing tags
- Firefox/Safari ports
- PAT scoping (write-only tokens)
