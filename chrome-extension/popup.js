const setupView = document.getElementById('setup-view');
const saveView = document.getElementById('save-view');
const searchView = document.getElementById('search-view');

function isRestrictedPage(url) {
  return !url || /^(chrome|about|chrome-extension|devtools|edge|data|blob|view-source):/.test(url);
}

async function init() {
  const { token } = await chrome.storage.local.get(['token']);

  if (!token) {
    showView('setup');
    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (isRestrictedPage(tab?.url)) {
    await initSearchView();
    return;
  }

  showView('save');
  await initSaveForm(tab);
}

function showView(name) {
  setupView.hidden = name !== 'setup';
  saveView.hidden = name !== 'save';
  searchView.hidden = name !== 'search';
}

// Settings links
document.getElementById('save-settings-link')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('search-settings-link')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// --- Save form ---

// Practical cap for DOM text extraction to avoid freezing the page. The server's
// max_bookmark_content_length may exceed this for higher tiers (e.g. PRO = 1,000,000),
// meaning some page content may not be captured via the extension. This is an accepted
// limitation — the extension is a convenience tool, not the primary interface.
const SCRAPE_CAP = 200000;
const INITIAL_CHIPS_COUNT = 8;

const saveForm = document.getElementById('save-form');
const loadingIndicator = document.getElementById('loading-indicator');
const urlInput = document.getElementById('url');
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const titleLimit = document.getElementById('title-limit');
const descriptionLimit = document.getElementById('description-limit');
const tagsInput = document.getElementById('tags-input');
const tagChipsContainer = document.getElementById('tag-chips');
const tagSuggestions = document.getElementById('tag-suggestions');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const clearTagsBtn = document.getElementById('clear-tags');

let pageContent = '';
let allTags = [];
let selectedTags = new Set();
let defaultTagSet = new Set();
let showingAllTags = false;
let limits = null;

const DRAFT_KEY = 'draft';
const DRAFT_IMMUTABLE_KEY = 'draftImmutable';

function characterLimitMessage(limit) {
  return `Character limit reached (${limit.toLocaleString()})`;
}

function updateLimitFeedback(input, feedbackEl, maxLength) {
  if (input.value.length >= maxLength) {
    feedbackEl.textContent = characterLimitMessage(maxLength);
    feedbackEl.hidden = false;
  } else {
    feedbackEl.hidden = true;
  }
}

function applyLimits(limitsObj) {
  limits = limitsObj;
  titleInput.maxLength = limitsObj.max_title_length;
  descriptionInput.maxLength = limitsObj.max_description_length;
  if (pageContent.length > limitsObj.max_bookmark_content_length) {
    pageContent = pageContent.substring(0, limitsObj.max_bookmark_content_length);
  }
}

function isValidLimits(obj) {
  return obj
    && typeof obj.max_title_length === 'number' && obj.max_title_length > 0
    && typeof obj.max_description_length === 'number' && obj.max_description_length > 0
    && typeof obj.max_bookmark_content_length === 'number' && obj.max_bookmark_content_length > 0;
}

function saveDraft() {
  chrome.storage.local.set({
    [DRAFT_KEY]: {
      url: urlInput.value,
      title: titleInput.value,
      description: descriptionInput.value,
      tags: [...selectedTags],
    }
  });
}

function clearDraft() {
  chrome.storage.local.remove([DRAFT_KEY, DRAFT_IMMUTABLE_KEY]);
}

async function getPageData(tab) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (maxLen) => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content
          || document.querySelector('meta[property="og:description"]')?.content
          || '',
        content: document.body.innerText.substring(0, maxLen)
      }),
      args: [SCRAPE_CAP]
    });
    return result.result;
  } catch {
    return { title: tab.title || '', description: '', content: '' };
  }
}

async function initSaveForm(tab) {
  const storage = await chrome.storage.local.get([
    'defaultTags', 'lastUsedTags', DRAFT_KEY, DRAFT_IMMUTABLE_KEY
  ]);

  const draft = storage[DRAFT_KEY];
  const immutable = storage[DRAFT_IMMUTABLE_KEY];
  const hasCachedData = draft
    && immutable
    && draft.url === tab.url
    && immutable.url === tab.url
    && Array.isArray(immutable.allTags)
    && isValidLimits(immutable.limits);

  const defaultTags = storage.defaultTags || [];
  const lastUsedTags = storage.lastUsedTags || [];
  defaultTagSet = new Set(defaultTags);

  if (hasCachedData) {
    // Restore from cache — skip all API calls and page scraping
    urlInput.value = tab.url;
    titleInput.value = draft.title;
    descriptionInput.value = draft.description;
    pageContent = immutable.pageContent || '';
    allTags = immutable.allTags;
    (draft.tags || []).forEach(t => selectedTags.add(t));
    applyLimits(immutable.limits);
  } else {
    // Fresh fetch — fire page scrape, GET_LIMITS, and GET_TAGS in parallel
    urlInput.value = tab.url;

    const [pageData, limitsResult, tagsResult] = await Promise.all([
      getPageData(tab),
      chrome.runtime.sendMessage({ type: 'GET_LIMITS' }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'GET_TAGS' }).catch(() => null),
    ]);

    // Validate limits
    if (!limitsResult?.success || !isValidLimits(limitsResult.data)) {
      loadingIndicator.hidden = true;
      if (limitsResult?.status === 401) {
        showSaveStatus('Invalid token.', 'error', {
          text: 'Update in settings',
          onClick: () => chrome.runtime.openOptionsPage()
        });
      } else {
        showSaveStatus("Can't load account limits", 'error');
      }
      return;
    }

    pageContent = pageData.content || '';
    applyLimits(limitsResult.data);

    titleInput.value = (pageData.title || '').substring(0, limits.max_title_length);
    descriptionInput.value = (pageData.description || '').substring(0, limits.max_description_length);

    let tagsSuccess = false;
    if (tagsResult?.success && Array.isArray(tagsResult.data?.tags)) {
      allTags = tagsResult.data.tags.map(t => t.name);
      tagsSuccess = true;
    }

    [...new Set([...defaultTags, ...lastUsedTags])].forEach(t => selectedTags.add(t));

    // Cache immutable data only if both limits and tags succeeded
    if (tagsSuccess) {
      chrome.storage.local.set({
        [DRAFT_IMMUTABLE_KEY]: {
          url: tab.url,
          pageContent,
          allTags,
          limits: limitsResult.data,
        }
      });
    }

    saveDraft();
  }

  renderTagChips();

  loadingIndicator.hidden = true;
  saveForm.hidden = false;

  titleInput.addEventListener('input', () => {
    saveDraft();
    updateLimitFeedback(titleInput, titleLimit, limits.max_title_length);
  });
  descriptionInput.addEventListener('input', () => {
    saveDraft();
    updateLimitFeedback(descriptionInput, descriptionLimit, limits.max_description_length);
  });

  // Show feedback if pre-populated values are at the limit
  updateLimitFeedback(titleInput, titleLimit, limits.max_title_length);
  updateLimitFeedback(descriptionInput, descriptionLimit, limits.max_description_length);

  tagsInput.addEventListener('input', () => {
    renderTagChips();
  });

  clearTagsBtn.addEventListener('click', () => {
    selectedTags = new Set(defaultTagSet);
    tagsInput.value = '';
    renderTagChips();
    saveDraft();
  });

  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newTag = tagsInput.value.trim().toLowerCase().replace(/_/g, '-');
      if (newTag) {
        selectedTags.add(newTag);
        tagsInput.value = '';
        renderTagChips();
        saveDraft();
      }
    }
  });

  saveForm.addEventListener('submit', handleSave);
}

function renderTagChips() {
  const filterText = tagsInput.value.trim().toLowerCase();
  tagChipsContainer.replaceChildren();
  tagSuggestions.replaceChildren();

  let visibleTags = allTags;
  if (filterText) {
    visibleTags = allTags.filter(t => t.includes(filterText));
  }

  // Always include selected tags in the visible set, even when collapsed (#7)
  // Include custom tags (not in allTags) so they remain visible and removable
  const customSelected = [...selectedTags].filter(t => !allTags.includes(t));
  let tagsToShow;
  if (showingAllTags || filterText) {
    tagsToShow = [...visibleTags, ...customSelected.filter(t => !filterText || t.includes(filterText))];
  } else {
    const topTags = visibleTags.slice(0, INITIAL_CHIPS_COUNT);
    const selectedNotInTop = [...selectedTags].filter(
      t => !topTags.includes(t)
    );
    tagsToShow = [...topTags, ...selectedNotInTop];
  }

  tagsToShow.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip' + (selectedTags.has(tag) ? ' selected' : '');
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      // Clear filter text when selecting via chip (#1)
      tagsInput.value = '';
      renderTagChips();
      saveDraft();
    });
    tagChipsContainer.appendChild(chip);
  });

  if (!filterText && !showingAllTags && visibleTags.length > INITIAL_CHIPS_COUNT) {
    tagSuggestions.hidden = false;
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'show-all-link';
    link.textContent = `Show all (${visibleTags.length})`;
    link.addEventListener('click', () => {
      showingAllTags = true;
      renderTagChips();
    });
    tagSuggestions.appendChild(link);
  } else {
    tagSuggestions.hidden = true;
  }

  if (showingAllTags && !filterText && tagsToShow.length > INITIAL_CHIPS_COUNT) {
    tagChipsContainer.classList.add('all-tags');
  } else {
    tagChipsContainer.classList.remove('all-tags');
  }

  const hasNonDefaultSelected = [...selectedTags].some(t => !defaultTagSet.has(t));
  clearTagsBtn.hidden = !hasNonDefaultSelected;
}

function getSelectedTags() {
  return [...selectedTags];
}

async function handleSave(e) {
  e.preventDefault();
  if (!limits) {
    showSaveStatus("Can't load account limits", 'error');
    return;
  }
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  saveStatus.hidden = true;

  const tags = getSelectedTags();
  const bookmark = {
    url: urlInput.value,
    title: titleInput.value.substring(0, limits.max_title_length),
    description: descriptionInput.value.substring(0, limits.max_description_length),
    content: pageContent.substring(0, limits.max_bookmark_content_length),
    tags
  };

  let success = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CREATE_BOOKMARK', bookmark });

    if (response?.success) {
      success = true;
      flashButtonSuccess(saveBtn, 'Save Bookmark');
      chrome.storage.local.set({ lastUsedTags: tags });
      clearDraft();
    } else if (response) {
      handleSaveError(response);
    } else {
      showSaveStatus("Can't reach extension — try reloading", 'error');
    }
  } catch {
    showSaveStatus("Can't reach extension — try reloading", 'error');
  } finally {
    if (!success) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Bookmark';
    }
  }
}

function handleSaveError(response) {
  const { status, body, retryAfter } = response;

  if (status === 400 || status === 422) {
    let message = 'Invalid bookmark data';
    if (Array.isArray(body?.detail)) {
      message = body.detail.map(e => e.msg).join('; ');
    } else if (typeof body?.detail === 'string') {
      message = body.detail;
    }
    showSaveStatus(message, 'error');
    return;
  }

  if (status === 401) {
    showSaveStatus('Invalid token.', 'error', {
      text: 'Update in settings',
      onClick: () => chrome.runtime.openOptionsPage()
    });
    return;
  }

  if (status === 402) {
    showSaveStatus(body?.detail || 'Bookmark limit reached.', 'error', {
      text: 'Manage bookmarks',
      href: 'https://tiddly.me/app/bookmarks'
    });
    return;
  }

  if (status === 409) {
    if (body?.error_code === 'ARCHIVED_URL_EXISTS' && body?.existing_bookmark_id) {
      showSaveStatus('This bookmark is archived.', 'info', {
        text: 'View it',
        href: `https://tiddly.me/app/bookmarks/${encodeURIComponent(body.existing_bookmark_id)}`
      });
    } else {
      showSaveStatus('Already saved', 'info');
    }
    return;
  }

  if (status === 429) {
    const seconds = retryAfter || '?';
    showSaveStatus(`Rate limited — try again in ${seconds}s`, 'error');
    return;
  }

  if (status === 451) {
    showSaveStatus('Accept terms first.', 'error', {
      text: 'Open Tiddly',
      href: 'https://tiddly.me'
    });
    return;
  }

  showSaveStatus(
    response.error || `Unexpected error (${status || 'network'})`,
    'error'
  );
}

let flashTimerId = null;

function flashButtonSuccess(btn, originalText) {
  clearTimeout(flashTimerId);
  btn.textContent = '\u2713 Saved';
  btn.classList.add('btn-success');
  btn.disabled = false;
  flashTimerId = setTimeout(() => {
    btn.textContent = originalText;
    btn.classList.remove('btn-success');
  }, 2000);
}

// DOM-based status rendering — no innerHTML, structurally safe (#2)
function showSaveStatus(message, type, link) {
  saveStatus.replaceChildren();
  saveStatus.appendChild(document.createTextNode(message));
  if (link) {
    const a = document.createElement('a');
    a.textContent = link.text;
    if (link.href) {
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    if (link.onClick) {
      a.addEventListener('click', link.onClick);
    }
    saveStatus.appendChild(document.createTextNode(' '));
    saveStatus.appendChild(a);
  }
  saveStatus.className = `status ${type}`;
  saveStatus.hidden = false;
}

// --- Search view ---

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchLoading = document.getElementById('search-loading');
const loadMoreBtn = document.getElementById('load-more');

let searchOffset = 0;
let searchDebounceTimer = null;
let searchRequestId = 0;

async function initSearchView() {
  showView('search');
  loadBookmarks('', 0, false);

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      searchOffset = 0;
      loadBookmarks(searchInput.value.trim(), 0, false);
    }, 300);
  });

  loadMoreBtn.addEventListener('click', () => {
    loadBookmarks(searchInput.value.trim(), searchOffset, true);
  });
}

async function loadBookmarks(query, offset, append) {
  const requestId = ++searchRequestId;
  loadMoreBtn.hidden = true;
  if (!append) {
    loadMoreBtn.disabled = true;
    searchLoading.hidden = false;
    searchResults.replaceChildren();
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage(
      { type: 'SEARCH_BOOKMARKS', query, offset, limit: 10 }
    );
  } catch {
    response = null;
  }

  // Ignore stale responses (#4)
  if (requestId !== searchRequestId) return;

  searchLoading.hidden = true;
  loadMoreBtn.disabled = false;

  if (!response?.success) {
    const msg = document.createElement('p');
    msg.className = 'empty-state';
    if (response?.status === 401) {
      msg.textContent = 'Invalid token — update in settings';
    } else {
      msg.textContent = "Can't reach server — check your connection";
    }
    searchResults.appendChild(msg);
    if (append) loadMoreBtn.hidden = false;
    return;
  }

  const items = response.data?.items ?? [];
  const has_more = response.data?.has_more ?? false;

  if (items.length === 0 && !append) {
    const msg = document.createElement('p');
    msg.className = 'empty-state';
    msg.textContent = query ? 'No results' : 'No bookmarks yet';
    searchResults.appendChild(msg);
    return;
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'search-result';

    const titleRow = document.createElement('div');
    titleRow.className = 'search-result-title-row';

    const favicon = document.createElement('img');
    favicon.className = 'search-result-favicon';
    favicon.width = 16;
    favicon.height = 16;
    favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;
    favicon.alt = '';
    favicon.onerror = () => favicon.remove();
    titleRow.appendChild(favicon);

    const title = document.createElement('a');
    title.className = 'search-result-title';
    title.textContent = item.title || item.url;
    title.href = item.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: item.url });
    });
    titleRow.appendChild(title);
    el.appendChild(titleRow);

    const url = document.createElement('div');
    url.className = 'search-result-url';
    url.textContent = item.url;
    el.appendChild(url);

    const meta = document.createElement('div');
    meta.className = 'search-result-meta';

    if (item.tags && item.tags.length > 0) {
      item.tags.forEach(t => {
        const tag = document.createElement('span');
        tag.className = 'search-result-tag';
        tag.textContent = t;
        meta.appendChild(tag);
      });
    }

    if (meta.childNodes.length > 0) {
      el.appendChild(meta);
    }

    searchResults.appendChild(el);
  });

  searchOffset = offset + items.length;
  loadMoreBtn.hidden = !has_more;
}

// --- Init ---
init().catch(() => {
  document.getElementById('popup').textContent = 'Something went wrong. Try reopening the extension.';
});
