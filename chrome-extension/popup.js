import {
  setupDOM, isRestrictedPage, showView,
  initSaveForm, initSearchView,
} from './popup-core.js';

setupDOM({
  setupView: document.getElementById('setup-view'),
  saveView: document.getElementById('save-view'),
  searchView: document.getElementById('search-view'),
  saveForm: document.getElementById('save-form'),
  loadingIndicator: document.getElementById('loading-indicator'),
  urlInput: document.getElementById('url'),
  titleInput: document.getElementById('title'),
  descriptionInput: document.getElementById('description'),
  titleLimit: document.getElementById('title-limit'),
  descriptionLimit: document.getElementById('description-limit'),
  tagsInput: document.getElementById('tags-input'),
  tagChipsContainer: document.getElementById('tag-chips'),
  tagSuggestions: document.getElementById('tag-suggestions'),
  saveBtn: document.getElementById('save-btn'),
  saveStatus: document.getElementById('save-status'),
  clearTagsBtn: document.getElementById('clear-tags'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  searchLoading: document.getElementById('search-loading'),
  loadMoreBtn: document.getElementById('load-more'),
  searchTagInput: document.getElementById('search-tag-input'),
  searchTagDropdown: document.getElementById('search-tag-dropdown'),
  searchSortSelect: document.getElementById('search-sort-select'),
  searchActiveTags: document.getElementById('search-active-tags'),
});

// Settings links
document.getElementById('save-settings-link')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('search-settings-link')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

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

init().catch(() => {
  document.getElementById('popup').textContent = 'Something went wrong. Try reopening the extension.';
});
