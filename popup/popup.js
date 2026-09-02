document.addEventListener('DOMContentLoaded', async () => {
  let metrics = [];
  let stats = null;
  let activeMetricId = 'jobs';
  let currentUser = null;

  const el = (id) => document.getElementById(id);

  function formatDateHeader() {
    return new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  el('current-date-text').textContent = formatDateHeader();

  async function updateAuthUI() {
    currentUser = await TrackerAuth.getCurrentUser();
    const info = el('account-info');
    const signInBtn = el('account-signin-btn');

    if (currentUser && currentUser.email) {
      info.classList.remove('hidden');
      signInBtn.classList.add('hidden');
      el('account-email').textContent = currentUser.email;
      el('account-badge').textContent = (currentUser.name || currentUser.email)[0].toUpperCase();
    } else {
      info.classList.add('hidden');
      signInBtn.classList.remove('hidden');
    }
  }

  async function loadData() {
    await updateAuthUI();
    [metrics, stats] = await Promise.all([
      TrackerStorage.getMetrics(),
      TrackerStorage.getStats()
    ]);
    renderUI();
  }

  function renderUI() {
    const current = metrics.find(m => m.id === activeMetricId) || metrics[0];
    if (!current) return;
    activeMetricId = current.id;

    // Tabs
    const tabsContainer = el('metric-tabs');
    tabsContainer.innerHTML = '';
    metrics.forEach(m => {
      const tab = document.createElement('button');
      tab.className = 'tab-item' + (m.id === activeMetricId ? ' active' : '');
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
      tab.addEventListener('click', () => { activeMetricId = m.id; renderUI(); });
      tabsContainer.appendChild(tab);
    });

    // Counter
    const todayCount = (stats && stats.today[activeMetricId]) || 0;
    const weekCount = (stats && stats.thisWeek[activeMetricId]) || 0;
    const monthCount = (stats && stats.thisMonth[activeMetricId]) || 0;
    const totalCount = (stats && stats.totals[activeMetricId]) || 0;

    el('metric-count').textContent = todayCount;
    el('metric-unit-label').textContent = (current.unit || 'items') + ' logged today';

    const unitSingular = (current.unit || 'items').replace(/s$/, '');
    el('quick-add-label').textContent = '+1 ' + unitSingular;
    el('quick-add-btn').style.backgroundColor = current.color;

    el('streak-count').textContent = (stats && stats.currentStreak) || 0;
    el('stat-week').textContent = weekCount;
    el('stat-month').textContent = monthCount;
    el('stat-total').textContent = totalCount;
  }

  // Google Sign In / Sign Out
  el('account-signin-btn').addEventListener('click', async () => {
    try {
      await TrackerAuth.signInWithGoogle();
      await loadData();
    } catch (err) {
      console.warn('Sign-in cancelled or failed:', err.message);
    }
  });

  el('account-signout-btn').addEventListener('click', async () => {
    await TrackerAuth.signOut();
    await loadData();
  });

  // +1
  el('quick-add-btn').addEventListener('click', async () => {
    el('metric-count').classList.add('bump');
    setTimeout(() => el('metric-count').classList.remove('bump'), 150);
    await TrackerStorage.addLog({ metricId: activeMetricId, count: 1 });
    await loadData();
  });

  // -1
  el('undo-btn').addEventListener('click', async () => {
    await TrackerStorage.undoLastLog(activeMetricId);
    await loadData();
  });

  // Details toggle
  el('toggle-details-btn').addEventListener('click', () => {
    el('details-form').classList.toggle('hidden');
    el('details-arrow').classList.toggle('open');
  });

  // Details submit
  el('details-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await TrackerStorage.addLog({
      metricId: activeMetricId,
      count: 1,
      company: el('detail-company').value,
      role: el('detail-role').value,
      notes: el('detail-notes').value
    });
    el('detail-company').value = '';
    el('detail-role').value = '';
    el('detail-notes').value = '';
    el('details-form').classList.add('hidden');
    el('details-arrow').classList.remove('open');
    await loadData();
  });

  // Open Google Calendar
  el('open-calendar-btn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'https://calendar.google.com' });
    } else {
      window.open('https://calendar.google.com', '_blank');
    }
  });

  // New metric modal
  el('add-metric-tab-btn').addEventListener('click', () => {
    el('new-metric-modal').classList.remove('hidden');
    el('new-metric-name').focus();
  });

  el('close-metric-modal').addEventListener('click', () => el('new-metric-modal').classList.add('hidden'));
  el('cancel-metric-btn').addEventListener('click', () => el('new-metric-modal').classList.add('hidden'));

  let selectedColor = '#1a73e8';
  el('color-palette').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-option');
    if (!btn) return;
    el('color-palette').querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedColor = btn.dataset.color;
  });

  el('new-metric-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('new-metric-name').value.trim();
    const unit = el('new-metric-unit').value.trim() || 'items';
    if (!name) return;

    const created = await TrackerStorage.addMetric({ name, color: selectedColor, unit, icon: 'custom' });
    activeMetricId = created.id;
    el('new-metric-name').value = '';
    el('new-metric-modal').classList.add('hidden');
    await loadData();
  });

  // Live sync from content script and auth changes
  TrackerStorage.onChanged(() => loadData());
  TrackerAuth.onAuthChanged(() => loadData());

  await loadData();
});
