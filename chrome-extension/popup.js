import {
  setupDOM, pickDefaultTab, setPopupMode, activateTab, setTabEnabled,
  isRestrictedPage, initSaveForm, initSearchView,
} from './popup-core.js';

setupDOM({
  setupView: document.getElementById('setup-view'),
  saveView: document.getElementById('save-view'),
  searchView: document.getElementById('search-view'),
  popupHeader: document.getElementById('popup-header'),
  tabSave: document.getElementById('tab-save'),
  tabSearch: document.getElementById('tab-search'),
  settingsBtn: document.getElementById('settings-btn'),
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

document.getElementById('settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Lazy-init guards: the popup DOM is destroyed on blur, so flags reset on every reopen.
// Prevents duplicated listeners when the user switches Save → Search → Save within one open.
let saveInitialized = false;
let searchInitialized = false;
let currentTab = null;

async function activateAndInit(name) {
  activateTab(name);
  if (name === 'save' && !saveInitialized) {
    saveInitialized = true;
    await initSaveForm(currentTab);
  } else if (name === 'search' && !searchInitialized) {
    searchInitialized = true;
    await initSearchView();
  }
}

function wireTabClicks() {
  for (const name of ['save', 'search']) {
    const tab = document.getElementById(`tab-${name}`);
    tab.addEventListener('click', () => {
      if (tab.getAttribute('aria-disabled') === 'true') return;
      activateAndInit(name);
    });
  }
  // Roving tabindex: arrow keys move between enabled tabs, skipping disabled.
  const tablist = document.querySelector('[role="tablist"]');
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const order = ['save', 'search'];
    const activeName = document.activeElement?.id?.replace('tab-', '');
    if (!order.includes(activeName)) return;
    const direction = e.key === 'ArrowRight' ? 1 : -1;
    for (let i = 1; i <= order.length; i++) {
      const idx = (order.indexOf(activeName) + direction * i + order.length) % order.length;
      const candidate = document.getElementById(`tab-${order[idx]}`);
      if (candidate.getAttribute('aria-disabled') !== 'true') {
        candidate.focus();
        activateAndInit(order[idx]);
        e.preventDefault();
        return;
      }
    }
  });
}

async function init() {
  const { token } = await chrome.storage.local.get(['token']);

  if (!token) {
    setPopupMode('setup');
    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  setPopupMode('app');
  wireTabClicks();

  const restricted = isRestrictedPage(tab?.url);
  setTabEnabled('save', !restricted, restricted ? "Save — this page can't be bookmarked" : undefined);

  const defaultTab = pickDefaultTab({ url: tab?.url, hasToken: true });
  await activateAndInit(defaultTab);
}

init().catch(() => {
  document.getElementById('popup').textContent = 'Something went wrong. Try reopening the extension.';
});
