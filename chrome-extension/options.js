const tokenInput = document.getElementById('token');
const toggleTokenBtn = document.getElementById('toggle-token');
const saveBtn = document.getElementById('save-btn');
const tokenError = document.getElementById('token-error');
const saveStatus = document.getElementById('save-status');
const tagsSection = document.getElementById('tags-section');
const tagChipsContainer = document.getElementById('tag-chips');
const tagsStatus = document.getElementById('tags-status');

let allTags = [];
let selectedTags = new Set();

// Load saved settings and tags on open
chrome.storage.local.get(['token', 'defaultTags']).then(({ token, defaultTags }) => {
  if (token) {
    tokenInput.value = token;
    if (defaultTags) defaultTags.forEach(t => selectedTags.add(t));
    loadTags();
  }
});

// Show/hide token toggle
toggleTokenBtn.addEventListener('click', () => {
  const isPassword = tokenInput.type === 'password';
  tokenInput.type = isPassword ? 'text' : 'password';
  toggleTokenBtn.textContent = isPassword ? 'Hide' : 'Show';
});

// Save token
saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();

  tokenError.hidden = true;
  if (!token) {
    showError(tokenError, 'Token is required');
    return;
  }
  if (!token.startsWith('bm_')) {
    showError(tokenError, 'Token should start with bm_');
    return;
  }

  chrome.storage.local.set({ token }).then(() => {
    showStatus(saveStatus, 'Saved', 'success');
    loadTags();
  });
});

async function loadTags() {
  tagsSection.hidden = false;
  tagsStatus.hidden = false;
  tagsStatus.textContent = 'Loading tags...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAGS' });
    if (response?.success && Array.isArray(response.data?.tags)) {
      allTags = response.data.tags.map(t => t.name);
      tagsStatus.hidden = true;
      renderTagChips();
    } else if (response?.status === 401) {
      tagsStatus.textContent = 'Invalid token';
      tagChipsContainer.replaceChildren();
    } else {
      tagsStatus.textContent = 'Could not load tags';
      tagChipsContainer.replaceChildren();
    }
  } catch {
    tagsStatus.textContent = 'Could not connect';
    tagChipsContainer.replaceChildren();
  }
}

function renderTagChips() {
  tagChipsContainer.replaceChildren();

  // Show all tags, selected first
  const sorted = [...allTags].sort((a, b) => {
    const aSelected = selectedTags.has(a) ? 0 : 1;
    const bSelected = selectedTags.has(b) ? 0 : 1;
    return aSelected - bSelected;
  });

  sorted.forEach(tag => {
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
      renderTagChips();
      chrome.storage.local.set({ defaultTags: [...selectedTags] });
    });
    tagChipsContainer.appendChild(chip);
  });
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

let statusTimerId = null;

function showStatus(el, message, type) {
  clearTimeout(statusTimerId);
  el.textContent = message;
  el.className = `status ${type}`;
  el.hidden = false;
  if (type === 'success') {
    statusTimerId = setTimeout(() => { el.hidden = true; }, 3000);
  }
}
