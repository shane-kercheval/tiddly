import { resetChromeStorage, setupPopupDOM, mockMessages } from './setup.js';
import {
  SCRAPE_CAP, DRAFT_KEY, DRAFT_IMMUTABLE_KEY,
  isRestrictedPage, isValidLimits, counterText,
  updateLimitFeedback, updateSaveButtonState, applyLimits,
  setupDOM, resetState,
  saveDraft, clearDraft, getPageData,
  initSaveForm, handleSave, handleSaveError,
  showSaveStatus,
  initSearchView, loadBookmarks,
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

describe('counterText', () => {
  it('formats small numbers', () => {
    expect(counterText(70, 100)).toBe('70 / 100');
  });

  it('uses toLocaleString for large numbers', () => {
    const text = counterText(1000, 5000);
    expect(text).toContain('1');
    expect(text).toContain('000');
    expect(text).toContain('5');
  });
});

// --- DOM-dependent tests ---

describe('updateLimitFeedback', () => {
  let input, feedback;

  beforeEach(() => {
    input = document.createElement('input');
    feedback = document.createElement('span');
  });

  it('hides feedback below 70%', () => {
    input.value = 'a'.repeat(69);
    const result = updateLimitFeedback(input, feedback, 100);
    expect(feedback.style.visibility).toBe('hidden');
    expect(feedback.children.length).toBe(0);
    expect(feedback.style.color).toBe('');
    expect(result).toBe(false);
  });

  it('shows count at 70% with color set', () => {
    input.value = 'a'.repeat(70);
    const result = updateLimitFeedback(input, feedback, 100);
    expect(feedback.style.visibility).toBe('visible');
    expect(feedback.children.length).toBe(1);
    expect(feedback.children[0].textContent).toBe('70 / 100');
    expect(feedback.style.color).not.toBe('');
    expect(result).toBe(false);
  });

  it('shows count at 85% with different color than 70%', () => {
    input.value = 'a'.repeat(70);
    updateLimitFeedback(input, feedback, 100);
    const colorAt70 = feedback.style.color;

    input.value = 'a'.repeat(85);
    updateLimitFeedback(input, feedback, 100);
    const colorAt85 = feedback.style.color;

    expect(colorAt85).not.toBe(colorAt70);
    expect(feedback.children[0].textContent).toBe('85 / 100');
  });

  it('shows "Character limit reached" at exactly 100%', () => {
    input.value = 'a'.repeat(100);
    const result = updateLimitFeedback(input, feedback, 100);
    expect(feedback.style.visibility).toBe('visible');
    expect(feedback.children.length).toBe(2);
    expect(feedback.children[0].textContent).toBe('Character limit reached');
    expect(feedback.children[1].textContent).toBe('100 / 100');
    expect(result).toBe(false);
  });

  it('shows exceeded message above 100% and returns true', () => {
    input.value = 'a'.repeat(105);
    const result = updateLimitFeedback(input, feedback, 100);
    expect(feedback.style.visibility).toBe('visible');
    expect(feedback.children.length).toBe(2);
    expect(feedback.children[0].textContent).toBe('Character limit exceeded - saving is disabled');
    expect(feedback.children[1].textContent).toBe('105 / 100');
    expect(input.classList.contains('input-exceeded')).toBe(true);
    expect(result).toBe(true);
  });

  it('clears exceeded state when transitioning back below 70%', () => {
    input.value = 'a'.repeat(105);
    updateLimitFeedback(input, feedback, 100);
    expect(input.classList.contains('input-exceeded')).toBe(true);

    input.value = 'a'.repeat(50);
    updateLimitFeedback(input, feedback, 100);
    expect(input.classList.contains('input-exceeded')).toBe(false);
    expect(feedback.style.visibility).toBe('hidden');
    expect(feedback.children.length).toBe(0);
    expect(feedback.style.color).toBe('');
  });

  it('uses dark mode colors when prefers-color-scheme is dark', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));

    input.value = 'a'.repeat(85);
    updateLimitFeedback(input, feedback, 100);
    const darkColor = feedback.style.color;

    window.matchMedia = vi.fn(() => ({ matches: false }));
    updateLimitFeedback(input, feedback, 100);
    const lightColor = feedback.style.color;

    expect(darkColor).not.toBe(lightColor);
  });
});

describe('applyLimits', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('does not set maxLength on inputs', () => {
    const titleInput = document.getElementById('title');
    const descInput = document.getElementById('description');
    const titleMaxBefore = titleInput.maxLength;
    const descMaxBefore = descInput.maxLength;
    applyLimits(VALID_LIMITS);
    expect(titleInput.maxLength).toBe(titleMaxBefore);
    expect(descInput.maxLength).toBe(descMaxBefore);
  });
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

  it('does not truncate scraped title/description and disables save when exceeded', async () => {
    const tab = makeTab();
    const longTitle = 'a'.repeat(200);
    const longDesc = 'b'.repeat(2000);
    mockPageData({ title: longTitle, description: longDesc });
    mockMessages({
      GET_LIMITS: validLimitsResponse(),
      GET_TAGS: validTagsResponse(),
    });

    await initSaveForm(tab);

    expect(document.getElementById('title').value.length).toBe(200);
    expect(document.getElementById('description').value.length).toBe(2000);
    expect(document.getElementById('save-btn').disabled).toBe(true);
    const titleFeedback = document.getElementById('title-limit');
    expect(titleFeedback.style.visibility).toBe('visible');
    expect(titleFeedback.textContent).toContain('Character limit exceeded');
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

    const titleFeedback = document.getElementById('title-limit');
    expect(titleFeedback.style.visibility).toBe('visible');
    expect(titleFeedback.children[0].textContent).toBe('Character limit reached');
    expect(titleFeedback.children[1].textContent).toBe('100 / 100');
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

  it('applies cached limits without setting maxLength', async () => {
    const tab = makeTab();
    chrome.storage.local.set({
      [DRAFT_KEY]: { url: 'https://example.com', title: 'T', description: 'D', tags: [] },
      [DRAFT_IMMUTABLE_KEY]: { url: 'https://example.com', pageContent: '', allTags: ['a'], limits: VALID_LIMITS },
    });

    const titleInput = document.getElementById('title');
    const maxBefore = titleInput.maxLength;

    await initSaveForm(tab);

    expect(titleInput.maxLength).toBe(maxBefore);
    expect(document.getElementById('save-form').hidden).toBe(false);
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

  it('sends title/description without truncation', async () => {
    await setupFormWithLimits();
    document.getElementById('title').value = 'Test Title';
    document.getElementById('description').value = 'Test Description';
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await handleSave(new Event('submit', { cancelable: true }));

    const sentBookmark = chrome.runtime.sendMessage.mock.calls[0][0].bookmark;
    expect(sentBookmark.title).toBe('Test Title');
    expect(sentBookmark.description).toBe('Test Description');
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

  it('402 with resource and limit: shows structured message with pricing link', () => {
    handleSaveError({ status: 402, body: { error_code: 'QUOTA_EXCEEDED', resource: 'bookmark', limit: 10, current: 10 } });
    expect(getStatusText()).toContain('limit of 10 bookmarks');
    expect(getStatusLink().textContent).toBe('Manage your plan');
    expect(getStatusLink().href).toContain('/pricing');
  });

  it('402 with no structured fields: falls back to generic message', () => {
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

  it('429: shows rate limit message with retry seconds and pricing link', () => {
    handleSaveError({ status: 429, retryAfter: 30 });
    expect(getStatusText()).toContain('Rate limited');
    expect(getStatusText()).toContain('30');
    expect(getStatusLink().textContent).toBe('Higher limits available');
    expect(getStatusLink().href).toContain('/pricing');
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

describe('updateSaveButtonState', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  async function setupWithLimits(limitsOverrides = {}) {
    const tab = makeTab();
    mockPageData({ title: 'Short', description: 'Short' });
    mockMessages({
      GET_LIMITS: { success: true, data: { ...VALID_LIMITS, ...limitsOverrides } },
      GET_TAGS: validTagsResponse(),
    });
    await initSaveForm(tab);
  }

  it('disables save when title exceeds limit', async () => {
    await setupWithLimits({ max_title_length: 10 });
    document.getElementById('title').value = 'a'.repeat(11);
    updateSaveButtonState();
    expect(document.getElementById('save-btn').disabled).toBe(true);
  });

  it('disables save when description exceeds limit', async () => {
    await setupWithLimits({ max_description_length: 10 });
    document.getElementById('description').value = 'a'.repeat(11);
    updateSaveButtonState();
    expect(document.getElementById('save-btn').disabled).toBe(true);
  });

  it('re-enables save when both fields are within limits', async () => {
    await setupWithLimits({ max_title_length: 10 });
    document.getElementById('title').value = 'a'.repeat(11);
    updateSaveButtonState();
    expect(document.getElementById('save-btn').disabled).toBe(true);

    document.getElementById('title').value = 'a'.repeat(5);
    updateSaveButtonState();
    expect(document.getElementById('save-btn').disabled).toBe(false);
  });

  it('does not throw when limits is null', () => {
    expect(() => updateSaveButtonState()).not.toThrow();
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

// --- Search view tests ---

function searchResponse(items = [], has_more = false) {
  return { success: true, data: { items, has_more } };
}

describe('initSearchView', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('fetches tags and shows them in dropdown on focus', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    const tagInput = document.getElementById('search-tag-input');
    tagInput.dispatchEvent(new Event('focus'));

    const dropdown = document.getElementById('search-tag-dropdown');
    expect(dropdown.hidden).toBe(false);
    expect(dropdown.querySelectorAll('.search-tag-dropdown-item').length).toBe(VALID_TAGS.length);
  });

  it('filters tags by text input', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    const tagInput = document.getElementById('search-tag-input');
    tagInput.value = 'py';
    tagInput.dispatchEvent(new Event('input'));

    const dropdown = document.getElementById('search-tag-dropdown');
    const items = dropdown.querySelectorAll('.search-tag-dropdown-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('python');
  });

  it('still works if GET_TAGS fails', async () => {
    mockMessages({
      GET_TAGS: { success: false, status: 500 },
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    const tagInput = document.getElementById('search-tag-input');
    tagInput.dispatchEvent(new Event('focus'));

    const dropdown = document.getElementById('search-tag-dropdown');
    expect(dropdown.querySelectorAll('.search-tag-dropdown-item').length).toBe(0);
  });

  it('sends initial search with default sort_by=created_at and sort_order=desc', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();

    const searchCall = chrome.runtime.sendMessage.mock.calls.find(
      c => c[0].type === 'SEARCH_BOOKMARKS'
    );
    expect(searchCall).toBeTruthy();
    expect(searchCall[0].sort_by).toBe('created_at');
    expect(searchCall[0].sort_order).toBe('desc');
  });
});

describe('search tag filtering', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  function selectTagFromDropdown(tagName) {
    const tagInput = document.getElementById('search-tag-input');
    tagInput.dispatchEvent(new Event('focus'));
    const items = document.querySelectorAll('.search-tag-dropdown-item');
    const item = [...items].find(i => i.textContent === tagName);
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }

  it('selecting a tag adds a chip and triggers search with tags param', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });

    selectTagFromDropdown('python');
    await new Promise(r => setTimeout(r, 0));

    // Chip should appear
    const chips = document.getElementById('search-active-tags');
    expect(chips.children.length).toBe(1);
    expect(chips.children[0].textContent).toContain('python');

    // Input should be cleared
    expect(document.getElementById('search-tag-input').value).toBe('');

    // Search should include tags
    const searchCall = chrome.runtime.sendMessage.mock.calls.find(
      c => c[0].type === 'SEARCH_BOOKMARKS'
    );
    expect(searchCall[0].tags).toEqual(['python']);
  });

  it('selecting multiple tags passes all tags to search', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });
    selectTagFromDropdown('python');
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });
    selectTagFromDropdown('rust');
    await new Promise(r => setTimeout(r, 0));

    const searchCall = chrome.runtime.sendMessage.mock.calls.find(
      c => c[0].type === 'SEARCH_BOOKMARKS'
    );
    expect(searchCall[0].tags).toEqual(expect.arrayContaining(['python', 'rust']));
    expect(searchCall[0].tags.length).toBe(2);
  });

  it('selected tags are excluded from dropdown', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });
    selectTagFromDropdown('python');
    await new Promise(r => setTimeout(r, 0));

    // Open dropdown again — python should not appear
    const tagInput = document.getElementById('search-tag-input');
    tagInput.dispatchEvent(new Event('focus'));
    const items = document.querySelectorAll('.search-tag-dropdown-item');
    const itemTexts = [...items].map(i => i.textContent);
    expect(itemTexts).not.toContain('python');
    expect(items.length).toBe(VALID_TAGS.length - 1);
  });

  it('removing a tag chip removes it from filter and re-triggers search', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });
    selectTagFromDropdown('python');
    await new Promise(r => setTimeout(r, 0));

    // Remove the tag
    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });
    const removeBtn = document.querySelector('.search-active-tag .remove-tag');
    removeBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Chips should be empty
    expect(document.getElementById('search-active-tags').children.length).toBe(0);

    // Search should not have tags
    const searchCall = chrome.runtime.sendMessage.mock.calls.find(
      c => c[0].type === 'SEARCH_BOOKMARKS'
    );
    expect(searchCall[0].tags).toBeUndefined();
  });
});

describe('search sort', () => {
  beforeEach(() => {
    resetState();
    setupPopupDOM();
    resetChromeStorage();
  });

  it('changing sort triggers search with correct sort_by', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });

    const sortSelect = document.getElementById('search-sort-select');
    sortSelect.value = 'last_used_at';
    sortSelect.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));

    const searchCall = chrome.runtime.sendMessage.mock.calls.find(
      c => c[0].type === 'SEARCH_BOOKMARKS'
    );
    expect(searchCall[0].sort_by).toBe('last_used_at');
    expect(searchCall[0].sort_order).toBe('desc');
  });

  it('title sort uses asc order', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    chrome.runtime.sendMessage.mockReset();
    mockMessages({ SEARCH_BOOKMARKS: searchResponse() });

    const sortSelect = document.getElementById('search-sort-select');
    sortSelect.value = 'title';
    sortSelect.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));

    const searchCall = chrome.runtime.sendMessage.mock.calls.find(
      c => c[0].type === 'SEARCH_BOOKMARKS'
    );
    expect(searchCall[0].sort_by).toBe('title');
    expect(searchCall[0].sort_order).toBe('asc');
  });

  it('relevance option is always visible in sort dropdown', async () => {
    mockMessages({
      GET_TAGS: validTagsResponse(),
      SEARCH_BOOKMARKS: searchResponse(),
    });

    await initSearchView();
    await new Promise(r => setTimeout(r, 0));

    const sortSelect = document.getElementById('search-sort-select');
    const relevanceOption = sortSelect.querySelector('option[value="relevance"]');
    expect(relevanceOption).not.toBeNull();
    expect(relevanceOption.hidden).toBe(false);
  });
});
