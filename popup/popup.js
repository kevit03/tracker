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

    // Daily Goal progress
    const dailyGoal = current.dailyGoal || (current.id === 'jobs' ? 5 : (current.id === 'leetcode' ? 2 : 1));
    const goalTargetEl = el('goal-target-num');
    if (goalTargetEl) {
      goalTargetEl.textContent = dailyGoal;
      goalTargetEl.onclick = async () => {
        const val = prompt('Set daily goal for ' + current.name + ':', dailyGoal);
        if (val !== null && val.trim() !== '') {
          const num = parseInt(val.trim(), 10);
          if (!isNaN(num) && num > 0) {
            await TrackerStorage.setMetricGoal(current.id, num);
            notifyCalendarTabs();
            await loadData();
          }
        }
      };
    }

    const goalStatusEl = el('goal-status-text');
    if (goalStatusEl) {
      if (todayCount >= dailyGoal) {
        goalStatusEl.textContent = todayCount + ' / ' + dailyGoal + ' (Goal Met)';
        goalStatusEl.style.color = '#1e8e3e';
      } else {
        goalStatusEl.textContent = todayCount + ' / ' + dailyGoal;
        goalStatusEl.style.color = 'var(--text-main)';
      }
    }

    const goalFillEl = el('goal-bar-fill');
    if (goalFillEl) {
      const pct = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
      goalFillEl.style.width = pct + '%';
      goalFillEl.style.backgroundColor = todayCount >= dailyGoal ? '#1e8e3e' : current.color;
      goalFillEl.classList.toggle('goal-met', todayCount >= dailyGoal);
    }

    renderActivityChart();
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

  // +1
  el('quick-add-btn').addEventListener('click', async () => {
    el('metric-count').classList.add('bump');
    setTimeout(() => el('metric-count').classList.remove('bump'), 150);
    await TrackerStorage.addLog({ metricId: activeMetricId, count: 1 });
    notifyCalendarTabs();
    await loadData();
  });

  // -1
  el('undo-btn').addEventListener('click', async () => {
    await TrackerStorage.undoLastLog(activeMetricId);
    notifyCalendarTabs();
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
    notifyCalendarTabs();
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

  async function renderActivityChart() {
    const barsContainer = el('activity-bars');
    if (!barsContainer) return;
    const current = metrics.find(m => m.id === activeMetricId);
    const color = current ? current.color : '#1a73e8';

    const titleEl = el('activity-title');
    if (titleEl && current) {
      titleEl.textContent = '30-Day ' + current.name + ' Activity';
    }

    const history = await TrackerStorage.getActivityHistory(30, activeMetricId);

    const totalEl = el('pop-act-total');
    const avgEl = el('pop-act-avg');
    const daysEl = el('pop-act-days');
    const bestEl = el('pop-act-best');

    if (totalEl) totalEl.textContent = history.totalCount;
    if (avgEl) avgEl.textContent = history.dailyAverage;
    if (daysEl) daysEl.textContent = history.activeDaysCount;
    if (bestEl) bestEl.textContent = history.bestDay.count;

    barsContainer.innerHTML = '';
    const maxVal = Math.max(4, ...history.days.map(d => d.count));

    history.days.forEach(day => {
      const col = document.createElement('div');
      col.className = 'pop-bar-col';

      const heightPct = Math.round((day.count / maxVal) * 100);
      const bar = document.createElement('div');
      bar.className = 'pop-bar' + (day.count > 0 ? ' has-act' : '');
      bar.style.height = (day.count > 0 ? Math.max(10, heightPct) : 4) + '%';
      if (day.count > 0) {
        bar.style.backgroundColor = color;
      }

      const tooltip = document.createElement('div');
      tooltip.className = 'pop-bar-tooltip';
      tooltip.textContent = day.label + ': ' + day.count;

      col.appendChild(bar);
      col.appendChild(tooltip);
      barsContainer.appendChild(col);
    });
  }

  el('toggle-activity-btn').addEventListener('click', () => {
    const panel = el('activity-panel');
    const arrow = el('activity-arrow');
    panel.classList.toggle('hidden');
    const isOpen = !panel.classList.contains('hidden');
    arrow.classList.toggle('open', isOpen);
    if (isOpen) renderActivityChart();
  });

  el('new-metric-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('new-metric-name').value.trim();
    const unit = el('new-metric-unit').value.trim() || 'items';
    const goalInput = el('new-metric-goal');
    const dailyGoal = goalInput ? parseInt(goalInput.value, 10) || 5 : 5;
    if (!name) return;

    const created = await TrackerStorage.addMetric({ name, color: selectedColor, unit, dailyGoal, icon: 'custom' });
    activeMetricId = created.id;
    el('new-metric-name').value = '';
    if (goalInput) goalInput.value = '5';
    el('new-metric-modal').classList.add('hidden');
    notifyCalendarTabs();
    await loadData();
  });

  // Live sync from content script and auth changes
  TrackerStorage.onChanged(() => loadData());
  TrackerAuth.onAuthChanged(() => loadData());

  await loadData();
});
