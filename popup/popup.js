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
  ['new-metric-modal', 'metric-settings-modal', 'edit-entry-modal', 'email-signin-modal'].forEach(id => {
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
  //
  // The countdown is persisted as a DEADLINE in chrome.storage.local rather
  // than held as a decrementing counter. Closing the popup tears down this
  // script's context outright, so a counter would die with it. A deadline keeps
  // running while the popup is shut and is recovered, still correct, the next
  // time it opens. background/service-worker.js watches this same key and
  // mirrors it into chrome.alarms so zero is announced even with everything
  // closed.
  //
  // This record is deliberately independent of the in-calendar dock timer
  // ('pt_timer_dock'). The two never share state and never sync.
  const TIMER_KEY = 'pt_timer_popup';
  const IDLE_TIMER = {
    status: 'idle',
    targetSeconds: 0,
    endsAt: null,
    remainingSeconds: 0,
    finishedAt: null,
    updatedAt: 0
  };

  let timerState = Object.assign({}, IDLE_TIMER);
  let timerTick = null;
  let announcedFinishAt = null;
  let timerInputAtFocus = null;

  const timerWidget = el('leetcode-timer-widget');
  const timerInput = el('timer-input');
  const timerToggleBtn = el('timer-toggle-btn');
  const timerResetBtn = el('timer-reset-btn');

  function isTimerRunning() {
    return timerState.status === 'running';
  }

  // Remaining time is always derived, never accumulated. Chrome throttles
  // interval callbacks hard in unfocused contexts, so a tick-based count drifts
  // badly; a clock reading cannot.
  function timerRemaining(now) {
    if (timerState.status === 'running' && timerState.endsAt) {
      return Math.max(0, Math.round((timerState.endsAt - (now || Date.now())) / 1000));
    }
    return Math.max(0, timerState.remainingSeconds || 0);
  }

  function getElapsedSeconds() {
    if (timerState.targetSeconds <= 0) return 0;
    return Math.max(0, timerState.targetSeconds - timerRemaining());
  }

  function normalizeTimerRecord(raw) {
    if (!raw || typeof raw !== 'object' || !raw.status) return Object.assign({}, IDLE_TIMER);
    return {
      status: raw.status,
      targetSeconds: Math.max(0, parseInt(raw.targetSeconds, 10) || 0),
      endsAt: Number.isFinite(raw.endsAt) ? raw.endsAt : null,
      remainingSeconds: Math.max(0, parseInt(raw.remainingSeconds, 10) || 0),
      finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : null,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    };
  }

  function readStoredTimer() {
    return new Promise(resolve => {
      chrome.storage.local.get([TIMER_KEY], result => {
        if (chrome.runtime.lastError) {
          resolve(Object.assign({}, IDLE_TIMER));
          return;
        }
        resolve(normalizeTimerRecord(result && result[TIMER_KEY]));
      });
    });
  }

  // Writing the record is what arms or cancels the background alarm. The
  // service worker watches this key, so the popup never has to message it.
  function persistTimer(next) {
    timerState = Object.assign({}, next, { updatedAt: Date.now() });
    renderTimer();
    return new Promise(resolve => {
      chrome.storage.local.set({ [TIMER_KEY]: timerState }, () => resolve(true));
    });
  }

  function renderTimer() {
    if (!timerInput || !timerToggleBtn) return;
    const running = isTimerRunning();
    timerToggleBtn.textContent = running ? 'Pause' : 'Start';
    timerToggleBtn.classList.toggle('running', running);
    // Never fight the user for the field while they are editing it.
    if (document.activeElement !== timerInput) {
      timerInput.value = TrackerStorage.formatSecondsToMMSS(timerRemaining());
    }
    timerInput.classList.toggle('timer-expired', timerState.status === 'finished');
  }

  // Kept for the existing call sites; rendering is now the whole job.
  function updateTimerInputDisplay() {
    renderTimer();
  }

  // Repaint only. Correctness lives in the deadline, so a missed or throttled
  // tick costs nothing but a stale pixel.
  function startRenderTick() {
    if (timerTick) return;
    timerTick = setInterval(() => {
      if (!isTimerRunning()) {
        stopRenderTick();
        return;
      }
      if (timerRemaining() <= 0) {
        finalizeTimer();
        return;
      }
      renderTimer();
    }, 250);
  }

  function stopRenderTick() {
    if (timerTick) {
      clearInterval(timerTick);
      timerTick = null;
    }
  }

  function announceFinished(finishedAt) {
    // The popup and the service worker can both notice zero. Announce once.
    if (announcedFinishAt === finishedAt) return;
    announcedFinishAt = finishedAt;
    showStatus('Time is up. Log the problem to save the full solve time, or press Reset.', 'error');
  }

  async function finalizeTimer() {
    stopRenderTick();
    const finishedAt = timerState.endsAt || Date.now();
    await persistTimer({
      status: 'finished',
      targetSeconds: timerState.targetSeconds,
      endsAt: null,
      remainingSeconds: 0,
      finishedAt: finishedAt
    });
    announceFinished(finishedAt);
  }

  async function startTimer() {
    if (isTimerRunning()) return;
    const remaining = timerRemaining();
    if (remaining <= 0) {
      showStatus('Type a countdown length in the timer box first, for example 25:00.', 'error');
      timerInput.focus();
      timerInput.select();
      return;
    }
    announcedFinishAt = null;
    await persistTimer({
      status: 'running',
      targetSeconds: timerState.targetSeconds > 0 ? timerState.targetSeconds : remaining,
      endsAt: Date.now() + remaining * 1000,
      remainingSeconds: remaining,
      finishedAt: null
    });
    startRenderTick();
  }

  async function pauseTimer() {
    if (!isTimerRunning()) return;
    const remaining = timerRemaining();
    stopRenderTick();
    await persistTimer({
      status: 'paused',
      targetSeconds: timerState.targetSeconds,
      endsAt: null,
      remainingSeconds: remaining,
      finishedAt: null
    });
  }

  async function resetTimer() {
    stopRenderTick();
    announcedFinishAt = null;
    await persistTimer({
      status: 'idle',
      targetSeconds: timerState.targetSeconds,
      endsAt: null,
      remainingSeconds: timerState.targetSeconds,
      finishedAt: null
    });
  }

  // Called once a solve has been logged: the countdown has served its purpose
  // and must not keep running or fire an alarm afterwards.
  async function clearTimerAfterLog() {
    stopRenderTick();
    announcedFinishAt = null;
    await persistTimer(Object.assign({}, IDLE_TIMER));
  }

  async function armTimer(seconds) {
    stopRenderTick();
    announcedFinishAt = null;
    await persistTimer({
      status: 'idle',
      targetSeconds: seconds,
      endsAt: null,
      remainingSeconds: seconds,
      finishedAt: null
    });
  }

  // Recovers whatever the countdown did while the popup was closed.
  async function hydrateTimer() {
    timerState = await readStoredTimer();
    if (timerState.status === 'running' && timerRemaining() <= 0) {
      await finalizeTimer();
      return;
    }
    if (timerState.status === 'finished' && timerState.finishedAt) {
      announcedFinishAt = timerState.finishedAt;
    }
    renderTimer();
    if (isTimerRunning()) startRenderTick();
  }

  // The service worker writes 'finished' when the alarm fires. If the popup
  // happens to be open at that moment, pick the change up live.
  if (TrackerStorage.onTimerChanged) {
    TrackerStorage.onTimerChanged(TIMER_KEY, (record) => {
      const next = normalizeTimerRecord(record);
      if (next.updatedAt === timerState.updatedAt) return;
      timerState = next;
      renderTimer();
      if (isTimerRunning()) startRenderTick(); else stopRenderTick();
      if (next.status === 'finished' && next.finishedAt) announceFinished(next.finishedAt);
    });
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
    if (isTimerRunning()) pauseTimer(); else startTimer();
  });

  timerResetBtn.addEventListener('click', () => {
    resetTimer();
  });

  timerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      timerInput.blur();
    }
  });

  // Focusing the field freezes its display, so a bare click-then-click-away
  // would otherwise blur a stale value and re-arm the countdown, wiping the
  // elapsed progress. Only a genuine edit re-arms.
  timerInput.addEventListener('focus', () => {
    timerInputAtFocus = timerInput.value;
  });

  timerInput.addEventListener('blur', () => {
    const atFocus = timerInputAtFocus;
    timerInputAtFocus = null;
    if (atFocus !== null && timerInput.value === atFocus) {
      renderTimer();
      return;
    }
    const raw = timerInput.value.trim();
    const parsed = TrackerStorage.parseStringToSeconds(timerInput.value);
    if (parsed === 0 && raw !== '' && !/^0+([:.]0+)*$/.test(raw)) {
      showStatus('Could not read "' + raw + '" as a time. Use mm:ss, for example 25:00.', 'error');
    }
    armTimer(parsed);
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
    if (isTimerRunning()) pauseTimer(); else startTimer();
  });

  async function updateAuthUI() {
    currentUser = await TrackerAuth.getCurrentUser();
    const info = el('account-info');
    const signInBtn = el('account-signin-btn');

    if (currentUser && currentUser.email) {
      info.classList.remove('hidden');
      signInBtn.classList.add('hidden');
      el('account-email').textContent = currentUser.email;
      el('account-email').title = currentUser.email;
      renderAvatar(el('account-badge'), currentUser);
      const sub = el('account-sub');
      if (sub) {
        const expired = currentUser.sessionExpired === true;
        sub.textContent = expired
          ? 'Session expired. Sign out and back in to reconnect.'
          : (currentUser.token ? 'Google Account' : 'Google Account (email sign-in)');
        sub.classList.toggle('expired', expired);
      }
    } else {
      info.classList.add('hidden');
      signInBtn.classList.remove('hidden');
    }
  }

  // Google profile photo when OAuth supplied one, otherwise the initial.
  function renderAvatar(node, user) {
    if (!node) return;
    node.textContent = '';
    if (user.picture) {
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = user.picture;
      img.addEventListener('error', () => {
        node.textContent = (user.name || user.email)[0].toUpperCase();
      });
      node.appendChild(img);
      return;
    }
    node.textContent = (user.name || user.email)[0].toUpperCase();
  }

  // Picks a readable foreground for text on a solid fill of the given color.
  // Tracker colors are user-chosen, so amber and other light fills must get
  // dark text rather than the white that suits blue.
  function readableTextOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    // 0.208 is the luminance at which white and #202124 give equal contrast
    // (0.179 would be the crossover against pure black, which we never use)
    return L > 0.208 ? '#202124' : '#ffffff';
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
    const quickAdd = el('quick-add-btn');
    quickAdd.style.setProperty('--flow-color', current.color);
    quickAdd.style.setProperty('--flow-on-color', readableTextOn(current.color));

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
      // Never let auth.js fall back to window.prompt: an MV3 popup can close
      // under that dialog. Unpaired builds get our own dialog instead.
      await TrackerAuth.signInWithGoogle(undefined, { allowPrompt: false });
      showStatus('Signed in. You are now seeing this account\'s data.', 'ok');
      await loadData();
    } catch (err) {
      if (err && err.code === 'EMAIL_REQUIRED') {
        el('email-signin-input').value = '';
        openModal(el('email-signin-modal'), 'email-signin-input');
        return;
      }
      console.warn('Sign-in cancelled or failed:', errMsg(err));
      showStatus('Sign-in did not complete: ' + errMsg(err), 'error');
    }
  });

  // Direct email sign-in dialog (unpacked builds with no GCP client paired)
  el('email-signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el('email-signin-input').value;
    try {
      await TrackerAuth.signInWithEmail(email);
    } catch (err) {
      showStatus('Sign-in did not complete: ' + errMsg(err), 'error');
      el('email-signin-input').focus();
      return;
    }
    closeModal(el('email-signin-modal'));
    showStatus('Signed in. You are now seeing this account\'s data.', 'ok');
    await loadData();
  });

  el('close-email-signin-modal').addEventListener('click', () => closeModal(el('email-signin-modal')));
  el('cancel-email-signin-btn').addEventListener('click', () => closeModal(el('email-signin-modal')));

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
    if (activeMetricId === 'leetcode' && timerState.targetSeconds > 0) {
      const elapsed = getElapsedSeconds();
      if (elapsed > 0) {
        notes = formatSolveTimeString(elapsed);
        solveTimeSeconds = elapsed;
      }
      await clearTimerAfterLog();
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
    if (activeMetricId === 'leetcode' && timerState.targetSeconds > 0) {
      const elapsed = getElapsedSeconds();
      if (elapsed > 0) {
        const solveTimeStr = formatSolveTimeString(elapsed);
        notes = notes ? `${notes} (${solveTimeStr})` : solveTimeStr;
        solveTimeSeconds = elapsed;
      }
      await clearTimerAfterLog();
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
    el('toggle-activity-btn').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) renderActivityChart();
  });

  el('new-metric-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('new-metric-name').value.trim();
    const unit = el('new-metric-unit').value.trim() || 'items';
    const goalInput = el('new-metric-goal');
    const dailyGoal = goalInput ? parseInt(goalInput.value, 10) || 5 : 5;
    if (!name) {
      showStatus('Give the tracker a name before adding it.', 'error');
      el('new-metric-name').focus();
      return;
    }

    let created;
    try {
      created = await TrackerStorage.addMetric({ name, color: selectedColor, unit, dailyGoal, icon: 'custom' });
    } catch (err) {
      showStatus('Could not create that tracker: ' + errMsg(err), 'error');
      return;
    }
    activeMetricId = created.id;
    el('new-metric-name').value = '';
    if (goalInput) goalInput.value = '5';
    closeModal(el('new-metric-modal'));
    showStatus('Tracker "' + created.name + '" added.', 'ok');
    notifyCalendarTabs();
    await loadData();
  });

  /* ---------- Entry history (view, edit, delete) ---------- */

  function rangeStartDate(range) {
    const today = TrackerStorage.getLocalDateStr();
    if (range === 'today') return today;
    if (range === 'week') return TrackerStorage.addDays(today, -6);
    if (range === 'month') return TrackerStorage.addDays(today, -29);
    return null;
  }

  function rangeLabel(range) {
    if (range === 'today') return 'today';
    if (range === 'week') return 'in the last 7 days';
    if (range === 'month') return 'in the last 30 days';
    return 'yet';
  }

  function formatEntryTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function formatEntryDate(dateStr) {
    const today = TrackerStorage.getLocalDateStr();
    if (dateStr === today) return 'Today';
    if (dateStr === TrackerStorage.addDays(today, -1)) return 'Yesterday';
    const d = TrackerStorage.parseLocalDateToNoon(dateStr);
    const opts = { month: 'short', day: 'numeric' };
    // Older-than-this-year entries surface in the All Time range; keep them unambiguous
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function buildEntryRow(log, metric) {
    const row = document.createElement('div');
    row.className = 'goal-meter entry-row';
    row.dataset.id = log.id;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    const head = document.createElement('div');
    head.className = 'goal-header';

    const title = document.createElement('span');
    title.className = 'goal-label entry-title';
    title.textContent = log.company || (metric ? metric.name : log.metricId);

    const when = document.createElement('span');
    when.className = 'goal-status entry-when';
    const timeText = formatEntryTime(log.timestamp);
    when.textContent = formatEntryDate(log.date) + (timeText ? ' ' + timeText : '');

    head.appendChild(title);
    head.appendChild(when);

    const parts = [];
    if (log.role) parts.push(log.role);
    if (log.notes) parts.push(log.notes);
    const solveSeconds = parseInt(log.solveTimeSeconds, 10) || 0;
    // The quick-add path already writes the solve time into notes; do not repeat it
    if (solveSeconds > 0 && !/solve time/i.test(log.notes || '')) {
      parts.push('Solve time: ' + TrackerStorage.formatTimeHMS(solveSeconds));
    }
    if ((log.count || 1) > 1) parts.push('Count: ' + log.count);

    const sub = document.createElement('div');
    sub.className = 'timer-hint entry-sub';
    sub.textContent = parts.length > 0 ? parts.join(' · ') : 'No details yet. Select to add a company, role, or notes.';

    row.appendChild(head);
    row.appendChild(sub);
    row.setAttribute('aria-label', 'Edit entry: ' + title.textContent + ', ' + when.textContent + '. ' + sub.textContent);

    row.addEventListener('click', () => openEntryEditor(log.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        openEntryEditor(log.id);
      }
    });
    return row;
  }

  async function renderEntries() {
    const list = el('entries-list');
    if (!list) return;

    const current = metrics.find(m => m.id === activeMetricId);
    const titleEl = el('entries-title');
    if (titleEl) {
      titleEl.textContent = current ? 'Recent ' + current.name + ' Entries' : 'Recent Entries';
    }

    const rangeBar = el('entries-range-bar');
    if (rangeBar) {
      rangeBar.querySelectorAll('.tab-item').forEach(btn => {
        const isOn = btn.dataset.range === entriesRange;
        btn.classList.toggle('active', isOn);
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      });
    }

    if (!entriesExpanded) return;

    const filter = { metricId: activeMetricId };
    const start = rangeStartDate(entriesRange);
    if (start) filter.startDate = start;

    const token = ++entriesToken;
    let logs;
    try {
      logs = await TrackerStorage.getLogs(filter);
    } catch (err) {
      showStatus('Could not load your entries: ' + errMsg(err), 'error');
      return;
    }
    // A newer render (tab switch, range change) already superseded this one
    if (token !== entriesToken) return;

    entryCache = {};
    list.innerHTML = '';
    const footnote = el('entries-footnote');

    if (logs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'timer-hint entries-empty';
      empty.textContent = 'No ' + (current ? current.name : 'tracker') + ' entries ' + rangeLabel(entriesRange)
        + '. Log one above, or widen the range.';
      list.appendChild(empty);
      if (footnote) footnote.textContent = '';
      return;
    }

    const shown = logs.slice(0, ENTRY_LIST_LIMIT);
    shown.forEach(log => {
      entryCache[log.id] = log;
      list.appendChild(buildEntryRow(log, current));
    });

    if (footnote) {
      const totalCount = logs.reduce((sum, l) => sum + (l.count || 1), 0);
      footnote.textContent = shown.length < logs.length
        ? 'Showing the newest ' + shown.length + ' of ' + logs.length + ' entries (' + totalCount + ' logged). Select an entry to edit or delete it.'
        : logs.length + ' entr' + (logs.length === 1 ? 'y' : 'ies') + ' (' + totalCount + ' logged). Select an entry to edit or delete it.';
    }
  }

  el('toggle-entries-btn').addEventListener('click', () => {
    const panel = el('entries-panel');
    entriesExpanded = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !entriesExpanded);
    el('entries-arrow').classList.toggle('open', entriesExpanded);
    el('toggle-entries-btn').setAttribute('aria-expanded', entriesExpanded ? 'true' : 'false');
    if (entriesExpanded) renderEntries();
  });

  el('entries-range-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-item');
    if (!btn || !btn.dataset.range) return;
    entriesRange = btn.dataset.range;
    renderEntries();
  });

  function openEntryEditor(logId) {
    const log = entryCache[logId];
    if (!log) {
      showStatus('That entry is no longer available. Refreshing the list.', 'error');
      loadData();
      return;
    }
    editingLogId = logId;
    entryDeleteArmed = false;
    el('delete-entry-btn').textContent = 'Delete entry';

    const metric = metrics.find(m => m.id === log.metricId);
    const timeText = formatEntryTime(log.timestamp);
    el('edit-entry-context').textContent = (metric ? metric.name : log.metricId) + ' · '
      + formatEntryDate(log.date) + (timeText ? ' ' + timeText : '');
    el('edit-entry-company').value = log.company || '';
    el('edit-entry-role').value = log.role || '';
    el('edit-entry-notes').value = log.notes || '';

    const solveSeconds = parseInt(log.solveTimeSeconds, 10) || 0;
    const timeGroup = el('edit-entry-time-group');
    if (log.metricId === 'leetcode' || solveSeconds > 0) {
      timeGroup.classList.remove('hidden');
      el('edit-entry-time').value = TrackerStorage.formatSecondsToMMSS(solveSeconds);
    } else {
      timeGroup.classList.add('hidden');
      el('edit-entry-time').value = '00:00';
    }

    openModal(el('edit-entry-modal'), 'edit-entry-company');
  }

  // Prefer a real in-place update; fall back to re-create + remove when the
  // storage layer has no updateLog. The replacement is written first so a
  // failure can never destroy the original entry.
  async function persistEntryEdit(original, patch) {
    if (typeof TrackerStorage.updateLog === 'function') {
      const updated = await TrackerStorage.updateLog(original.id, patch);
      return updated !== false && updated !== null;
    }

    const replacement = await TrackerStorage.addLog({
      metricId: original.metricId,
      count: original.count || 1,
      date: original.date,
      company: patch.company,
      role: patch.role,
      notes: patch.notes,
      solveTimeSeconds: patch.solveTimeSeconds
    });
    if (!replacement || !replacement.id) return false;

    const removed = await TrackerStorage.deleteLog(original.id);
    if (!removed) {
      // Roll the copy back so an edit can never silently duplicate an entry
      await TrackerStorage.deleteLog(replacement.id);
      return false;
    }
    return true;
  }

  el('edit-entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const original = entryCache[editingLogId];
    if (!original) {
      showStatus('That entry is no longer available.', 'error');
      closeModal(el('edit-entry-modal'));
      await loadData();
      return;
    }

    const timeGroup = el('edit-entry-time-group');
    const solveSeconds = timeGroup.classList.contains('hidden')
      ? (parseInt(original.solveTimeSeconds, 10) || 0)
      : TrackerStorage.parseStringToSeconds(el('edit-entry-time').value);

    const patch = {
      company: el('edit-entry-company').value.trim(),
      role: el('edit-entry-role').value.trim(),
      notes: el('edit-entry-notes').value.trim(),
      solveTimeSeconds: solveSeconds
    };

    let ok = false;
    try {
      ok = await persistEntryEdit(original, patch);
    } catch (err) {
      showStatus('Could not save your changes: ' + errMsg(err), 'error');
      return;
    }
    if (!ok) {
      showStatus('Could not save your changes. The entry was left untouched.', 'error');
      return;
    }

    editingLogId = null;
    closeModal(el('edit-entry-modal'));
    showStatus('Entry updated.', 'ok');
    notifyCalendarTabs();
    await loadData();
  });

  el('delete-entry-btn').addEventListener('click', async () => {
    const btn = el('delete-entry-btn');
    if (!entryDeleteArmed) {
      // Two-step confirm: popups cannot rely on window.confirm staying open
      entryDeleteArmed = true;
      btn.textContent = 'Select again to confirm';
      showStatus('Select "Select again to confirm" to permanently delete this entry.', 'error');
      return;
    }
    const target = editingLogId;
    let removed = false;
    try {
      removed = await TrackerStorage.deleteLog(target);
    } catch (err) {
      showStatus('Could not delete that entry: ' + errMsg(err), 'error');
      return;
    }
    entryDeleteArmed = false;
    btn.textContent = 'Delete entry';
    if (!removed) {
      showStatus('That entry could not be deleted. It may already be gone.', 'error');
    } else {
      showStatus('Entry deleted.', 'ok');
    }
    editingLogId = null;
    closeModal(el('edit-entry-modal'));
    notifyCalendarTabs();
    await loadData();
  });

  el('close-edit-entry-modal').addEventListener('click', () => closeModal(el('edit-entry-modal')));
  el('cancel-edit-entry-btn').addEventListener('click', () => closeModal(el('edit-entry-modal')));

  /* ---------- Tracker settings (daily goal, remove tracker) ---------- */

  function openMetricSettings() {
    const current = metrics.find(m => m.id === activeMetricId);
    if (!current) return;
    settingsMetricId = current.id;
    metricDeleteArmed = false;

    el('metric-settings-title').textContent = current.name + ' Settings';
    el('metric-settings-goal').value = current.dailyGoal || 1;

    const isBuiltIn = !!current.isDefault || current.id === 'jobs' || current.id === 'leetcode';
    const deleteBtn = el('delete-metric-btn');
    deleteBtn.textContent = 'Delete tracker';
    deleteBtn.classList.toggle('hidden', isBuiltIn);
    el('metric-settings-hint').textContent = isBuiltIn
      ? 'Built-in trackers cannot be removed. Changing the goal does not affect entries you already logged.'
      : 'Deleting this tracker removes its tab. Entries you already logged stay in storage and in your exports.';

    openModal(el('metric-settings-modal'), 'metric-settings-goal');
  }

  const goalTargetBtn = el('goal-target-num');
  if (goalTargetBtn) {
    goalTargetBtn.addEventListener('click', openMetricSettings);
    goalTargetBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        openMetricSettings();
      }
    });
  }

  el('metric-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const goal = parseInt(el('metric-settings-goal').value, 10);
    if (!goal || goal < 1) {
      showStatus('Enter a daily goal of 1 or more.', 'error');
      el('metric-settings-goal').focus();
      return;
    }
    try {
      await TrackerStorage.setMetricGoal(settingsMetricId, goal);
    } catch (err) {
      showStatus('Could not save that goal: ' + errMsg(err), 'error');
      return;
    }
    closeModal(el('metric-settings-modal'));
    showStatus('Daily goal set to ' + goal + '.', 'ok');
    notifyCalendarTabs();
    await loadData();
  });

  el('delete-metric-btn').addEventListener('click', async () => {
    const btn = el('delete-metric-btn');
    if (!metricDeleteArmed) {
      metricDeleteArmed = true;
      btn.textContent = 'Select again to confirm';
      showStatus('Select "Select again to confirm" to remove this tracker.', 'error');
      return;
    }
    let removed = false;
    try {
      removed = await TrackerStorage.deleteMetric(settingsMetricId);
    } catch (err) {
      showStatus('Could not delete that tracker: ' + errMsg(err), 'error');
      return;
    }
    metricDeleteArmed = false;
    btn.textContent = 'Delete tracker';
    if (!removed) {
      showStatus('That tracker could not be deleted.', 'error');
      return;
    }
    if (activeMetricId === settingsMetricId) activeMetricId = 'jobs';
    settingsMetricId = null;
    closeModal(el('metric-settings-modal'));
    showStatus('Tracker deleted. Its past entries are still in your export.', 'ok');
    notifyCalendarTabs();
    await loadData();
  });

  el('close-settings-modal').addEventListener('click', () => closeModal(el('metric-settings-modal')));
  el('cancel-settings-btn').addEventListener('click', () => closeModal(el('metric-settings-modal')));

  /* ---------- Export ---------- */

  function csvCell(value) {
    const s = (value === null || value === undefined) ? '' : String(value);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildCsv(logs, metricNames) {
    const rows = ['date,time,tracker,count,company,role,notes,solve_time_seconds'];
    logs.forEach(l => {
      rows.push([
        csvCell(l.date),
        csvCell(l.timestamp),
        csvCell(metricNames[l.metricId] || l.metricId),
        csvCell(l.count || 1),
        csvCell(l.company),
        csvCell(l.role),
        csvCell(l.notes),
        csvCell(parseInt(l.solveTimeSeconds, 10) || 0)
      ].join(','));
    });
    return rows.join('\r\n');
  }

  function downloadText(filename, text, mimeType) {
    try {
      const blob = new Blob([text], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (err) {
      console.warn('Download failed:', errMsg(err));
      return false;
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard copy failed:', errMsg(err));
    }
    return false;
  }

  async function exportData(format) {
    const isCsv = format === 'csv';
    let logs;
    try {
      logs = await TrackerStorage.getLogs({});
    } catch (err) {
      showStatus('Export failed: ' + errMsg(err), 'error');
      return;
    }
    if (logs.length === 0) {
      showStatus('Nothing to export yet. Log an entry first.', 'error');
      return;
    }

    // getLogs returns newest first; an export reads better oldest first
    const ordered = logs.slice().reverse();
    const metricNames = {};
    metrics.forEach(m => { metricNames[m.id] = m.name; });

    const text = isCsv
      ? buildCsv(ordered, metricNames)
      : JSON.stringify({
          exportedAt: new Date().toISOString(),
          account: (currentUser && currentUser.email) ? currentUser.email : null,
          metrics: metrics,
          logs: ordered
        }, null, 2);

    const filename = 'locked-in-tracker-' + TrackerStorage.getLocalDateStr() + (isCsv ? '.csv' : '.json');
    if (downloadText(filename, text, isCsv ? 'text/csv' : 'application/json')) {
      showStatus('Exported ' + ordered.length + ' entries to ' + filename + '.', 'ok');
      return;
    }
    const copied = await copyText(text);
    showStatus(copied
      ? 'The download was blocked, so the export was copied to your clipboard instead.'
      : 'Export failed: the browser blocked both the download and the clipboard.', copied ? 'ok' : 'error');
  }

  el('export-csv-btn').addEventListener('click', () => exportData('csv'));
  el('export-json-btn').addEventListener('click', () => exportData('json'));

  // Live sync from content script and auth changes
  TrackerStorage.onChanged(() => loadData());

  // One quick token check per popup open: evicts an expired OAuth token and
  // re-prompts, so the user is never shown as signed in against a dead session.
  try {
    await TrackerAuth.ensureValidSession();
  } catch (err) {
    console.warn('Session check skipped:', errMsg(err));
  }

  await loadData();
});
