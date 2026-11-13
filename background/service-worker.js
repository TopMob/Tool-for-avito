/**
 * Service Worker — фоновая координация расширения Tool for Avito.
 */

// Обработка сообщений от контентных скриптов и попапа
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PARSE_RESULT') {
    const data = msg.data;

    if (data && typeof data.count === 'number' && data.count > 0) {
      const badgeOpts = { text: String(data.count) };
      const colorOpts = { color: '#6c5ce7' };

      if (sender.tab && typeof sender.tab.id === 'number') {
        badgeOpts.tabId = sender.tab.id;
        colorOpts.tabId = sender.tab.id;
      }

      chrome.action.setBadgeText(badgeOpts).catch(() => { });
      chrome.action.setBadgeBackgroundColor(colorOpts).catch(() => { });
    } else {
      const clearOpts = { text: '' };
      if (sender.tab && typeof sender.tab.id === 'number') {
        clearOpts.tabId = sender.tab.id;
      }
      chrome.action.setBadgeText(clearOpts).catch(() => { });
    }

    sendResponse({ ok: true });
  }

  if (msg.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' }).catch(() => { });
    if (msg.tabId) {
      chrome.action.setBadgeText({ text: '', tabId: msg.tabId }).catch(() => { });
    }
    sendResponse({ ok: true });
  }
});

// Очищаем бейдж при перезагрузке или навигации вкладки
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => { });
  }
});
