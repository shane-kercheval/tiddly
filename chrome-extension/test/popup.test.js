import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POPUP_HTML = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf-8');

const VALID_LIMITS = {
  max_title_length: 100,
  max_description_length: 1000,
  max_bookmark_content_length: 100000,
};

function setStorage(values) {
  chrome.storage.local.get.mockImplementation((keys) => {
    const result = {};
    for (const key of keys) {
      if (key in values) result[key] = values[key];
    }
    return Promise.resolve(result);
  });
}

function setTab(tab) {
  chrome.tabs.query.mockResolvedValue(tab ? [tab] : []);
}

function mockMessages(responses) {
  chrome.runtime.sendMessage.mockImplementation((msg) => {
    return Promise.resolve(responses[msg.type] ?? null);
  });
}

function mockPageScrape(data = {}) {
  chrome.scripting.executeScript.mockResolvedValue([{
    result: {
      title: data.title ?? 'Page Title',
      description: data.description ?? '',
      content: data.content ?? '',
    },
  }]);
}

async function runPopup() {
  document.body.innerHTML = POPUP_HTML;
  vi.resetModules();
  await import('../popup.js');
  // Yield twice so the top-level async init() chain settles.
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

describe('popup controller — setup state', () => {
  it('no token: shows setup-view and hides the tabbed header', async () => {
    setStorage({});
    setTab(null);
    await runPopup();

    expect(document.getElementById('setup-view').hidden).toBe(false);
    expect(document.getElementById('popup-header').hidden).toBe(true);
    expect(document.getElementById('save-view').hidden).toBe(true);
    expect(document.getElementById('search-view').hidden).toBe(true);
  });

  it('no token: does not call initSaveForm or initSearchView (no API fetches)', async () => {
    setStorage({});
    setTab(null);
    await runPopup();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('popup controller — default tab selection', () => {
  it('restricted URL: Search is default, Save is disabled with a tooltip', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'chrome://newtab/', title: 'New Tab' });
    mockMessages({
      GET_TAGS: { success: true, data: { tags: [] } },
      SEARCH_BOOKMARKS: { success: true, data: { items: [], has_more: false } },
    });
    await runPopup();

    const tabSave = document.getElementById('tab-save');
    const tabSearch = document.getElementById('tab-search');
    expect(tabSearch.getAttribute('aria-selected')).toBe('true');
    expect(tabSave.getAttribute('aria-disabled')).toBe('true');
    // a11y: disabled tab's accessible name must still identify the tab as "Save"
    expect(tabSave.getAttribute('aria-label')).toMatch(/^Save\b/);
    expect(tabSave.title).toMatch(/^Save\b/);
    expect(document.getElementById('search-view').hidden).toBe(false);
    expect(document.getElementById('save-view').hidden).toBe(true);
  });

  it('regular URL: Save is default, both tabs enabled', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'https://example.com', title: 'Example' });
    mockPageScrape();
    mockMessages({
      GET_LIMITS: { success: true, data: VALID_LIMITS },
      GET_TAGS: { success: true, data: { tags: [] } },
    });
    await runPopup();

    expect(document.getElementById('tab-save').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('tab-save').hasAttribute('aria-disabled')).toBe(false);
    expect(document.getElementById('tab-search').hasAttribute('aria-disabled')).toBe(false);
    expect(document.getElementById('save-view').hidden).toBe(false);
  });
});

describe('popup controller — synchronous panel activation', () => {
  it('flips the Save panel visible before initSaveForm awaits finish', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'https://example.com', title: 'Example' });
    // Stall page-scrape so initSaveForm's Promise.all never resolves during the test.
    chrome.scripting.executeScript.mockReturnValue(new Promise(() => {}));
    mockMessages({
      GET_LIMITS: { success: true, data: VALID_LIMITS },
      GET_TAGS: { success: true, data: { tags: [] } },
    });

    document.body.innerHTML = POPUP_HTML;
    vi.resetModules();
    const popupDone = import('../popup.js');
    // Yield enough times for the top-level sync path + the storage.get/tabs.query awaits,
    // but initSaveForm's Promise.all will still be pending on scripting.executeScript.
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('save-view').hidden).toBe(false);
    expect(document.getElementById('tab-save').getAttribute('aria-selected')).toBe('true');

    // Clean up — the popup's own init promise will never resolve because we stalled scripting.
    // Swallow the dangling import so vitest doesn't flag an unhandled rejection on teardown.
    popupDone.catch(() => {});
  });
});

describe('popup controller — lazy init idempotency', () => {
  it('clicking the same tab twice does not re-run initSaveForm', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'https://example.com', title: 'Example' });
    mockPageScrape();
    mockMessages({
      GET_LIMITS: { success: true, data: VALID_LIMITS },
      GET_TAGS: { success: true, data: { tags: [] } },
      SEARCH_BOOKMARKS: { success: true, data: { items: [], has_more: false } },
    });
    await runPopup();

    const limitsCalls = () => chrome.runtime.sendMessage.mock.calls.filter(
      c => c[0].type === 'GET_LIMITS'
    ).length;

    // Save ran at startup (default tab)
    expect(limitsCalls()).toBe(1);

    document.getElementById('tab-search').click();
    await new Promise(r => setTimeout(r, 0));
    document.getElementById('tab-save').click();
    await new Promise(r => setTimeout(r, 0));
    document.getElementById('tab-search').click();
    await new Promise(r => setTimeout(r, 0));

    expect(limitsCalls()).toBe(1);
  });

  it('clicking the disabled Save tab does not run initSaveForm', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'chrome://newtab/', title: 'New Tab' });
    mockMessages({
      GET_TAGS: { success: true, data: { tags: [] } },
      SEARCH_BOOKMARKS: { success: true, data: { items: [], has_more: false } },
    });
    await runPopup();

    const before = chrome.runtime.sendMessage.mock.calls.length;
    document.getElementById('tab-save').click();
    await new Promise(r => setTimeout(r, 0));

    expect(chrome.runtime.sendMessage.mock.calls.length).toBe(before);
    expect(document.getElementById('tab-search').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('search-view').hidden).toBe(false);
  });

  it('Save submit listener only fires once even after multiple tab switches', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'https://example.com', title: 'Example' });
    mockPageScrape();
    mockMessages({
      GET_LIMITS: { success: true, data: VALID_LIMITS },
      GET_TAGS: { success: true, data: { tags: [] } },
      SEARCH_BOOKMARKS: { success: true, data: { items: [], has_more: false } },
      CREATE_BOOKMARK: { success: true },
    });
    await runPopup();

    document.getElementById('tab-search').click();
    await new Promise(r => setTimeout(r, 0));
    document.getElementById('tab-save').click();
    await new Promise(r => setTimeout(r, 0));

    const createCallsBefore = chrome.runtime.sendMessage.mock.calls.filter(
      c => c[0].type === 'CREATE_BOOKMARK'
    ).length;

    document.getElementById('save-form').dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true })
    );
    await new Promise(r => setTimeout(r, 0));

    const createCallsAfter = chrome.runtime.sendMessage.mock.calls.filter(
      c => c[0].type === 'CREATE_BOOKMARK'
    ).length;

    expect(createCallsAfter - createCallsBefore).toBe(1);
  });
});

describe('popup controller — settings button', () => {
  it('clicking the settings button calls chrome.runtime.openOptionsPage', async () => {
    setStorage({ token: 'bm_abc' });
    setTab({ id: 1, url: 'https://example.com', title: 'Example' });
    mockPageScrape();
    mockMessages({
      GET_LIMITS: { success: true, data: VALID_LIMITS },
      GET_TAGS: { success: true, data: { tags: [] } },
    });
    await runPopup();

    document.getElementById('settings-btn').click();

    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
