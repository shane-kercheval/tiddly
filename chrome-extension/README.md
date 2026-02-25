# Tiddly Bookmarks Chrome Extension

Save bookmarks to [tiddly.me](https://tiddly.me) with one click. Search your bookmarks from the new tab page.

## Features

- **One-click save** — click the extension icon on any page to save it as a bookmark with title, description, tags, and page content (for search)
- **Tag selection** — pre-filled from your defaults and last-used tags, with selectable chips from your existing tags
- **Search** — on restricted pages (new tab, chrome://, etc.), search your bookmarks instead
- **PAT authentication** — uses Personal Access Tokens (no OAuth complexity)

## Setup

### 1. Install the extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` directory from this repo

### 2. Create a Personal Access Token

1. Go to [tiddly.me/app/settings/tokens](https://tiddly.me/app/settings/tokens)
2. Create a new token
3. Copy the token (starts with `bm_`)

### 3. Configure the extension

1. Right-click the extension icon > **Options** (or click the gear icon)
2. Paste your PAT
3. Optionally set default tags (comma-separated, e.g. `reading_list, chrome`)
4. Click **Test Connection** to verify
5. Click **Save**

## Usage

**Saving a bookmark:** Click the extension icon on any webpage. Review the pre-filled form (URL, title, description, tags) and click **Save Bookmark**.

**Searching bookmarks:** Click the extension icon on a new tab or restricted page. Type to search, or browse your recent bookmarks.

## Local Development

To develop against a local API server:

1. In `background.js`, change `API_URL` to `http://localhost:8000`
2. In `manifest.json`, add `http://localhost:8000/*` to `host_permissions`
3. Reload the extension in `chrome://extensions/`
