document.addEventListener('DOMContentLoaded', async () => {
  let metrics = [];
  let stats = null;
  let activeMetricId = 'jobs';
  let currentUser = null;

  // Entry history state
  let entriesRange = 'today';
  let entriesExpanded = true;
  let entryCache = {};
  let entriesToken = 0;
  let lcStatsToken = 0;

  // Modal state
  let editingLogId = null;
  let settingsMetricId = null;
  let entryDeleteArmed = false;
  let metricDeleteArmed = false;

  const ENTRY_LIST_LIMIT = 25;

  const el = (id) => document.getElementById(id);

  function errMsg(err) {
    return err && err.message ? err.message : 'unknown error';
  }

  // Single transient status / error line, announced via aria-live
  let statusTimer = null;
  function showStatus(message, tone) {
    const line = el('status-line');
    if (!line) return;
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    line.classList.remove('status-error', 'status-ok');
    if (!message) {
      line.textContent = '';
      line.classList.add('hidden');
      return;
    }
    line.textContent = message;
    line.classList.remove('hidden');
    if (tone) line.classList.add(tone === 'error' ? 'status-error' : 'status-ok');
    statusTimer = setTimeout(() => {
      line.textContent = '';
      line.classList.add('hidden');
      line.classList.remove('status-error', 'status-ok');
    }, 6000);
  }

  // Modal plumbing: Escape to close, Tab trapped inside, focus restored on close
  let openModalEl = null;
  let modalReturnFocusEl = null;

  function focusableIn(container) {
    const nodes = container.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(nodes, n => !n.disabled && n.offsetParent !== null);
  }

  function openModal(modal, firstFieldId) {
    if (!modal) return;
    modalReturnFocusEl = document.activeElement;
    openModalEl = modal;
    modal.classList.remove('hidden');
    const preferred = firstFieldId ? el(firstFieldId) : null;
    const target = (preferred && preferred.offsetParent !== null) ? preferred : focusableIn(modal)[0];
    if (target) target.focus();
  }

  function closeModal(modal) {
    const target = modal || openModalEl;
    if (!target) return;
    target.classList.add('hidden');
    if (target === openModalEl) {
      openModalEl = null;
      if (modalReturnFocusEl && typeof modalReturnFocusEl.focus === 'function') {
        modalReturnFocusEl.focus();
      }
      modalReturnFocusEl = null;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!openModalEl) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(openModalEl);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableIn(openModalEl);
    if (items.length === 0) return;
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (!openModalEl.contains(document.activeElement)) {
      e.preventDefault();
      firstItem.focus();
    } else if (e.shiftKey && document.activeElement === firstItem) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  });

  // Clicking the dimmed backdrop dismisses any modal
  ['new-metric-modal', 'metric-settings-modal', 'edit-entry-modal'].forEach(id => {
    const modal = el(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    }
  });

  function formatDateHeader() {
    return new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  el('current-date-text').textContent = formatDateHeader();

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('pt-dark', isDark);
    const btn = el('theme-toggle-btn');
    if (btn) btn.textContent = isDark ? 'Light' : 'Dark';
  }

  const initialTheme = await TrackerStorage.getTheme();
  applyTheme(initialTheme);

  el('theme-toggle-btn').addEventListener('click', async () => {
    const isDark = document.body.classList.contains('pt-dark');
    const nextTheme = isDark ? 'light' : 'dark';
    applyTheme(nextTheme);
    await TrackerStorage.setTheme(nextTheme);
    notifyCalendarTabs();
  });

  // LeetCode Timer State
  let timerSeconds = 0;
  let timerTargetSeconds = 0;
  let timerInterval = null;
  let isTimerRunning = false;

  const timerWidget = el('leetcode-timer-widget');
  const timerInput = el('timer-input');
  const timerToggleBtn = el('timer-toggle-btn');
  const timerResetBtn = el('timer-reset-btn');

  function updateTimerInputDisplay() {
    if (document.activeElement !== timerInput) {
      timerInput.value = TrackerStorage.formatSecondsToMMSS(timerSeconds);
    }
  }

  function onTimerFinished() {
    pauseTimer();
    showStatus('Time is up. Log the problem to save the full solve time, or press Reset.', 'error');
    timerInput.style.borderColor = '#d93025';
    timerInput.style.boxShadow = '0 0 0 2px rgba(217,48,37,0.2)';
    setTimeout(() => {
      timerInput.style.borderColor = '';
      timerInput.style.boxShadow = '';
    }, 2000);
  }

  function startTimer() {
    if (isTimerRunning) return;
    if (timerSeconds <= 0) {
      showStatus('Type a countdown length in the timer box first, for example 25:00.', 'error');
      timerInput.focus();
      timerInput.select();
      return;
    }
    if (timerTargetSeconds <= 0) timerTargetSeconds = timerSeconds;
    isTimerRunning = true;
    timerToggleBtn.textContent = 'Pause';
    timerToggleBtn.classList.add('running');
    timerInterval = setInterval(() => {
      timerSeconds--;
      updateTimerInputDisplay();
      if (timerSeconds <= 0) {
        onTimerFinished();
      }
    }, 1000);
  }

  function pauseTimer() {
    isTimerRunning = false;
    timerToggleBtn.textContent = 'Start';
    timerToggleBtn.classList.remove('running');
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function resetTimer() {
    pauseTimer();
    timerSeconds = timerTargetSeconds;
    updateTimerInputDisplay();
  }

  function getElapsedSeconds() {
    if (timerTargetSeconds <= 0) return 0;
    return Math.max(0, timerTargetSeconds - timerSeconds);
  }

  function formatSolveTimeString(sec) {
    if (sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0 && s > 0) return `Solve time: ${m}m ${s}s`;
    if (m > 0) return `Solve time: ${m}m`;
    return `Solve time: ${s}s`;
  }

  timerToggleBtn.addEventListener('click', () => {
    if (isTimerRunning) pauseTimer(); else startTimer();
  });

  timerResetBtn.addEventListener('click', () => {
    resetTimer();
  });

  timerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      timerInput.blur();
    }
  });

  timerInput.addEventListener('blur', () => {
    const raw = timerInput.value.trim();
    const parsed = TrackerStorage.parseStringToSeconds(timerInput.value);
    if (parsed === 0 && raw !== '' && !/^0+([:.]0+)*$/.test(raw)) {
      showStatus('Could not read "' + raw + '" as a time. Use mm:ss, for example 25:00.', 'error');
    }
    timerSeconds = parsed;
    timerTargetSeconds = parsed;
    updateTimerInputDisplay();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || activeMetricId !== 'leetcode') return;
    if (openModalEl) return;
    // Space belongs to whatever control has focus; only claim it when nothing does
    const active = document.activeElement;
    const activeTag = active ? active.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || activeTag === 'button') return;
    if (active && (active.isContentEditable || active.getAttribute('role') === 'button')) return;
    e.preventDefault();
    if (isTimerRunning) pauseTimer(); else startTimer();
  });

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

    // Show/hide timer widget and time stats
    const lcTimeStats = el('leetcode-time-stats');
    const lcTimeNote = el('leetcode-time-note');
    if (timerWidget) {
      if (activeMetricId === 'leetcode') {
        timerWidget.classList.remove('hidden');
        if (lcTimeStats) lcTimeStats.classList.remove('hidden');
        updateTimerInputDisplay();
        renderLeetcodeTimeStats();
      } else {
        timerWidget.classList.add('hidden');
        if (lcTimeStats) lcTimeStats.classList.add('hidden');
        if (lcTimeNote) lcTimeNote.classList.add('hidden');
      }
    }

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

    // Streak follows the active tracker rather than always reporting Job Applications
    const metricStreak = computeStreak(activeMetricId);
    el('streak-count').textContent = metricStreak;
    const streakPill = el('streak-pill');
    if (streakPill) {
      streakPill.title = metricStreak > 0
        ? metricStreak + ' consecutive day(s) with a ' + current.name + ' entry'
        : 'No active ' + current.name + ' streak. Log one today to start it.';
    }

    el('stat-week').textContent = weekCount;
    el('stat-month').textContent = monthCount;
    el('stat-total').textContent = totalCount;

    // First-run guidance: only for an account with no data at all
    const firstRunCard = el('first-run-card');
    if (firstRunCard) {
      const hasAnyData = !!(stats && stats.totalLogs > 0);
      firstRunCard.classList.toggle('hidden', hasAnyData);
      if (!hasAnyData) {
        el('first-run-tips').textContent = 'Press "+1 ' + unitSingular + '" to log one instantly, or open "Add details" to record a company, role, or notes. '
          + 'Select the daily goal number below to change it, and use Export at the bottom to take your history with you.';
      }
    }

    // Daily Goal progress
    const dailyGoal = current.dailyGoal || (current.id === 'jobs' ? 5 : (current.id === 'leetcode' ? 2 : 1));
    const goalTargetEl = el('goal-target-num');
    if (goalTargetEl) {
      goalTargetEl.textContent = dailyGoal;
      goalTargetEl.setAttribute('aria-label', 'Daily goal for ' + current.name + ' is ' + dailyGoal + '. Select to change it.');
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

    renderEntries();
    renderActivityChart();
  }

  // Consecutive days (ending today or yesterday) with at least one entry for a metric
  function computeStreak(metricId) {
    const dailyMap = (stats && stats.dailyMap) || {};
    const hasEntry = (dateStr) => ((dailyMap[dateStr] || {})[metricId] || 0) > 0;
    let checkDateStr = (stats && stats.todayStr) || TrackerStorage.getLocalDateStr();
    if (!hasEntry(checkDateStr)) {
      checkDateStr = TrackerStorage.addDays(checkDateStr, -1);
    }
    let streak = 0;
    while (hasEntry(checkDateStr)) {
      streak++;
      checkDateStr = TrackerStorage.addDays(checkDateStr, -1);
    }
    return streak;
  }

  // Cumulative solve-time block: today, all time, average, fastest, plus a trend line
  async function renderLeetcodeTimeStats() {
    const lcTimeStats = el('leetcode-time-stats');
    const note = el('leetcode-time-note');
    if (!lcTimeStats) return;

    const token = ++lcStatsToken;
    let timeStats;
    let lcLogs;
    try {
      [timeStats, lcLogs] = await Promise.all([
        TrackerStorage.getLeetcodeTimeStats(),
        TrackerStorage.getLogs({ metricId: 'leetcode' })
      ]);
    } catch (err) {
      showStatus('Could not load solve-time stats: ' + errMsg(err), 'error');
      return;
    }
    // Ignore a result that lost the race with a newer tab switch
    if (token !== lcStatsToken || activeMetricId !== 'leetcode') return;

    const timed = lcLogs.filter(l => (parseInt(l.solveTimeSeconds, 10) || 0) > 0);
    const bestSeconds = (typeof timeStats.bestSeconds === 'number' && timeStats.bestSeconds > 0)
      ? timeStats.bestSeconds
      : timed.reduce((best, l) => {
          const s = parseInt(l.solveTimeSeconds, 10) || 0;
          return (best === 0 || s < best) ? s : best;
        }, 0);

    el('lc-today-time').textContent = TrackerStorage.formatTimeHMS(timeStats.todaySeconds);
    el('lc-total-time').textContent = TrackerStorage.formatTimeHMS(timeStats.totalSeconds);
    el('lc-avg-time').textContent = timeStats.sessionCount > 0 ? TrackerStorage.formatTimeHMS(timeStats.avgSeconds) : '--';
    el('lc-best-time').textContent = bestSeconds > 0 ? TrackerStorage.formatTimeHMS(bestSeconds) : '--';

    if (!note) return;
    if (timed.length === 0) {
      note.textContent = 'No solve times recorded yet. Type a countdown, press Start, then log the problem to capture one.';
    } else {
      const lastSeconds = parseInt(timed[0].solveTimeSeconds, 10) || 0;
      const diff = timeStats.avgSeconds - lastSeconds;
      let trend;
      if (timed.length < 2) {
        trend = 'your first timed solve.';
      } else if (diff > 0) {
        trend = TrackerStorage.formatTimeHMS(diff) + ' faster than your average.';
      } else if (diff < 0) {
        trend = TrackerStorage.formatTimeHMS(-diff) + ' slower than your average.';
      } else {
        trend = 'exactly your average pace.';
      }
      note.textContent = 'Last timed solve ' + TrackerStorage.formatTimeHMS(lastSeconds) + ' — ' + trend
        + ' Timed ' + timed.length + ' of ' + lcLogs.length + ' logged problems.';
    }
    note.classList.remove('hidden');
  }

  // Google Sign In / Sign Out
  el('account-signin-btn').addEventListener('click', async () => {
    try {
      await TrackerAuth.signInWithGoogle();
      showStatus('Signed in. You are now seeing this account\'s data.', 'ok');
      await loadData();
    } catch (err) {
      console.warn('Sign-in cancelled or failed:', errMsg(err));
      showStatus('Sign-in did not complete: ' + errMsg(err), 'error');
    }
  });

  el('account-signout-btn').addEventListener('click', async () => {
    try {
      await TrackerAuth.signOut();
      showStatus('Signed out. Showing local, signed-out data.', 'ok');
      await loadData();
    } catch (err) {
      showStatus('Sign-out failed: ' + errMsg(err), 'error');
    }
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

    let notes = undefined;
    let solveTimeSeconds = 0;
    if (activeMetricId === 'leetcode' && timerTargetSeconds > 0) {
      const elapsed = getElapsedSeconds();
      if (elapsed > 0) {
        notes = formatSolveTimeString(elapsed);
        solveTimeSeconds = elapsed;
      }
      timerSeconds = 0;
      timerTargetSeconds = 0;
      pauseTimer();
      updateTimerInputDisplay();
    }

    try {
      await TrackerStorage.addLog({
        metricId: activeMetricId,
        count: 1,
        notes: notes,
        solveTimeSeconds: solveTimeSeconds
      });
    } catch (err) {
      showStatus('Could not save that entry: ' + errMsg(err), 'error');
      return;
    }
    if (solveTimeSeconds > 0) {
      showStatus('Logged with a solve time of ' + TrackerStorage.formatTimeHMS(solveTimeSeconds) + '.', 'ok');
    }
    notifyCalendarTabs();
    await loadData();
  });

  // -1
  el('undo-btn').addEventListener('click', async () => {
    let removed = false;
    try {
      removed = await TrackerStorage.undoLastLog(activeMetricId);
    } catch (err) {
      showStatus('Could not remove that entry: ' + errMsg(err), 'error');
      return;
    }
    if (!removed) {
      const current = metrics.find(m => m.id === activeMetricId);
      showStatus('Nothing logged today for ' + (current ? current.name : 'this tracker') + ', so there is nothing to remove.', 'error');
      return;
    }
    showStatus('Removed the most recent entry logged today.', 'ok');
    notifyCalendarTabs();
    await loadData();
  });

  // Details toggle
  el('toggle-details-btn').addEventListener('click', () => {
    const form = el('details-form');
    form.classList.toggle('hidden');
    const isOpen = !form.classList.contains('hidden');
    el('details-arrow').classList.toggle('open', isOpen);
    el('toggle-details-btn').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) el('detail-company').focus();
  });

  // Details submit
  el('details-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let notes = el('detail-notes').value ? el('detail-notes').value.trim() : '';
    let solveTimeSeconds = 0;
    if (activeMetricId === 'leetcode' && timerTargetSeconds > 0) {
      const elapsed = getElapsedSeconds();
      if (elapsed > 0) {
        const solveTimeStr = formatSolveTimeString(elapsed);
        notes = notes ? `${notes} (${solveTimeStr})` : solveTimeStr;
        solveTimeSeconds = elapsed;
      }
      timerSeconds = 0;
      timerTargetSeconds = 0;
      pauseTimer();
      updateTimerInputDisplay();
    }

    try {
      await TrackerStorage.addLog({
        metricId: activeMetricId,
        count: 1,
        company: el('detail-company').value,
        role: el('detail-role').value,
        notes: notes,
        solveTimeSeconds: solveTimeSeconds
      });
    } catch (err) {
      showStatus('Could not save that entry: ' + errMsg(err), 'error');
      return;
    }
    notifyCalendarTabs();
    el('detail-company').value = '';
    el('detail-role').value = '';
    el('detail-notes').value = '';
    el('details-form').classList.add('hidden');
    el('details-arrow').classList.remove('open');
    el('toggle-details-btn').setAttribute('aria-expanded', 'false');
    showStatus('Entry saved.', 'ok');
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
    openModal(el('new-metric-modal'), 'new-metric-name');
  });

  el('close-metric-modal').addEventListener('click', () => closeModal(el('new-metric-modal')));
  el('cancel-metric-btn').addEventListener('click', () => closeModal(el('new-metric-modal')));

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
