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

// --- Save form ---

const MAX_CONTENT_LENGTH = 100000;
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const INITIAL_CHIPS_COUNT = 8;

const saveForm = document.getElementById('save-form');
const loadingIndicator = document.getElementById('loading-indicator');
const urlInput = document.getElementById('url');
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const tagsInput = document.getElementById('tags-input');
const tagChipsContainer = document.getElementById('tag-chips');
const tagSuggestions = document.getElementById('tag-suggestions');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');

let pageContent = '';
let allTags = [];
let selectedTags = new Set();
let showingAllTags = false;

async function getPageData(tab) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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
  } catch {
    return { url: tab.url, title: tab.title || '', description: '', content: '' };
  }
}

async function initSaveForm(tab) {
  const [pageData, tagsResult, storage] = await Promise.all([
    getPageData(tab),
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_TAGS' }, resolve);
    }),
    chrome.storage.local.get(['defaultTags', 'lastUsedTags'])
  ]);

  urlInput.value = pageData.url;
  titleInput.value = (pageData.title || '').substring(0, MAX_TITLE_LENGTH);
  descriptionInput.value = (pageData.description || '').substring(0, MAX_DESCRIPTION_LENGTH);
  pageContent = pageData.content || '';

  const defaultTags = storage.defaultTags || [];
  const lastUsedTags = storage.lastUsedTags || [];
  [...new Set([...defaultTags, ...lastUsedTags])].forEach(t => selectedTags.add(t));

  if (tagsResult && tagsResult.success) {
    allTags = tagsResult.data.tags.map(t => t.name);
  }

  renderTagChips();

  loadingIndicator.hidden = true;
  saveForm.hidden = false;

  tagsInput.addEventListener('input', () => {
    renderTagChips();
  });

  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newTag = tagsInput.value.trim().toLowerCase();
      if (newTag) {
        selectedTags.add(newTag);
        tagsInput.value = '';
        renderTagChips();
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
  let tagsToShow;
  if (showingAllTags || filterText) {
    tagsToShow = visibleTags;
  } else {
    const topTags = visibleTags.slice(0, INITIAL_CHIPS_COUNT);
    const selectedNotInTop = [...selectedTags].filter(
      t => allTags.includes(t) && !topTags.includes(t)
    );
    tagsToShow = [...topTags, ...selectedNotInTop];
  }

  tagsToShow.forEach(tag => {
    const chip = document.createElement('span');
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
    });
    tagChipsContainer.appendChild(chip);
  });

  if (!filterText && !showingAllTags && visibleTags.length > INITIAL_CHIPS_COUNT) {
    tagSuggestions.hidden = false;
    const link = document.createElement('span');
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
}

function getSelectedTags() {
  return [...selectedTags];
}

async function handleSave(e) {
  e.preventDefault();
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  saveStatus.hidden = true;

  const tags = getSelectedTags();
  const bookmark = {
    url: urlInput.value,
    title: titleInput.value.substring(0, MAX_TITLE_LENGTH),
    description: descriptionInput.value.substring(0, MAX_DESCRIPTION_LENGTH),
    content: pageContent,
    tags
  };

  chrome.runtime.sendMessage({ type: 'CREATE_BOOKMARK', bookmark }, (response) => {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Bookmark';

    if (chrome.runtime.lastError) {
      showSaveStatus("Can't reach extension — try reloading", 'error');
      return;
    }

    if (response.success) {
      showSaveStatus('Saved!', 'success');
      chrome.storage.local.set({ lastUsedTags: tags });
      return;
    }

    handleSaveError(response);
  });
}

function handleSaveError(response) {
  const { status, body, retryAfter } = response;

  if (status === 400) {
    showSaveStatus(body?.detail || 'Invalid bookmark data', 'error');
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

function loadBookmarks(query, offset, append) {
  const requestId = ++searchRequestId;
  loadMoreBtn.hidden = true;
  if (!append) loadMoreBtn.disabled = true;

  chrome.runtime.sendMessage(
    { type: 'SEARCH_BOOKMARKS', query, offset, limit: 10 },
    (response) => {
      // Ignore stale responses (#4)
      if (requestId !== searchRequestId) return;

      loadMoreBtn.disabled = false;

      if (chrome.runtime.lastError || !response?.success) {
        if (!append) searchResults.replaceChildren();
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

      const { items, has_more } = response.data;

      if (!append) {
        searchResults.replaceChildren();
      }

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
        el.appendChild(title);

        const url = document.createElement('div');
        url.className = 'search-result-url';
        url.textContent = item.url;
        el.appendChild(url);

        const meta = document.createElement('div');
        meta.className = 'search-result-meta';

        if (item.created_at) {
          const date = document.createElement('span');
          date.className = 'search-result-date';
          date.textContent = formatDate(item.created_at);
          meta.appendChild(date);
        }

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
  );
}

function formatDate(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const month = d.toLocaleString('default', { month: 'short' });
  const day = d.getDate();
  if (d.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${d.getFullYear()}`;
  }
  return `${month} ${day}`;
}

// --- Init ---
init().catch(() => {
  document.getElementById('popup').textContent = 'Something went wrong. Try reopening the extension.';
});
