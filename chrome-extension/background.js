const API_URL = 'https://api.tiddly.me';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_CONNECTION') {
    handleTestConnection(message).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.type === 'CREATE_BOOKMARK') {
    handleCreateBookmark(message).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.type === 'GET_TAGS') {
    handleGetTags().then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.type === 'SEARCH_BOOKMARKS') {
    handleSearchBookmarks(message).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }
});

async function getToken() {
  const { token } = await chrome.storage.local.get(['token']);
  return token;
}

async function handleTestConnection(message) {
  const token = message.token;
  const res = await fetch(`${API_URL}/users/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.ok) {
    const data = await res.json();
    return { success: true, email: data.email };
  }
  return { success: false, status: res.status };
}

async function handleCreateBookmark(message) {
  const token = await getToken();
  const res = await fetch(`${API_URL}/bookmarks/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-Source': 'chrome-extension'
    },
    body: JSON.stringify(message.bookmark)
  });
  if (res.ok) {
    return { success: true, bookmark: await res.json() };
  }
  const body = await res.json().catch(() => null);
  const retryAfter = res.headers.get('Retry-After');
  return { success: false, status: res.status, body, retryAfter };
}

async function handleGetTags() {
  const token = await getToken();
  const res = await fetch(`${API_URL}/tags/?content_types=bookmark`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Request-Source': 'chrome-extension'
    }
  });
  if (res.ok) {
    return { success: true, data: await res.json() };
  }
  return { success: false, status: res.status };
}

async function handleSearchBookmarks(message) {
  const token = await getToken();
  const params = new URLSearchParams({
    limit: String(message.limit || 10),
    offset: String(message.offset || 0),
    sort_order: 'desc'
  });
  if (message.query) {
    params.set('q', message.query);
  } else {
    params.set('sort_by', 'created_at');
  }
  const res = await fetch(`${API_URL}/bookmarks/?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Request-Source': 'chrome-extension'
    }
  });
  if (res.ok) {
    return { success: true, data: await res.json() };
  }
  return { success: false, status: res.status };
}
