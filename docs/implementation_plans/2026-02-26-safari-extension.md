# Safari Extension Implementation Plan

## Overview

Port the existing Chrome extension (`chrome-extension/`) to Safari as a Safari Web Extension. The Chrome extension saves bookmarks, extracts page content, and provides search on restricted pages — all using Personal Access Tokens (PATs) for authentication. Safari Web Extensions use the same WebExtension API standard, so most code carries over with targeted compatibility fixes.

### Key Design Decisions

**Separate directory, not shared source:** The Safari extension lives in `safari-extension/` as a standalone copy of the web extension files (no Xcode project). The Chrome extension is ~1,200 lines of vanilla JS/HTML/CSS with no build process. Maintaining two small copies is simpler than introducing a build system to share code between browsers. If the extensions diverge significantly later, refactoring to shared source is straightforward.

**No Xcode project (pending verification):** As of WWDC25, Safari Web Extensions can reportedly be packaged and distributed via the App Store Connect web portal by uploading a ZIP file — no Xcode required. For development, Safari 26 supports loading extensions directly from a folder. This keeps the project simple and accessible to developers without macOS build tool expertise. **Important:** Verify the App Store Connect ZIP upload workflow exists and works as described early in Milestone 1 by checking Apple's current documentation. If it's not available or has constraints (signing, entitlements), fall back to `xcrun safari-web-extension-converter` to generate an Xcode project wrapper — this changes the directory structure but not the web extension code.

**Background scripts instead of service worker:** Safari has known bugs with cross-origin `fetch()` in service workers (the exact pattern used by the Tiddly extension to call `api.tiddly.me`). Using `background.scripts` with `"persistent": false` (event page) is more reliable and also enables Safari Web Inspector debugging of the background context.

**`browser.*` polyfill pattern:** Safari natively supports `browser.*` with Promises and also provides `chrome.*` for compatibility. Rather than depending on the Mozilla WebExtension Polyfill library, a lightweight shim at the top of each JS file handles the namespace:

```js
const api = globalThis.browser ?? globalThis.chrome;
```

This keeps the extension dependency-free while working across both Safari and Chrome (if ever unified).

**Favicon via DuckDuckGo:** Safari has no `favicon` permission or `chrome-extension://.../_favicon/` URL scheme. Search results use DuckDuckGo's icon service (`https://icons.duckduckgo.com/ip3/{domain}.ico`) — the same service the Tiddly web app already uses for bookmark favicons (`frontend/src/components/BookmarkCard.tsx`). This is consistent across the product and a better privacy fit for Safari's audience than Google's favicon service.

### What Changes From Chrome

| Area | Chrome | Safari |
|------|--------|--------|
| `manifest.json` background | `"service_worker": "background.js"` | `"scripts": ["background.js"], "persistent": false` |
| `manifest.json` permissions | `["activeTab", "storage", "scripting", "favicon"]` | `["activeTab", "storage", "scripting"]` (no favicon) |
| Favicon in search results | `chrome-extension://${id}/_favicon/?pageUrl=...` | `https://icons.duckduckgo.com/ip3/{domain}.ico` |
| Restricted page regex | `chrome-extension:` in pattern | Add `safari-web-extension:` to pattern |
| `X-Request-Source` header | `chrome-extension` | `safari-extension` |
| API namespace | `chrome.*` | `api.*` via polyfill shim |
| Host permissions | Granted at install | User must grant via Safari Settings (optional by default) |
| `manifest.json` options | `"options_page": "options.html"` | `"options_ui": { "page": "options.html", "open_in_tab": true }` |
| Distribution | Chrome Web Store | App Store Connect (ZIP upload, pending verification) |

### Relevant Documentation

Read these before implementing:

- Apple: Creating a Safari Web Extension: https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension
- Apple: Assessing Browser Compatibility: https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility
- Apple: Managing Safari Web Extension Permissions: https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions
- Apple: Running Your Safari Web Extension: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension
- Apple: Packaging with App Store Connect: https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect
- Apple: Optimizing Your Web Extension for Safari: https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari
- MDN: Build a Cross-Browser Extension: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension
- MDN: Chrome Incompatibilities: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
- Safari Web Extension converter: `xcrun safari-web-extension-converter --help`

---

## Milestone 1: Create Safari Extension & Core Compatibility

### Goal & Outcome

Create the Safari extension with all compatibility fixes applied. After this milestone:

- `safari-extension/` directory exists with all web extension files
- Extension can be loaded in Safari 26 via "Add Temporary Extension" (Settings > Developer)
- User can configure PAT in options page
- Save flow works on normal pages (metadata + content extraction, tags, error handling)
- Search flow works on restricted pages (recent bookmarks, search, pagination)
- All functionality matches the Chrome extension

### Implementation Outline

**0. Verify distribution workflow**

Before committing to the no-Xcode architecture, verify the App Store Connect web extension packager (WWDC25) by reading Apple's current documentation at https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect. Confirm:
- ZIP upload is available and functional
- No Xcode project, signing certificate, or provisioning profile is required for packaging
- macOS and iOS/iPadOS targets are generated automatically

If the workflow doesn't exist or has blocking constraints, generate an Xcode project wrapper using `xcrun safari-web-extension-converter` instead. This adds an Xcode project to the directory but doesn't change the web extension code. Document whichever path is used.

**1. Create `safari-extension/` directory**

Copy all web extension files from `chrome-extension/` into `safari-extension/`:

```
safari-extension/
├── manifest.json        # Modified for Safari
├── popup.html
├── popup.css
├── popup.js             # Modified for Safari compatibility
├── options.html
├── options.css
├── options.js           # Modified for Safari compatibility
├── background.js        # Modified for Safari compatibility
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg
└── README.md            # Safari-specific setup guide
```

**2. Modify `manifest.json`**

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
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "background": {
    "scripts": ["background.js"],
    "persistent": false
  }
}
```

Changes from Chrome:
- Remove `"favicon"` from permissions (Chrome-only, no Safari equivalent)
- Replace `"service_worker": "background.js"` with `"scripts": ["background.js"], "persistent": false` — this avoids Safari's service worker cross-origin fetch bugs and enables Web Inspector debugging. Note: Safari's MV3 supports both `service_worker` and `scripts` (unlike Chrome which only supports `service_worker` in MV3). Verify this works on first load.
- Replace `"options_page": "options.html"` with `"options_ui": { "page": "options.html", "open_in_tab": true }` — `options_page` is a MV2 key; `options_ui` is the MV3 standard and may render differently on iOS

**3. Add browser API polyfill shim**

Add to the top of `background.js`, `popup.js`, and `options.js`:

```js
const api = globalThis.browser ?? globalThis.chrome;
```

Then replace all `chrome.` calls with `api.` throughout each file. Key call sites:

- `background.js`: `chrome.storage.local.get`, `chrome.runtime.onMessage`
- `popup.js`: `chrome.runtime.sendMessage`, `chrome.tabs.query`, `chrome.tabs.create`, `chrome.scripting.executeScript`, `chrome.storage.local.get/set`, `chrome.runtime.openOptionsPage`, `chrome.runtime.getURL`
- `options.js`: `chrome.storage.local.get/set`, `chrome.runtime.sendMessage`

**4. Fix restricted page detection in `popup.js`**

Update the regex to include Safari-specific URL schemes:

```js
function isRestrictedPage(url) {
  return !url || /^(chrome|about|chrome-extension|safari-web-extension|devtools|edge|data|blob|view-source):/.test(url);
}
```

**5. Fix favicon URLs in search results (`popup.js`)**

Replace the Chrome-specific favicon URL with DuckDuckGo's icon service (same as the Tiddly web app uses in `BookmarkCard.tsx`):

```js
// Chrome:
// favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;

// Safari:
const domain = new URL(item.url).hostname;
favicon.src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
```

The Chrome extension already has an `onerror` handler that removes the favicon image on load failure — the same pattern carries over.

**6. Update `X-Request-Source` header in `background.js`**

Change from `'chrome-extension'` to `'safari-extension'` in all API request headers:

```js
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-Request-Source': 'safari-extension'
}
```

**7. Handle `chrome.runtime.onMessage` listener pattern**

In Chrome MV3 with service workers, the message listener uses `return true` to keep the message channel open for async responses. Safari with background scripts (non-persistent) uses the same pattern, but verify it works. The current Chrome pattern:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(/* ... */);
  return true; // keep channel open for async response
});
```

This pattern works in Safari. With the `api` shim, it becomes `api.runtime.onMessage.addListener(...)`.

**8. Icons**

Reuse the same icon PNGs from the Chrome extension. Safari uses the same icon sizes (16, 48, 128). No changes needed.

### Testing Strategy

Development setup:
1. Open Safari > Settings > Developer (or Advanced > Show Develop menu)
2. Click "Add Temporary Extension..."
3. Select the `safari-extension/` folder
4. Grant permissions when prompted

Test the full Chrome extension test matrix in Safari:

Save flow:
- Click extension on normal page → form shows pre-filled URL, title, description, tags
- Click Save → bookmark created, "Saved!" shown
- Save already-bookmarked URL → "Already saved" (409)
- Save with invalid PAT → auth error with link to settings
- Save when API unreachable → network error message
- Tag chips appear and toggle correctly
- Type to filter tags, Enter to commit new tag

Search flow:
- Open on `about:blank` or new tab → search UI shown
- Recent bookmarks load by default
- Type search query → results update after debounce
- Click "Load more" → next page appended
- Click result → opens in new tab

Settings:
- Enter PAT, save → persists across Safari restarts
- Invalid PAT format → validation error
- Default tags save and pre-select in popup

Safari-specific:
- Verify `manifest_version: 3` with `background.scripts` loads without errors (Safari supports both `scripts` and `service_worker` in MV3)
- Verify `scripting.executeScript` with `func` parameter extracts page metadata (title, description, content) — this is the most Safari-fragile API. If it fails, the existing try/catch fallback to `tab.url`/`tab.title` covers it.
- Favicon images load from DuckDuckGo's service in search results
- Extension works after granting "Allow on All Websites" for api.tiddly.me
- No console errors related to CORS or permissions
- Popup opens and closes cleanly
- Options page opens correctly via `options_ui` (not `options_page`)
- Background script handles messages correctly (non-persistent mode)

---

## Milestone 2: Safari Permission UX & iOS/iPadOS

### Goal & Outcome

Handle Safari's more restrictive permission model and ensure the extension works on iOS/iPadOS. After this milestone:

- Extension guides users through Safari's permission granting flow
- Extension handles gracefully when permissions haven't been granted yet
- Popup layout works on iOS Safari (smaller viewport, sheet presentation)
- Extension tested on iPhone and iPad simulators

### Implementation Outline

**1. Proactive permission checking**

Safari treats `host_permissions` as optional — users must explicitly grant access to `api.tiddly.me`. Rather than waiting for API calls to fail with confusing network errors, check permissions proactively at popup initialization using `api.permissions.contains()`:

```js
async function checkHostPermissions() {
  const granted = await api.permissions.contains({
    origins: ['https://api.tiddly.me/*']
  });
  return granted;
}
```

If permissions aren't granted, show a dedicated "Permission Required" state in the popup (distinct from the "Not configured" and save/search states) with platform-specific instructions.

**2. Platform-specific permission guidance**

The permission setup path differs between macOS and iOS/iPadOS. Detect the platform and show the correct instructions:

```js
const isMobile = /iPhone|iPad/.test(navigator.userAgent);
```

- **macOS**: "Open Safari → Settings → Extensions → Tiddly Bookmarks, then set api.tiddly.me to Allow"
- **iOS/iPadOS**: "Open Settings → Safari → Extensions → Tiddly Bookmarks, then set api.tiddly.me to Allow"

Show the same guidance in the options page after the user saves a valid PAT.

**3. Handle `tab.url` being empty**

In Safari, `tabs.query` may return tabs without URLs when the user hasn't granted broad permissions. The extension already uses `activeTab` which grants temporary access to the active tab on click, so `tab.url` should be available. However, add a defensive check:

```js
const [tab] = await api.tabs.query({ active: true, currentWindow: true });
if (!tab?.url) {
  // Safari may not expose URL without permissions — show search view as fallback
  initSearchView();
  return;
}
```

**4. iOS/iPadOS popup adjustments**

On iOS, the extension popup is presented as a sheet with a smaller viewport. Adjust CSS for mobile Safari:

```css
@media (max-width: 360px) {
  body {
    min-width: auto;
    width: 100%;
  }

  .popup {
    width: 100%;
    min-width: auto;
  }

  /* Tag chips wrap more aggressively on narrow screens */
  .tag-chips {
    max-height: 120px;
  }
}
```

The existing popup is 350px wide, which should fit on iPhone screens (minimum 320px CSS width on iPhone SE). Minor tweaks may be needed for tag chip wrapping and scroll behavior.

**5. iOS background script constraints**

iOS requires `"persistent": false` for background scripts — already set in Milestone 1's manifest. Verify that the non-persistent background script correctly handles:
- Being terminated and restarted between popup opens
- `api.storage.local.get` working after restart (it should — storage persists)
- Message passing working after background script restart

### Testing Strategy

Permission flow:
- Install extension without granting host permissions → popup shows "Permission Required" state with instructions (not a generic network error)
- Verify macOS shows macOS-specific instructions ("Safari → Settings → Extensions")
- Verify iOS shows iOS-specific instructions ("Settings → Safari → Extensions")
- Grant "Allow on All Websites" → popup switches to normal save/search view
- Grant permission for just `api.tiddly.me` → API calls work
- Revoke permissions → popup shows "Permission Required" state again

iOS/iPadOS (test in Simulator or device):
- Open extension on iPhone → popup fits screen, no horizontal scroll
- Tag chips wrap correctly on narrow screen
- Search results scrollable within popup sheet
- Save flow works end-to-end on iOS
- Search flow works end-to-end on iOS
- Options page usable on iOS (form inputs, save button)
- Extension survives background script termination (open popup, wait, open again)

---

## Milestone 3: Documentation & Distribution Prep

### Goal & Outcome

Complete documentation and prepare for App Store distribution. After this milestone:

- `safari-extension/README.md` has complete setup, development, and distribution guide
- `frontend/public/llms.txt` updated with Safari extension information
- Extension is ready for App Store submission via App Store Connect

### Implementation Outline

**1. `safari-extension/README.md`**

Cover:
- What the extension does (same features as Chrome: save bookmarks, search, tags)
- Development setup: loading in Safari 26 via "Add Temporary Extension"
- Enabling Developer mode in Safari Settings
- Granting permissions for `api.tiddly.me` (platform-specific paths for macOS vs iOS)
- Creating a PAT in Tiddly and configuring the extension
- **Differences from Chrome extension** section listing every specific change: manifest (background scripts, options_ui, no favicon permission), favicon source (DuckDuckGo), restricted page regex (safari-web-extension:), request source header, browser API shim. This serves as both documentation and a maintenance checklist — when changing one extension, check if the change applies to the other.
- Distribution via App Store Connect (ZIP upload workflow, with Xcode converter fallback)
- Local development with `localhost:8000` (modify `API_URL` and add `host_permissions`)

**2. Update `frontend/public/llms.txt`**

Add Safari extension alongside the existing Chrome extension section. Mention:
- Same features as Chrome extension
- Available on macOS, iOS, and iPadOS Safari
- PAT-based authentication
- Permission setup required in Safari Settings

**3. App Store Connect distribution documentation**

Document the steps in README.md:
1. Ensure Apple Developer Program membership ($99/year)
2. Create a ZIP of the `safari-extension/` directory contents
3. Upload to App Store Connect via the web portal
4. Apple packages it automatically for macOS, iOS, and iPadOS
5. Test via TestFlight
6. Submit for App Store review

Note: This is the WWDC25 workflow that doesn't require Xcode. Document the alternative Xcode approach (`xcrun safari-web-extension-converter`) as a fallback for developers who need native app integration.

### Testing Strategy

- README instructions are accurate and complete (follow them from scratch)
- `llms.txt` reflects Safari extension capabilities
- ZIP of extension files loads correctly in Safari 26 via "Add Temporary Extension"
- All links in README and options page point to correct URLs

---

## Summary

| Milestone | Scope |
|-----------|-------|
| 1 | Verify distribution workflow, create `safari-extension/`, fix manifest (background scripts, options_ui, no favicon), polyfill browser API, DuckDuckGo favicons, fix restricted-page regex/header, verify all flows in Safari |
| 2 | Proactive permission checking via `permissions.contains()`, platform-specific permission guidance (macOS vs iOS), iOS/iPadOS responsive layout, mobile testing |
| 3 | README with Chrome diff checklist, llms.txt update, App Store Connect distribution documentation |

### Not In Scope (future work)

- App Store publication (requires Apple Developer account, review process)
- Shared source between Chrome and Safari extensions (maintain separately for now; README documents differences as a sync checklist)
- Context menus or keyboard shortcuts
- OAuth/Auth0 flow in the extension
- Content script-based features (e.g., highlight text to save)
- Readability-style content extraction
