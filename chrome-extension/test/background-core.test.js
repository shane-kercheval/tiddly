import {
  API_URL,
  handleGetLimits,
  handleGetTags,
  handleCreateBookmark,
  handleSearchBookmarks,
  getToken,
} from '../background-core.js';

// --- Fetch mock helper ---

function mockFetch(status, body, headers = {}) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      headers: { get: (name) => headers[name] ?? null },
    })
  );
}

function mockFetchError(error) {
  globalThis.fetch = vi.fn(() => Promise.reject(error));
}

describe('getToken', () => {
  it('returns the stored token', async () => {
    chrome.storage.local.get.mockResolvedValue({ token: 'my-pat' });
    const token = await getToken();
    expect(token).toBe('my-pat');
  });

  it('throws when no token is configured', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    await expect(getToken()).rejects.toThrow('Not configured');
  });
});

describe('handleGetLimits', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({ token: 'test-token' });
  });

  it('calls correct endpoint with auth headers', async () => {
    const limitsData = { max_title_length: 100, max_description_length: 1000, max_bookmark_content_length: 100000 };
    mockFetch(200, limitsData);

    await handleGetLimits();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_URL}/users/me/limits`,
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
          'X-Request-Source': 'chrome-extension',
        }),
      })
    );
  });

  it('returns { success: true, data } on 200', async () => {
    const limitsData = { max_title_length: 100 };
    mockFetch(200, limitsData);

    const result = await handleGetLimits();

    expect(result).toEqual({ success: true, data: limitsData });
  });

  it('returns { success: false, status } on non-200', async () => {
    mockFetch(403, {});

    const result = await handleGetLimits();

    expect(result).toEqual({ success: false, status: 403 });
  });

  it('throws on missing token', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    await expect(handleGetLimits()).rejects.toThrow('Not configured');
  });
});

describe('handleGetTags', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({ token: 'test-token' });
  });

  it('returns { success: true, data } on 200', async () => {
    const tagsData = { tags: [{ name: 'js' }] };
    mockFetch(200, tagsData);

    const result = await handleGetTags();

    expect(result).toEqual({ success: true, data: tagsData });
  });

  it('returns { success: false, status } on non-200', async () => {
    mockFetch(500, {});

    const result = await handleGetTags();

    expect(result).toEqual({ success: false, status: 500 });
  });

  it('throws on missing token', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    await expect(handleGetTags()).rejects.toThrow('Not configured');
  });
});

describe('handleCreateBookmark', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({ token: 'test-token' });
  });

  it('sends correct payload and returns success', async () => {
    const bookmark = { url: 'https://example.com', title: 'Test', description: '', tags: [] };
    const responseData = { id: '123', ...bookmark };
    mockFetch(201, responseData);

    const result = await handleCreateBookmark({ bookmark });

    expect(result).toEqual({ success: true, bookmark: responseData });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_URL}/bookmarks/`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(bookmark),
      })
    );
  });

  it('returns error response with status, body, and retryAfter', async () => {
    mockFetch(429, { detail: 'Too many requests' }, { 'Retry-After': '60' });

    const result = await handleCreateBookmark({ bookmark: {} });

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ detail: 'Too many requests' });
    expect(result.retryAfter).toBe('60');
  });

  it('throws on missing token', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    await expect(handleCreateBookmark({ bookmark: {} })).rejects.toThrow('Not configured');
  });
});

describe('handleSearchBookmarks', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({ token: 'test-token' });
  });

  it('returns search results on success', async () => {
    const data = { items: [{ id: '1', url: 'https://example.com' }], has_more: false };
    mockFetch(200, data);

    const result = await handleSearchBookmarks({ query: 'test', limit: 10, offset: 0 });

    expect(result).toEqual({ success: true, data });
  });

  it('passes query params correctly', async () => {
    mockFetch(200, { items: [] });

    await handleSearchBookmarks({ query: 'hello', limit: 5, offset: 10 });

    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('q=hello');
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=10');
  });

  it('does not set sort_by or sort_order when not provided', async () => {
    mockFetch(200, { items: [] });

    await handleSearchBookmarks({ limit: 10, offset: 0 });

    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).not.toContain('sort_by=');
    expect(url).not.toContain('sort_order=');
    expect(url).not.toContain('q=');
  });

  it('passes sort_by and sort_order when provided', async () => {
    mockFetch(200, { items: [] });

    await handleSearchBookmarks({ query: 'test', limit: 10, offset: 0, sort_by: 'title', sort_order: 'asc' });

    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('sort_by=title');
    expect(url).toContain('sort_order=asc');
  });

  it('passes tags as repeated params with tag_match', async () => {
    mockFetch(200, { items: [] });

    await handleSearchBookmarks({ limit: 10, offset: 0, tags: ['python', 'rust'] });

    const url = globalThis.fetch.mock.calls[0][0];
    const params = new URL(url).searchParams;
    expect(params.getAll('tags')).toEqual(['python', 'rust']);
    expect(params.get('tag_match')).toBe('all');
  });

  it('uses custom tag_match when provided', async () => {
    mockFetch(200, { items: [] });

    await handleSearchBookmarks({ limit: 10, offset: 0, tags: ['python'], tag_match: 'any' });

    const url = globalThis.fetch.mock.calls[0][0];
    const params = new URL(url).searchParams;
    expect(params.get('tag_match')).toBe('any');
  });

  it('does not add tags params when tags array is empty', async () => {
    mockFetch(200, { items: [] });

    await handleSearchBookmarks({ limit: 10, offset: 0, tags: [] });

    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).not.toContain('tags=');
    expect(url).not.toContain('tag_match=');
  });

  it('backward compat: message without tags/sort still works', async () => {
    const data = { items: [{ id: '1' }], has_more: false };
    mockFetch(200, data);

    const result = await handleSearchBookmarks({ query: 'test', limit: 10, offset: 0 });

    expect(result).toEqual({ success: true, data });
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('q=test');
    expect(url).toContain('limit=10');
  });
});
