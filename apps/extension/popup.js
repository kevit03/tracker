const DEFAULT_API_URL = 'http://localhost:3001';

// State
let apiUrl = DEFAULT_API_URL;
let metrics = [
  { id: 'jobs', name: 'Job Applications', color: '#1a73e8', icon: 'briefcase', unit: 'jobs' },
  { id: 'leetcode', name: 'LeetCode Problems', color: '#1e8e3e', icon: 'code', unit: 'problems' }
];
let activeMetricId = 'jobs';
let isOnline = false;
let stats = null;

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsPane = document.getElementById('settings-pane');
const apiUrlInput = document.getElementById('api-url-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const currentDateText = document.getElementById('current-date-text');
const streakCountEl = document.getElementById('streak-count');
const metricTabsContainer = document.getElementById('metric-tabs');
const addMetricTabBtn = document.getElementById('add-metric-tab-btn');
const counterCard = document.getElementById('counter-card');
const metricCountEl = document.getElementById('metric-count');
const metricUnitLabelEl = document.getElementById('metric-unit-label');
const quickAddBtn = document.getElementById('quick-add-btn');
const quickAddLabel = document.getElementById('quick-add-label');
const undoBtn = document.getElementById('undo-btn');
const toggleDetailsBtn = document.getElementById('toggle-details-btn');
const detailsForm = document.getElementById('details-form');
const detailsArrow = document.getElementById('details-arrow');
const detailCompanyInput = document.getElementById('detail-company');
const detailRoleInput = document.getElementById('detail-role');
const detailNotesInput = document.getElementById('detail-notes');
const statWeekEl = document.getElementById('stat-week');
const statMonthEl = document.getElementById('stat-month');
const statTotalEl = document.getElementById('stat-total');
const openDashboardBtn = document.getElementById('open-dashboard-btn');
const newMetricModal = document.getElementById('new-metric-modal');
const closeMetricModalBtn = document.getElementById('close-metric-modal');
const cancelMetricBtn = document.getElementById('cancel-metric-btn');
const newMetricForm = document.getElementById('new-metric-form');
const newMetricNameInput = document.getElementById('new-metric-name');
const newMetricUnitInput = document.getElementById('new-metric-unit');
const colorPalette = document.getElementById('color-palette');

// Date formatting helper
function formatTodayHeader() {
  const d = new Date();
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  return d.toLocaleDateString(undefined, options);
}

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Storage helpers
async function getStorageData(key, fallback) {
  return new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], result => {
        resolve(result[key] !== undefined ? result[key] : fallback);
      });
    } else {
      const val = localStorage.getItem(key);
      resolve(val ? JSON.parse(val) : fallback);
    }
  });
}

async function setStorageData(key, value) {
  return new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: value }, resolve);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
      resolve();
    }
  });
}

// Init
async function init() {
  currentDateText.textContent = formatTodayHeader();

  // Load saved API URL & active metric
  apiUrl = await getStorageData('apiUrl', DEFAULT_API_URL);
  apiUrlInput.value = apiUrl;
  activeMetricId = await getStorageData('activeMetricId', 'jobs');

  // Load cached metrics
  const cachedMetrics = await getStorageData('cachedMetrics', null);
  if (cachedMetrics && cachedMetrics.length) {
    metrics = cachedMetrics;
  }

  // Load cached stats
  const cachedStats = await getStorageData('cachedStats', null);
  if (cachedStats) {
    stats = cachedStats;
    renderUI();
  }

  // Fetch live
  await checkConnectionAndSync();
  renderUI();
}

// Check Connection and Sync
async function checkConnectionAndSync() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      setOnlineStatus(true);
      await fetchMetrics();
      await fetchStats();
      await syncOfflineQueue();
      return;
    }
  } catch (err) {
    // Offline or server not running
  }
  setOnlineStatus(false);
}

function setOnlineStatus(online) {
  isOnline = online;
  if (online) {
    statusIndicator.className = 'status-badge';
    statusText.textContent = 'Live';
    statusIndicator.title = `Connected to ${apiUrl}`;
  } else {
    statusIndicator.className = 'status-badge offline';
    statusText.textContent = 'Offline';
    statusIndicator.title = `Server unreachable at ${apiUrl}. Logs saved locally!`;
  }
}

async function fetchMetrics() {
  try {
    const res = await fetch(`${apiUrl}/api/metrics`);
    if (res.ok) {
      metrics = await res.json();
      await setStorageData('cachedMetrics', metrics);
    }
  } catch (e) {
    console.warn('Failed to fetch metrics:', e);
  }
}

async function fetchStats() {
  try {
    const res = await fetch(`${apiUrl}/api/stats`);
    if (res.ok) {
      stats = await res.json();
      await setStorageData('cachedStats', stats);
    }
  } catch (e) {
    console.warn('Failed to fetch stats:', e);
  }
}

// Sync offline queue if server is reachable
async function syncOfflineQueue() {
  const queue = await getStorageData('offlineLogQueue', []);
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(`${apiUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (!res.ok) remaining.push(item);
    } catch (e) {
      remaining.push(item);
    }
  }

  await setStorageData('offlineLogQueue', remaining);
  if (remaining.length === 0) {
    await fetchStats();
    renderUI();
  }
}

// Render Tabs & Active Metric View
function renderUI() {
  const currentMetric = metrics.find(m => m.id === activeMetricId) || metrics[0] || {
    id: 'jobs',
    name: 'Job Applications',
    color: '#1a73e8',
    unit: 'jobs'
  };

  activeMetricId = currentMetric.id;

  // Render tabs
  metricTabsContainer.innerHTML = '';
  metrics.forEach(m => {
    const tab = document.createElement('button');
    tab.className = `tab-item ${m.id === activeMetricId ? 'active' : ''}`;
    if (m.id === activeMetricId) {
      tab.style.borderColor = m.color;
      tab.style.color = m.color;
    }

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.style.backgroundColor = m.color;

    const label = document.createElement('span');
    label.textContent = m.name;

    tab.appendChild(dot);
    tab.appendChild(label);

    tab.addEventListener('click', () => {
      activeMetricId = m.id;
      setStorageData('activeMetricId', activeMetricId);
      renderUI();
    });

    metricTabsContainer.appendChild(tab);
  });

  // Today count
  const todayStr = getLocalDateString();
  let todayCount = 0;
  let weekCount = 0;
  let monthCount = 0;
  let totalCount = 0;

  if (stats) {
    todayCount = (stats.today && stats.today[activeMetricId]) || 0;
    weekCount = (stats.thisWeek && stats.thisWeek[activeMetricId]) || 0;
    monthCount = (stats.thisMonth && stats.thisMonth[activeMetricId]) || 0;
    totalCount = (stats.totals && stats.totals[activeMetricId]) || 0;
    streakCountEl.textContent = stats.currentStreak || 0;
  }

  // Display counter
  metricCountEl.textContent = todayCount;
  metricUnitLabelEl.textContent = `${currentMetric.unit || 'items'} logged today`;
  quickAddLabel.textContent = `+1 ${currentMetric.unit || 'Item'}`;
  quickAddBtn.style.backgroundColor = currentMetric.color;

  statWeekEl.textContent = weekCount;
  statMonthEl.textContent = monthCount;
  statTotalEl.textContent = totalCount;
}

// Action: Quick Increment
async function handleQuickAdd(details = {}) {
  const currentMetric = metrics.find(m => m.id === activeMetricId) || metrics[0];
  const todayStr = getLocalDateString();

  // Optimistic UI update
  const currentVal = parseInt(metricCountEl.textContent, 10) || 0;
  metricCountEl.textContent = currentVal + 1;
  metricCountEl.classList.add('bump');
  setTimeout(() => metricCountEl.classList.remove('bump'), 200);

  const payload = {
    metricId: currentMetric.id,
    count: 1,
    date: todayStr,
    timestamp: new Date().toISOString(),
    company: details.company || '',
    role: details.role || '',
    notes: details.notes || '',
    status: 'applied'
  };

  if (isOnline) {
    try {
      const res = await fetch(`${apiUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await fetchStats();
        renderUI();
        return;
      }
    } catch (e) {
      console.warn('Network error while logging, queuing offline:', e);
    }
  }

  // Fallback: queue offline
  const queue = await getStorageData('offlineLogQueue', []);
  queue.push(payload);
  await setStorageData('offlineLogQueue', queue);

  // Update local stats cache optimistically
  if (!stats) stats = { today: {}, thisWeek: {}, thisMonth: {}, totals: {}, currentStreak: 1 };
  if (!stats.today) stats.today = {};
  stats.today[activeMetricId] = (stats.today[activeMetricId] || 0) + 1;
  if (!stats.thisWeek) stats.thisWeek = {};
  stats.thisWeek[activeMetricId] = (stats.thisWeek[activeMetricId] || 0) + 1;
  if (!stats.totals) stats.totals = {};
  stats.totals[activeMetricId] = (stats.totals[activeMetricId] || 0) + 1;
  renderUI();
}

// Action: Undo / Decrement
async function handleUndo() {
  const currentVal = parseInt(metricCountEl.textContent, 10) || 0;
  if (currentVal <= 0) return;

  if (isOnline) {
    try {
      const todayStr = getLocalDateString();
      const res = await fetch(`${apiUrl}/api/logs?metricId=${activeMetricId}&startDate=${todayStr}&endDate=${todayStr}`);
      if (res.ok) {
        const logs = await res.json();
        if (logs.length > 0) {
          const latest = logs[0];
          await fetch(`${apiUrl}/api/logs/${latest.id}`, { method: 'DELETE' });
          await fetchStats();
          renderUI();
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to undo via API:', e);
    }
  }

  // Fallback optimistic decrement
  metricCountEl.textContent = Math.max(0, currentVal - 1);
}

// Event Listeners
quickAddBtn.addEventListener('click', () => handleQuickAdd());
undoBtn.addEventListener('click', handleUndo);

// Toggle Details Accordion
toggleDetailsBtn.addEventListener('click', () => {
  const isHidden = detailsForm.classList.contains('hidden');
  if (isHidden) {
    detailsForm.classList.remove('hidden');
    detailsArrow.style.transform = 'rotate(180deg)';
  } else {
    detailsForm.classList.add('hidden');
    detailsArrow.style.transform = 'rotate(0deg)';
  }
});

// Submit Details Form
detailsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const company = detailCompanyInput.value.trim();
  const role = detailRoleInput.value.trim();
  const notes = detailNotesInput.value.trim();

  await handleQuickAdd({ company, role, notes });

  // Reset & close form
  detailCompanyInput.value = '';
  detailRoleInput.value = '';
  detailNotesInput.value = '';
  detailsForm.classList.add('hidden');
  detailsArrow.style.transform = 'rotate(0deg)';
});

// Settings toggle & save
settingsToggleBtn.addEventListener('click', () => {
  settingsPane.classList.toggle('hidden');
});

saveSettingsBtn.addEventListener('click', async () => {
  const val = apiUrlInput.value.trim().replace(/\/+$/, '');
  if (val) {
    apiUrl = val;
    await setStorageData('apiUrl', apiUrl);
    settingsPane.classList.add('hidden');
    await checkConnectionAndSync();
    renderUI();
  }
});

// Open Calendar Dashboard
openDashboardBtn.addEventListener('click', () => {
  const url = apiUrl;
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
});

// Custom Metric Modal
addMetricTabBtn.addEventListener('click', () => {
  newMetricModal.classList.remove('hidden');
  newMetricNameInput.focus();
});

closeMetricModalBtn.addEventListener('click', () => {
  newMetricModal.classList.add('hidden');
});

cancelMetricBtn.addEventListener('click', () => {
  newMetricModal.classList.add('hidden');
});

// Color picker inside modal
let selectedColor = '#1a73e8';
colorPalette.addEventListener('click', (e) => {
  const btn = e.target.closest('.color-option');
  if (!btn) return;
  document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedColor = btn.dataset.color;
});

// Add Tracker Form Submit
newMetricForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = newMetricNameInput.value.trim();
  const unit = newMetricUnitInput.value.trim() || 'items';
  if (!name) return;

  const payload = {
    name,
    unit,
    color: selectedColor,
    icon: 'target'
  };

  if (isOnline) {
    try {
      const res = await fetch(`${apiUrl}/api/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const created = await res.json();
        metrics.push(created);
        activeMetricId = created.id;
        await setStorageData('cachedMetrics', metrics);
        await setStorageData('activeMetricId', activeMetricId);
      }
    } catch (e) {
      console.warn('Failed to add metric on server:', e);
    }
  } else {
    // Local creation
    const localId = 'metric-' + Date.now();
    const created = { id: localId, name, unit, color: selectedColor, icon: 'target' };
    metrics.push(created);
    activeMetricId = created.id;
    await setStorageData('cachedMetrics', metrics);
    await setStorageData('activeMetricId', activeMetricId);
  }

  newMetricNameInput.value = '';
  newMetricModal.classList.add('hidden');
  renderUI();
});

// Auto initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
