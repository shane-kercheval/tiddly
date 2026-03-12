import {
  handleCreateBookmark,
  handleGetTags,
  handleGetLimits,
  handleSearchBookmarks,
} from './background-core.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message.type === 'GET_LIMITS') {
    handleGetLimits().then(sendResponse).catch(err =>
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
