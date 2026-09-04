// Background service worker for PulseTracker Chrome Extension
try {
  importScripts('../shared/auth.js', '../shared/storage.js');
} catch (e) {
  console.error('Failed to import scripts in background worker:', e);
}

function notifyCalendarTabs() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ url: '*://calendar.google.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'PT_REFRESH' }).catch(() => {});
        });
      }
    });
  }
}

function showBadgeFeedback(text, color) {
  if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setBadgeText) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: color || '#1a73e8' });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 1500);
  }
}

if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'quick-add-job') {
      await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });
      showBadgeFeedback('+1', '#1a73e8');
      notifyCalendarTabs();
    } else if (command === 'quick-add-leetcode') {
      await TrackerStorage.addLog({ metricId: 'leetcode', count: 1 });
      showBadgeFeedback('+1', '#1e8e3e');
      notifyCalendarTabs();
    }
  });
}
