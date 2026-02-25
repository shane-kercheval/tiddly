const tokenInput = document.getElementById('token');
const toggleTokenBtn = document.getElementById('toggle-token');
const defaultTagsInput = document.getElementById('default-tags');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const tokenError = document.getElementById('token-error');
const saveStatus = document.getElementById('save-status');
const testStatus = document.getElementById('test-status');

// Load saved settings on open
chrome.storage.local.get(['token', 'defaultTags']).then(({ token, defaultTags }) => {
  if (token) tokenInput.value = token;
  if (defaultTags && defaultTags.length > 0) {
    defaultTagsInput.value = defaultTags.join(', ');
  }
});

// Show/hide token toggle
toggleTokenBtn.addEventListener('click', () => {
  const isPassword = tokenInput.type === 'password';
  tokenInput.type = isPassword ? 'text' : 'password';
  toggleTokenBtn.textContent = isPassword ? 'Hide' : 'Show';
});

// Save settings
saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();

  // Validate token
  tokenError.hidden = true;
  if (!token) {
    showError(tokenError, 'Token is required');
    return;
  }
  if (!token.startsWith('bm_')) {
    showError(tokenError, 'Token should start with bm_');
    return;
  }

  // Parse default tags
  const defaultTags = defaultTagsInput.value
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  chrome.storage.local.set({ token, defaultTags }).then(() => {
    showStatus(saveStatus, 'Settings saved', 'success');
  });
});

// Test connection
testBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showError(tokenError, 'Enter a token first');
    return;
  }

  testStatus.hidden = false;
  testStatus.textContent = 'Testing...';
  testStatus.className = 'status';

  chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', token }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus(testStatus, 'Extension error — try reloading', 'error');
      return;
    }
    if (response.success) {
      showStatus(testStatus, `Connected as ${response.email}`, 'success');
    } else if (response.status === 401) {
      showStatus(testStatus, 'Invalid token', 'error');
    } else {
      showStatus(testStatus, `Connection failed (${response.status || response.error})`, 'error');
    }
  });
});

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function showStatus(el, message, type) {
  el.textContent = message;
  el.className = `status ${type}`;
  el.hidden = false;
  if (type === 'success') {
    setTimeout(() => { el.hidden = true; }, 3000);
  }
}
