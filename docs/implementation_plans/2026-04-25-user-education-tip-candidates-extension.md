# Tip candidates — extension

## Strong candidates (strongest first)

### Save any page to Tiddly with the Chrome extension
- Description: Install the Tiddly Bookmarks extension from the Chrome Web Store to save the page you're on with one click — no copy-pasting URLs into the web app. Works in Chrome, Edge, Brave, Arc, and other Chromium browsers.
- Reference: frontend/src/pages/docs/DocsExtensionsChrome.tsx:24
- Tags: feature | new-user

### Pin the extension and assign a keyboard shortcut
- Description: After installing, pin Tiddly Bookmarks to the toolbar, then open `chrome://extensions/shortcuts` and bind a key (e.g., `Ctrl+Shift+S`) to launch the popup without reaching for the mouse.
- Reference: frontend/src/pages/docs/DocsExtensionsChrome.tsx:140
- Tags: workflow | power-user

### Set default tags so every save is pre-tagged
- Description: Open the extension settings and pick default tags (e.g., `reading-list`). They'll be pre-selected on every save — clear them per-bookmark with the inline Clear link if a particular page doesn't fit.
- Reference: chrome-extension/options.html:28
- Tags: feature | new-user

### Search your whole library from the extension
- Description: The popup has a Search tab next to Save — type to query across titles, descriptions, URLs, and scraped page content; filter by tag and sort by relevance, last used, modified, or title. Clicking a result navigates the current tab to that bookmark.
- Reference: chrome-extension/popup.html:66
- Tags: feature | power-user

### Restricted pages auto-open the Search tab
- Description: On `chrome://`, new tab, or other extension pages where saving isn't possible, the popup opens directly to Search — useful for quickly looking up a previously-saved link from any context.
- Reference: chrome-extension/popup-core.js:118
- Tags: feature | power-user

### Page content is captured for full-text search
- Description: The extension scrapes up to 200,000 characters of body text on save (capped to your tier's content limit), so later searches match phrases inside the page — not just title and description.
- Reference: chrome-extension/popup-core.js:333
- Tags: feature | new-user

### Drafts persist if you close the popup mid-save
- Description: Title, description, and tags you've edited are written to extension storage as you type. If the popup gets dismissed (clicked outside, accidentally closed), reopening on the same URL restores everything — no lost work.
- Reference: chrome-extension/popup-core.js:316
- Tags: feature | power-user

### Recently used tags get pre-selected on the next save
- Description: After you save, the tag set is remembered and pre-selected the next time you open the popup — handy for tagging a run of related pages without re-picking the same tags each time.
- Reference: chrome-extension/popup-core.js:417
- Tags: workflow | power-user

### Already-saved URLs surface a link instead of duplicating
- Description: Try to save a URL you've already saved (active or archived) and the popup shows a "View it" link straight to the existing bookmark — no duplicates, and a fast way to jump to your prior copy.
- Reference: chrome-extension/popup-core.js:641
- Tags: feature | power-user

### Use the extension to save, the web app to organize
- Description: Save quickly while browsing — title, description, and content auto-fill from the page. Later, open tiddly.me to edit notes, link bookmarks together, or move them into saved filters.
- Reference: chrome-extension/popup-core.js:354
- Tags: workflow | new-user

### Connect the extension with a Personal Access Token
- Description: First-launch setup asks for a PAT (starts with `bm_`). Create one at `tiddly.me/app/settings/tokens`, name it "Chrome Extension" so you can revoke just that device later, and paste it into the extension's options page.
- Reference: frontend/src/pages/docs/DocsExtensionsChrome.tsx:39
- Tags: feature | new-user

### Type a new tag and press Enter to add it on save
- Description: The tag input accepts free-form tags — type a name and press Enter to attach a tag that doesn't exist yet. Underscores get normalized to hyphens automatically.
- Reference: chrome-extension/popup-core.js:461
- Tags: feature | power-user

## Speculative

### Show all tags when your default top-eight isn't enough
- Description: The save form only lists the first eight tags as chips by default. Use the "Show all (N)" link below the chips, or type into the tag input to filter through your full tag list.
- Reference: chrome-extension/popup-core.js:519
- Tags: feature | power-user
- Hesitation: Minor UI affordance — likely discoverable on its own; only worth a tip if users complain about not finding tags.

### Filter extension search by multiple tags at once
- Description: The Search tab's tag filter accepts multiple tags — click into the tag input, pick one, then add more to narrow results to bookmarks tagged with all of them.
- Reference: chrome-extension/popup-core.js:683
- Tags: feature | power-user
- Hesitation: Overlaps heavily with web-app tag filtering tips; risk of duplication.

### Toggle token visibility before pasting
- Description: The settings page masks your PAT by default — click "Show" to reveal it for verification before saving.
- Reference: chrome-extension/options.js:23
- Tags: feature | new-user
- Hesitation: Borderline trivial; only useful if users frequently paste the wrong token.
