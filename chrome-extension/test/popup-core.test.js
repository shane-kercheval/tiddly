import { resetChromeStorage, setupPopupDOM, mockMessages } from './setup.js';
import {
  SCRAPE_CAP, DRAFT_KEY, DRAFT_IMMUTABLE_KEY,
  isRestrictedPage, isValidLimits, characterLimitMessage,
  updateLimitFeedback, applyLimits,
  setupDOM, resetState,
  saveDraft, clearDraft, getPageData,
  initSaveForm, handleSave, handleSaveError,
  showSaveStatus,
} from '../popup-core.js';

// --- Test fixtures ---

const VALID_LIMITS = {
  max_title_length: 100,
  max_description_length: 1000,
  max_bookmark_content_length: 100000,
};

const VALID_TAGS = ['javascript', 'python', 'rust', 'go', 'typescript', 'react', 'vue', 'svelte', 'node'];

function validLimitsResponse() {
  return { success: true, data: VALID_LIMITS };
}

function validTagsResponse() {
  return { success: true, data: { tags: VALID_TAGS.map(name => ({ name })) } };
}

function makeTab(url = 'https://example.com') {
  return { id: 1, url, title: 'Example' };
}

function mockPageData(data = {}) {
  chrome.scripting.executeScript.mockResolvedValue([{
    result: {
      title: data.title ?? 'Page Title',
      description: data.description ?? 'Page description',
      content: data.content ?? 'Page content',
    }
  }]);
}

// --- Pure function tests ---

describe('isRestrictedPage', () => {
  it('returns true for chrome:// URLs', () => {
    expect(isRestrictedPage('chrome://extensions')).toBe(true);
  });

  it('returns true for about: URLs', () => {
    expect(isRestrictedPage('about:blank')).toBe(true);
  });

  it('returns true for data: URLs', () => {
    expect(isRestrictedPage('data:text/html,hello')).toBe(true);
  });

  it('returns true for chrome-extension: URLs', () => {
    expect(isRestrictedPage('chrome-extension://abc/popup.html')).toBe(true);
  });

  it('returns true for null/undefined', () => {
    expect(isRestrictedPage(null)).toBe(true);
    expect(isRestrictedPage(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isRestrictedPage('')).toBe(true);
  });

  it('returns false for http URLs', () => {
    expect(isRestrictedPage('https://example.com')).toBe(false);
    expect(isRestrictedPage('http://example.com')).toBe(false);
  });
});

describe('isValidLimits', () => {
  it('returns true for valid limits object', () => {
    expect(isValidLimits(VALID_LIMITS)).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isValidLimits(null)).toBeFalsy();
    expect(isValidLimits(undefined)).toBeFalsy();
  });

  it('returns false when fields are missing', () => {
    expect(isValidLimits({ max_title_length: 100 })).toBe(false);
    expect(isValidLimits({ max_title_length: 100, max_description_length: 1000 })).toBe(false);
  });

  it('returns false for zero values', () => {
    expect(isValidLimits({ ...VALID_LIMITS, max_title_length: 0 })).toBe(false);
  });

  it('returns false for negative values', () => {
    expect(isValidLimits({ ...VALID_LIMITS, max_description_length: -1 })).toBe(false);
  });

  it('returns false for non-number types', () => {
    expect(isValidLimits({ ...VALID_LIMITS, max_title_length: '100' })).toBe(false);
    expect(isValidLimits({ ...VALID_LIMITS, max_bookmark_content_length: true })).toBe(false);
  });
});

describe('characterLimitMessage', () => {
  it('returns expected message for small numbers', () => {
    expect(characterLimitMessage(100)).toBe('Character limit reached (100)');
  });

  it('returns message containing the number for large values', () => {
    const msg = characterLimitMessage(1000);
    expect(msg).toContain('Character limit reached');
    expect(msg).toContain('1');
    expect(msg).toContain('000');
  });
});

// --- DOM-dependent tests ---

describe('updateLimitFeedback', () => {
  let input, feedback;

  beforeEach(() => {
    input = document.createElement('input');
    feedback = document.createElement('span');
    feedback.hidden = true;
  });

  it('shows feedback when input length >= maxLength', () => {
    input.value = 'a'.repeat(100);
    updateLimitFeedback(input, feedback, 100);
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toBe('Character limit reached (100)');
  });

  it('hides feedback when input length < maxLength', () => {
    input.value = 'short';
    feedback.hidden = false;
    updateLimitFeedback(input, feedback, 100);
    expect(feedback.hidden).toBe(true);
  });

  it('shows feedback when input length exceeds maxLength', () => {
    input.value = 'a'.repeat(150);
    updateLimitFeedback(input, feedback, 100);
    expect(feedback.hidden).toBe(false);
  });
});

describe('applyLimits', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('sets maxLength on title and description inputs', () => {
    const titleInput = document.getElementById('title');
    const descInput = document.getElementById('description');
    applyLimits(VALID_LIMITS);
    expect(titleInput.maxLength).toBe(100);
    expect(descInput.maxLength).toBe(1000);
  });

  // pageContent truncation by applyLimits is tested indirectly through
  // handleSave's content truncation test (initSaveForm → applyLimits → handleSave).
});

// --- Integration tests ---

describe('initSaveForm — fresh fetch (no cache)', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('fetches limits, tags, and page data; populates form fields; shows form', async () => {
    const tab = makeTab();
    mockPageData({ title: 'My Page', description: 'A description', content: 'Body text' });
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(document.getElementById('url').value).toBe('https://example.com');
    expect(document.getElementById('title').value).toBe('My Page');
    expect(document.getElementById('description').value).toBe('A description');
    expect(document.getElementById('save-form').hidden).toBe(false);
    expect(document.getElementById('loading-indicator').hidden).toBe(true);
  });

  it('truncates scraped title/description to server limits', async () => {
    const tab = makeTab();
    const longTitle = 'a'.repeat(200);
    const longDesc = 'b'.repeat(2000);
    mockPageData({ title: longTitle, description: longDesc });
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(document.getElementById('title').value.length).toBe(100);
    expect(document.getElementById('description').value.length).toBe(1000);
  });

  it('writes immutable cache when both limits and tags succeed', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    const setCall = chrome.storage.local.set.mock.calls.find(
      call => DRAFT_IMMUTABLE_KEY in call[0]
    );
    expect(setCall).toBeTruthy();
    const cached = setCall[0][DRAFT_IMMUTABLE_KEY];
    expect(cached.url).toBe('https://example.com');
    expect(cached.allTags).toEqual(VALID_TAGS);
    expect(cached.limits).toEqual(VALID_LIMITS);
  });

  it('does NOT write immutable cache when tags fail', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: { success: false, status: 500 },
    });

    await initSaveForm(tab);

    const setCall = chrome.storage.local.set.mock.calls.find(
      call => DRAFT_IMMUTABLE_KEY in call[0]
    );
    expect(setCall).toBeUndefined();
    // Form still renders
    expect(document.getElementById('save-form').hidden).toBe(false);
  });

  it('calls saveDraft() to persist mutable form fields', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    const draftCall = chrome.storage.local.set.mock.calls.find(
      call => DRAFT_KEY in call[0]
    );
    expect(draftCall).toBeTruthy();
    expect(draftCall[0][DRAFT_KEY].url).toBe('https://example.com');
  });

  it('shows limit feedback if pre-populated values are at the limit', async () => {
    const tab = makeTab();
    mockPageData({ title: 'a'.repeat(100) });
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(document.getElementById('title-limit').hidden).toBe(false);
    expect(document.getElementById('title-limit').textContent).toContain('Character limit reached');
  });

  it('URL comes from tab.url, not from content script', async () => {
    const tab = makeTab('https://example.com/page#hash');
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(document.getElementById('url').value).toBe('https://example.com/page#hash');
  });
});

describe('initSaveForm — cache hit', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('restores form from draft + immutable cache when URL matches', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'Edited Title', description: 'Edited desc', tags: ['tag1'] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: 'cached content', allTags: ['tag1', 'tag2'], limits: VALID_LIMITS },
    });

    await initSaveForm(tab);

    expect(document.getElementById('title').value).toBe('Edited Title');
    expect(document.getElementById('description').value).toBe('Edited desc');
    expect(document.getElementById('save-form').hidden).toBe(false);
  });

  it('skips GET_TAGS, GET_LIMITS, and getPageData when cache is valid', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'T', description: 'D', tags: [] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: 'c', allTags: ['a'], limits: VALID_LIMITS },
    });

    await initSaveForm(tab);

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('applies cached limits (sets maxLength on inputs)', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'T', description: 'D', tags: [] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: '', allTags: ['a'], limits: VALID_LIMITS },
    });

    await initSaveForm(tab);

    expect(document.getElementById('title').maxLength).toBe(100);
    expect(document.getElementById('description').maxLength).toBe(1000);
  });
});

describe('initSaveForm — cache miss', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('fetches fresh data when draft URL does not match tab.url', async () => {
    const tab = makeTab('https://other.com');
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'T', description: 'D', tags: [] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: '', allTags: ['a'], limits: VALID_LIMITS },
    });
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(document.getElementById('url').value).toBe('https://other.com');
  });

  it('fetches fresh data when immutable cache has invalid limits', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'T', description: 'D', tags: [] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: '', allTags: ['a'], limits: { max_title_length: 0 } },
    });
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  it('fetches fresh data when immutable cache has non-array allTags', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'T', description: 'D', tags: [] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: '', allTags: 'not-an-array', limits: VALID_LIMITS },
    });
    mockPageData();
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  it('fetches fresh data when DRAFT_KEY exists but DRAFT_IMMUTABLE_KEY is missing', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'User Edited', description: 'User Desc', tags: ['my-tag'] },
    });
    mockPageData({ title: 'Scraped Title' });
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    // Fresh fetch replaces draft data — user edits are not preserved
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(document.getElementById('title').value).toBe('Scraped Title');
  });
});

describe('initSaveForm — error handling', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('shows "Invalid token." with settings link on 401 from GET_LIMITS', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: { success: false, status: 401 },
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    const status = document.getElementById('save-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('Invalid token.');
    expect(status.querySelector('a').textContent).toBe('Update in settings');
  });

  it('shows "Can\'t load account limits" on network failure', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: null,
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    const status = document.getElementById('save-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain("Can't load account limits");
  });

  it('shows "Can\'t load account limits" on malformed limits response', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: { success: true, data: { max_title_length: 'bad' } },
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    const status = document.getElementById('save-status');
    expect(status.textContent).toContain("Can't load account limits");
  });

  it('hides loading indicator and keeps form hidden on error', async () => {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: { success: false, status: 500 },
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(document.getElementById('loading-indicator').hidden).toBe(true);
    expect(document.getElementById('save-form').hidden).toBe(true);
  });
});

describe('handleSave', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  async function setupFormWithLimits(limitsOverrides = {}) {
    const tab = makeTab();
    mockPageData();
    mockMessages({
      GET_LIMITS: { success: true, data: { ...VALID_LIMITS, ...limitsOverrides } },
      GET_TAGS: validTagsResponse(),
    });
    await initSaveForm(tab);
    // Reset sendMessage for save assertions
    chrome.runtime.sendMessage.mockReset();
  }

  it('truncates title/description using dynamic limits', async () => {
    await setupFormWithLimits({ max_title_length: 10, max_description_length: 20 });
    document.getElementById('title').value = 'a'.repeat(50);
    document.getElementById('description').value = 'b'.repeat(50);
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await handleSave(new Event('submit', { cancelable: true }));

    const sentBookmark = chrome.runtime.sendMessage.mock.calls[0][0].bookmark;
    expect(sentBookmark.title.length).toBe(10);
    expect(sentBookmark.description.length).toBe(20);
  });

  it('truncates content using limits.max_bookmark_content_length', async () => {
    await setupFormWithLimits({ max_bookmark_content_length: 5 });
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await handleSave(new Event('submit', { cancelable: true }));

    const sentBookmark = chrome.runtime.sendMessage.mock.calls[0][0].bookmark;
    expect(sentBookmark.content.length).toBeLessThanOrEqual(5);
  });

  it('shows error if limits is null', async () => {
    resetState();
    setupPopupDOM();
    // Don't set up limits — they remain null

    await handleSave(new Event('submit', { cancelable: true }));

    const status = document.getElementById('save-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain("Can't load account limits");
  });

  it('calls clearDraft() on successful save', async () => {
    await setupFormWithLimits();
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await handleSave(new Event('submit', { cancelable: true }));

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([DRAFT_KEY, DRAFT_IMMUTABLE_KEY]);
  });

  it('sends correct bookmark payload via CREATE_BOOKMARK message', async () => {
    await setupFormWithLimits();
    document.getElementById('title').value = 'Test Title';
    document.getElementById('description').value = 'Test Desc';
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await handleSave(new Event('submit', { cancelable: true }));

    const msg = chrome.runtime.sendMessage.mock.calls[0][0];
    expect(msg.type).toBe('CREATE_BOOKMARK');
    expect(msg.bookmark.url).toBe('https://example.com');
    expect(msg.bookmark.title).toBe('Test Title');
    expect(msg.bookmark.description).toBe('Test Desc');
    expect(msg.bookmark.tags).toEqual(expect.any(Array));
  });
});

describe('handleSaveError', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
  });

  function getStatusText() {
    return document.getElementById('save-status').textContent;
  }

  function getStatusLink() {
    return document.getElementById('save-status').querySelector('a');
  }

  it('400 with detail array: joins messages', () => {
    handleSaveError({ status: 400, body: { detail: [{ msg: 'Field A invalid' }, { msg: 'Field B required' }] } });
    expect(getStatusText()).toContain('Field A invalid; Field B required');
  });

  it('422 with string detail: shows the string', () => {
    handleSaveError({ status: 422, body: { detail: 'URL is not valid' } });
    expect(getStatusText()).toContain('URL is not valid');
  });

  it('400 with no detail: shows "Invalid bookmark data"', () => {
    handleSaveError({ status: 400, body: {} });
    expect(getStatusText()).toContain('Invalid bookmark data');
  });

  it('401: shows "Invalid token." with settings link', () => {
    handleSaveError({ status: 401 });
    expect(getStatusText()).toContain('Invalid token.');
    expect(getStatusLink().textContent).toBe('Update in settings');
  });

  it('402 with body.detail: shows message with "Manage bookmarks" link', () => {
    handleSaveError({ status: 402, body: { detail: 'Free tier limit reached' } });
    expect(getStatusText()).toContain('Free tier limit reached');
    expect(getStatusLink().textContent).toBe('Manage bookmarks');
  });

  it('402 with no detail: falls back to "Bookmark limit reached."', () => {
    handleSaveError({ status: 402, body: {} });
    expect(getStatusText()).toContain('Bookmark limit reached.');
  });

  it('409 with ARCHIVED_URL_EXISTS: shows archived message with link', () => {
    handleSaveError({ status: 409, body: { error_code: 'ARCHIVED_URL_EXISTS', existing_bookmark_id: 'abc-123' } });
    expect(getStatusText()).toContain('This bookmark is archived.');
    const link = getStatusLink();
    expect(link.textContent).toBe('View it');
    expect(link.href).toContain('abc-123');
  });

  it('409 without ARCHIVED_URL_EXISTS: shows "Already saved"', () => {
    handleSaveError({ status: 409, body: {} });
    expect(getStatusText()).toContain('Already saved');
  });

  it('429: shows rate limit message with retry seconds', () => {
    handleSaveError({ status: 429, retryAfter: 30 });
    expect(getStatusText()).toContain('Rate limited');
    expect(getStatusText()).toContain('30');
  });

  it('451: shows "Accept terms first." with link', () => {
    handleSaveError({ status: 451 });
    expect(getStatusText()).toContain('Accept terms first.');
    expect(getStatusLink().textContent).toBe('Open Tiddly');
  });

  it('unknown status: shows response.error or fallback', () => {
    handleSaveError({ status: 503, error: 'Service unavailable' });
    expect(getStatusText()).toContain('Service unavailable');
  });

  it('no status: shows "Unexpected error (network)"', () => {
    handleSaveError({ error: null });
    expect(getStatusText()).toContain('Unexpected error (network)');
  });
});

describe('saveDraft / clearDraft', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('saveDraft writes DRAFT_KEY with url, title, description, tags', () => {
    document.getElementById('url').value = 'https://example.com';
    document.getElementById('title').value = 'My Title';
    document.getElementById('description').value = 'My Desc';

    saveDraft();

    const setCall = chrome.storage.local.set.mock.calls.find(call => DRAFT_KEY in call[0]);
    expect(setCall).toBeTruthy();
    const draft = setCall[0][DRAFT_KEY];
    expect(draft.url).toBe('https://example.com');
    expect(draft.title).toBe('My Title');
    expect(draft.description).toBe('My Desc');
    expect(draft.tags).toEqual([]);
  });

  it('clearDraft removes both DRAFT_KEY and DRAFT_IMMUTABLE_KEY', () => {
    clearDraft();

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([DRAFT_KEY, DRAFT_IMMUTABLE_KEY]);
  });
});
