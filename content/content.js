// Google Calendar Content Script — Job & Activity Tracker
(() => {
  let metrics = [];
  let stats = null;
  let allLogs = [];
  let knownMetricIds = new Set();
  let activeVisibleMetrics = new Set(['jobs', 'leetcode']);
  let isPanelOpen = false;
  let isDetailFormOpen = false;
  let currentTheme = 'light';

  // LeetCode Dock Timer State
  //
  // Persisted as a DEADLINE under DOCK_TIMER_KEY, never as a decrementing
  // counter. A counter dies with the page on reload or SPA teardown, and Chrome
  // throttles interval callbacks to roughly one per minute once the Calendar
  // tab is backgrounded, so a counted-down value drifts badly. Remaining time
  // is therefore always derived from the clock.
  // background/service-worker.js watches this same key and mirrors it into
  // chrome.alarms so zero is announced even with every page closed.
  //
  // Deliberately independent of the popup timer ('pt_timer_popup'): the two
  // records never share state and never sync to each other.
  const DOCK_TIMER_KEY = 'pt_timer_dock';

  let dockTimerTargetSeconds = 0;
  let dockTimerEndsAt = null;
  let dockTimerRemaining = 0;
  let dockTimerFinishedAt = null;
  let dockTimerInterval = null;
  let isDockTimerRunning = false;
  let dockTimerInputAtFocus = null;
  let isGlobalKeyHandlerBound = false;
  // Set while applying a record that came FROM storage, so echoing it back
  // cannot loop.
  let isApplyingStoredDockTimer = false;
  // Timestamp of our own most recent write, so the change event it triggers is
  // not mistaken for another tab's update and used to rebuild our interval.
  let lastPersistedDockTimerAt = 0;

  // Injectable so the countdown can be driven headlessly in tests.
  let nowMs = () => Date.now();

  function applyTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    const dock = document.getElementById('pt-floating-dock');
    if (dock) {
      dock.classList.toggle('pt-dark', currentTheme === 'dark');
    }
    const themeBtn = document.getElementById('pt-dock-theme-btn');
    if (themeBtn) {
      themeBtn.textContent = currentTheme === 'dark' ? 'Light' : 'Dark';
    }
    document.querySelectorAll('.pt-modal-dialog').forEach(dlg => {
      dlg.classList.toggle('pt-dark', currentTheme === 'dark');
    });
  }

  // Remaining time is derived, never accumulated: a missed or throttled tick
  // costs a stale pixel, not a wrong countdown.
  function getDockRemainingSeconds() {
    if (isDockTimerRunning && dockTimerEndsAt) {
      return Math.max(0, Math.round((dockTimerEndsAt - nowMs()) / 1000));
    }
    return Math.max(0, dockTimerRemaining);
  }

  function dockTimerRecord() {
    let status = 'idle';
    if (isDockTimerRunning) status = 'running';
    else if (dockTimerFinishedAt) status = 'finished';
    else if (dockTimerRemaining > 0 && dockTimerRemaining < dockTimerTargetSeconds) status = 'paused';
    return {
      status: status,
      targetSeconds: dockTimerTargetSeconds,
      endsAt: isDockTimerRunning ? dockTimerEndsAt : null,
      remainingSeconds: isDockTimerRunning ? getDockRemainingSeconds() : dockTimerRemaining,
      finishedAt: dockTimerFinishedAt,
      updatedAt: nowMs()
    };
  }

  // Writing the record is what arms or cancels the background alarm; the
  // service worker watches this key and needs no message from here. Fire and
  // forget so the timer controls stay synchronous.
  function persistDockTimer() {
    if (isApplyingStoredDockTimer) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      const record = dockTimerRecord();
      lastPersistedDockTimerAt = record.updatedAt;
      chrome.storage.local.set({ [DOCK_TIMER_KEY]: record }, () => {
        if (chrome.runtime && chrome.runtime.lastError) return;
      });
    } catch (err) {
      // A torn-down extension context must not break the dock.
    }
  }

  function applyStoredDockTimer(raw) {
    if (!raw || typeof raw !== 'object' || !raw.status) return false;
    isApplyingStoredDockTimer = true;
    dockTimerTargetSeconds = Math.max(0, parseInt(raw.targetSeconds, 10) || 0);
    dockTimerRemaining = Math.max(0, parseInt(raw.remainingSeconds, 10) || 0);
    dockTimerFinishedAt = Number.isFinite(raw.finishedAt) ? raw.finishedAt : null;
    dockTimerEndsAt = Number.isFinite(raw.endsAt) ? raw.endsAt : null;

    if (dockTimerInterval) {
      clearInterval(dockTimerInterval);
      dockTimerInterval = null;
    }
    isDockTimerRunning = false;

    if (raw.status === 'running' && dockTimerEndsAt) {
      if (dockTimerEndsAt > nowMs()) {
        isDockTimerRunning = true;
        dockTimerInterval = setInterval(tickDockTimer, 250);
      } else {
        // The countdown ran out while this page was closed or asleep.
        dockTimerRemaining = 0;
        dockTimerFinishedAt = dockTimerEndsAt;
        dockTimerEndsAt = null;
      }
    }
    isApplyingStoredDockTimer = false;
    syncDockTimerControls();
    return true;
  }

  // Recovers whatever the countdown did while this page was gone.
  function hydrateDockTimer() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.get([DOCK_TIMER_KEY], result => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        applyStoredDockTimer(result && result[DOCK_TIMER_KEY]);
      });
    } catch (err) {
      // Extension context invalidated; leave the dock timer idle.
    }
  }

  function syncDockTimerControls() {
    const btn = document.getElementById('pt-dock-timer-toggle');
    if (btn) {
      btn.textContent = isDockTimerRunning ? 'Pause' : 'Start';
      btn.classList.toggle('running', isDockTimerRunning);
    }
    updateDockTimerInputDisplay();
  }

  function updateDockTimerInputDisplay() {
    const inp = document.getElementById('pt-dock-timer-input');
    if (inp && document.activeElement !== inp) {
      inp.value = TrackerStorage.formatSecondsToMMSS(getDockRemainingSeconds());
    }
    if (inp) {
      inp.classList.toggle('pt-timer-expired', dockTimerFinishedAt !== null);
    }
  }

  function onDockTimerFinished() {
    dockTimerFinishedAt = dockTimerEndsAt || nowMs();
    dockTimerRemaining = 0;
    pauseDockTimer();
  }

  // Repaint tick. Correctness lives in the deadline, so this only decides when
  // to redraw and when the deadline has passed.
  function tickDockTimer() {
    if (!isDockTimerRunning) return;
    if (getDockRemainingSeconds() <= 0) {
      onDockTimerFinished();
      updateDockTimerInputDisplay();
      return;
    }
    updateDockTimerInputDisplay();
  }

  function startDockTimer() {
    if (isDockTimerRunning) return;
    const remaining = getDockRemainingSeconds();
    if (remaining <= 0) return;
    if (dockTimerTargetSeconds <= 0) dockTimerTargetSeconds = remaining;
    dockTimerFinishedAt = null;
    isDockTimerRunning = true;
    dockTimerEndsAt = nowMs() + remaining * 1000;
    dockTimerRemaining = remaining;
    // Defensive: an orphaned interval would double the repaint rate.
    if (dockTimerInterval) clearInterval(dockTimerInterval);
    dockTimerInterval = setInterval(tickDockTimer, 250);
    syncDockTimerControls();
    persistDockTimer();
  }

  function pauseDockTimer() {
    const wasRunning = isDockTimerRunning;
    if (wasRunning) dockTimerRemaining = getDockRemainingSeconds();
    isDockTimerRunning = false;
    dockTimerEndsAt = null;
    if (dockTimerInterval) {
      clearInterval(dockTimerInterval);
      dockTimerInterval = null;
    }
    syncDockTimerControls();
    if (wasRunning) persistDockTimer();
  }

  function resetDockTimer() {
    pauseDockTimer();
    dockTimerFinishedAt = null;
    dockTimerRemaining = dockTimerTargetSeconds;
    dockTimerEndsAt = null;
    syncDockTimerControls();
    persistDockTimer();
  }

  function getDockElapsedSeconds() {
    if (dockTimerTargetSeconds <= 0) return 0;
    return Math.max(0, dockTimerTargetSeconds - getDockRemainingSeconds());
  }

  // Ends the current solve session and hands back the elapsed seconds.
  // Countdown semantics: elapsed = target - remaining, never the remaining value.
  function consumeDockSolveTime() {
    const elapsed = getDockElapsedSeconds();
    pauseDockTimer();
    dockTimerRemaining = 0;
    dockTimerTargetSeconds = 0;
    dockTimerEndsAt = null;
    dockTimerFinishedAt = null;
    syncDockTimerControls();
    persistDockTimer();
    return elapsed;
  }

  // Applies a free-text edit of the timer field. Focusing the field without
  // changing it must not re-arm the countdown or discard elapsed progress.
  function applyDockTimerInput(rawValue, valueAtFocus) {
    if (valueAtFocus !== undefined && rawValue === valueAtFocus) return false;
    const parsed = TrackerStorage.parseStringToSeconds(rawValue);
    pauseDockTimer();
    dockTimerTargetSeconds = parsed;
    dockTimerRemaining = parsed;
    dockTimerEndsAt = null;
    dockTimerFinishedAt = null;
    syncDockTimerControls();
    persistDockTimer();
    return true;
  }

  function formatSolveTimeString(sec) {
    if (sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0 && s > 0) return 'Solve time: ' + m + 'm ' + s + 's';
    if (m > 0) return 'Solve time: ' + m + 'm';
    return 'Solve time: ' + s + 's';
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  const MONTHS_MAP = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6,
    july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
  };

  function dateFromDateKey(key) {
    const num = parseInt(key, 10);
    if (isNaN(num)) return null;

    // 1. Google Calendar internal bitshift encoding:
    // dateKey = (year - 1970) * 512 + (month - 1) * 32 + day + 32
    // The floor is the key for 1990-01-01. It used to be 25000, which is roughly
    // 2018-12; every earlier month fell through to the epoch-days branch below
    // and decoded ~19 years into the future, so the quick-add button on those
    // cells logged entries against the wrong date.
    if (num >= (1990 - 1970) * 512) {
      const yearOffset = (num - 32) % 512;
      const year = Math.floor((num - 32 - yearOffset) / 512) + 1970;
      const day = yearOffset % 32;
      const month = Math.floor((yearOffset - day) / 32) + 1;
      if (year >= 1970 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // 2. Fallback: Days since Unix epoch (or test mock)
    const ms = num * 86400000 + 43200000;
    const d = new Date(ms);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateFromElement(el) {
    if (!el) return null;

    // 1. Check data-date (ISO format YYYY-MM-DD)
    if (el.dataset && el.dataset.date && /^\d{4}-\d{2}-\d{2}$/.test(el.dataset.date)) {
      return el.dataset.date;
    }
    const childDate = el.querySelector && el.querySelector('[data-date]');
    if (childDate && childDate.dataset && childDate.dataset.date && /^\d{4}-\d{2}-\d{2}$/.test(childDate.dataset.date)) {
      return childDate.dataset.date;
    }

    // 2. Check aria-label on element or any child header/button
    const labelSources = [
      el.getAttribute && el.getAttribute('aria-label'),
      el.querySelector && el.querySelector('[aria-label]') && el.querySelector('[aria-label]').getAttribute('aria-label'),
      el.querySelector && el.querySelector('h2, [role="heading"], button') && (el.querySelector('h2, [role="heading"], button').getAttribute('aria-label') || el.querySelector('h2, [role="heading"], button').textContent)
    ];

    for (const label of labelSources) {
      if (!label) continue;

      // Day-first: "2 September 2026", "2nd September 2026", "2 Sep"
      const mDayFirst = label.match(/\b(\d{1,2})(?:st|nd|rd|th)?[,\s]+\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?:[,\s]+(\d{4}))?/i);
      if (mDayFirst) {
        const day = parseInt(mDayFirst[1], 10);
        const month = MONTHS_MAP[mDayFirst[2].toLowerCase()];
        const year = mDayFirst[3] ? parseInt(mDayFirst[3], 10) : new Date().getFullYear();
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }

      // Month-first: "September 2, 2026", "September 2nd", "Wednesday, September 2"
      const mMonthFirst = label.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b[,\s]+(\d{1,2})(?:st|nd|rd|th)?\b(?:[,\s]+(\d{4}))?/i);
      if (mMonthFirst) {
        const month = MONTHS_MAP[mMonthFirst[1].toLowerCase()];
        const day = parseInt(mMonthFirst[2], 10);
        const year = mMonthFirst[3] ? parseInt(mMonthFirst[3], 10) : new Date().getFullYear();
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }

    // 3. Check data-datekey with bitshift decode
    if (el.dataset && el.dataset.datekey) {
      const d = dateFromDateKey(el.dataset.datekey);
      if (d) return d;
    }
    const childWithKey = el.querySelector && el.querySelector('[data-datekey]');
    if (childWithKey && childWithKey.dataset && childWithKey.dataset.datekey) {
      const d = dateFromDateKey(childWithKey.dataset.datekey);
      if (d) return d;
    }

    return null;
  }

  // Entry text is user-supplied and is interpolated into innerHTML below, so a
  // company name containing "<" or "&" would otherwise corrupt or inject markup.
  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateNice(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function metricsMap() {
    const m = {};
    metrics.forEach(x => { m[x.id] = x; });
    return m;
  }

  function saveActiveVisibleMetrics() {
    const arr = Array.from(activeVisibleMetrics);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ pt_visible_metrics: arr });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pt_visible_metrics', JSON.stringify(arr));
    }
  }

  // ---------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------
  // Storage events, auth events and runtime messages can all land at once.
  // Chain refreshes so two overlapping passes cannot finish out of order and
  // paint the older snapshot over the newer one.
  let refreshChain = Promise.resolve();

  function refreshData() {
    refreshChain = refreshChain.then(doRefreshData, doRefreshData);
    return refreshChain;
  }

  async function doRefreshData() {
    [metrics, stats, allLogs] = await Promise.all([
      TrackerStorage.getMetrics(),
      TrackerStorage.getStats(),
      TrackerStorage.getLogs()
    ]);
    const currentMetricIds = new Set(metrics.map(m => m.id));

    let savedVisible = null;
    try {
      const res = await new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['pt_visible_metrics'], r);
        } else if (typeof localStorage !== 'undefined') {
          const v = localStorage.getItem('pt_visible_metrics');
          r({ pt_visible_metrics: v ? JSON.parse(v) : null });
        } else {
          r({});
        }
      });
      savedVisible = res.pt_visible_metrics;
    } catch (e) {}

    if (Array.isArray(savedVisible)) {
      activeVisibleMetrics = new Set(savedVisible.filter(id => currentMetricIds.has(id)));
      if (activeVisibleMetrics.size === 0 && metrics.length > 0) {
        activeVisibleMetrics.add(metrics[0].id);
      }
      metrics.forEach(m => knownMetricIds.add(m.id));
    } else {
      if (knownMetricIds.size === 0) {
        metrics.forEach(m => {
          knownMetricIds.add(m.id);
          activeVisibleMetrics.add(m.id);
        });
      } else {
        metrics.forEach(m => {
          if (!knownMetricIds.has(m.id)) {
            knownMetricIds.add(m.id);
            activeVisibleMetrics.add(m.id);
          }
        });
        for (const id of Array.from(knownMetricIds)) {
          if (!currentMetricIds.has(id)) {
            knownMetricIds.delete(id);
            activeVisibleMetrics.delete(id);
          }
        }
      }
    }
    renderBadges();
    updateDock();
  }

  function ensureQuickAddButton(cell, dateStr) {
    if (cell.querySelector('.pt-quick-add-cell')) return;
    const addBtn = document.createElement('button');
    addBtn.className = 'pt-quick-add-cell';
    addBtn.title = 'Log entry for ' + dateStr;
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openDayModal(dateStr, true);
    });
    cell.appendChild(addBtn);
  }

  // ---------------------------------------------------------------
  // 1. DAY CELL BADGES
  // ---------------------------------------------------------------
  function renderBadges() {
    if (!stats || !metrics.length) return;

    // Clean up any stray overlays or quick-add buttons in column headers or nav headers
    document.querySelectorAll('.pt-cell-overlay, .pt-quick-add-cell').forEach(item => {
      const parent = item.parentElement;
      if (!parent ||
          parent.getAttribute('role') === 'columnheader' ||
          parent.closest('[role="columnheader"], [role="rowheader"], header, aside, nav') ||
          (parent.offsetHeight > 0 && parent.offsetHeight < 50)) {
        item.remove();
      }
    });

    // Target actual calendar day cells (gridcells with sufficient height)
    const candidates = document.querySelectorAll('[role="gridcell"]');
    const seenCells = new Set();

    candidates.forEach(cell => {
      // Never render inside a column header, row header, sidebar, or header bar
      if (cell.getAttribute('role') === 'columnheader' ||
          cell.closest('[role="columnheader"], [role="rowheader"], header, aside, nav') ||
          (cell.offsetHeight > 0 && cell.offsetHeight < 50)) {
        return;
      }

      if (seenCells.has(cell)) return;
      seenCells.add(cell);

      const dateStr = parseDateFromElement(cell);
      if (!dateStr) return;

      const computedPos = window.getComputedStyle(cell).position;
      if (computedPos === 'static') {
        cell.style.position = 'relative';
      }

      // Calculate header offset to position badges directly under the date
      const headerEl = cell.querySelector('h2, [role="heading"], button, [class*="header"]') || cell.firstElementChild;
      let topOffset = 26;
      if (headerEl && headerEl.offsetHeight > 0 && headerEl.offsetHeight < 60) {
        topOffset = Math.max(24, headerEl.offsetTop + headerEl.offsetHeight + 2);
      }      const dateCounts = stats.dailyMap[dateStr] || {};
      const stateKeyParts = [];
      metrics.forEach(m => {
        if (!activeVisibleMetrics.has(m.id)) return;
        const count = dateCounts[m.id] || 0;
        if (count > 0) {
          const isGoalMet = m.dailyGoal && count >= m.dailyGoal;
          stateKeyParts.push(m.id + ':' + count + ':' + m.color + ':' + (isGoalMet ? '1' : '0'));
        }
      });
      const stateKey = stateKeyParts.join('|');

      const existing = cell.querySelector('.pt-cell-overlay');
      if (existing && existing.dataset.stateKey === stateKey) {
        existing.style.top = topOffset + 'px';
        ensureQuickAddButton(cell, dateStr);
        return;
      }

      if (existing) existing.remove();

      // If no counts to display for this day, don't leave an empty overlay
      if (stateKeyParts.length === 0) {
        ensureQuickAddButton(cell, dateStr);
        return;
      }

      const overlay = document.createElement('div');
      overlay.className = 'pt-cell-overlay';
      overlay.dataset.stateKey = stateKey;
      overlay.style.top = topOffset + 'px';

      metrics.forEach(m => {
        if (!activeVisibleMetrics.has(m.id)) return;
        const count = dateCounts[m.id] || 0;
        if (count <= 0) return;

        const isGoalMet = m.dailyGoal && count >= m.dailyGoal;
        const badge = document.createElement('div');
        badge.className = 'pt-badge' + (isGoalMet ? ' pt-goal-met' : '');
        if (isGoalMet) {
          badge.style.backgroundColor = m.color;
          badge.style.color = '#ffffff';
          badge.style.borderLeftColor = m.color;
        } else {
          badge.style.backgroundColor = m.color + '18';
          badge.style.color = m.color;
          badge.style.borderLeftColor = m.color;
        }

        const baseLabel = m.id === 'jobs'
          ? (count === 1 ? '1 Job Applied' : count + ' Jobs Applied')
          : (count + ' ' + m.name);
        const label = isGoalMet ? baseLabel + ' (Goal Met)' : baseLabel;
        badge.title = baseLabel + ' on ' + dateStr + ' (' + count + '/' + (m.dailyGoal || 1) + ' goal)';

        const dot = document.createElement('span');
        dot.className = 'pt-badge-dot';
        dot.style.backgroundColor = isGoalMet ? '#ffffff' : m.color;

        const text = document.createElement('span');
        text.className = 'pt-badge-text';
        text.textContent = label;

        badge.appendChild(dot);
        badge.appendChild(text);

        overlay.appendChild(badge);
      });

      cell.appendChild(overlay);
      ensureQuickAddButton(cell, dateStr);
    });
  }

  // ---------------------------------------------------------------
  // 2. FLOATING DOCK
  // ---------------------------------------------------------------
  function mountFloatingDock() {
    if (document.getElementById('pt-floating-dock')) return;

    const dock = document.createElement('div');
    dock.id = 'pt-floating-dock';

    dock.innerHTML = [
      '<button class="pt-dock-toggle" id="pt-dock-toggle">',
        '<span class="pt-dock-icon"></span>',
        '<span id="pt-dock-label">Tracker</span>',
        '<span class="pt-streak-pill" id="pt-dock-streak">0 day streak</span>',
      '</button>',
      '<div class="pt-dock-panel pt-hidden" id="pt-dock-panel">',
        '<div class="pt-panel-header">',
          '<span class="pt-panel-title">Application Tracker</span>',
          '<div style="display:flex;align-items:center;gap:6px;">',
            '<button type="button" id="pt-dock-theme-btn" class="pt-dock-theme-btn" title="Toggle theme">Dark</button>',
            '<button class="pt-close-btn" id="pt-dock-close">&times;</button>',
          '</div>',
        '</div>',
        '<div class="pt-panel-body">',

          // Google Account card (glass). Styled by content.css classes so the
          // dark theme can override without !important.
          '<div id="pt-dock-account" class="pt-glass-card pt-account-card">',
            '<div id="pt-dock-account-info" class="pt-account-info pt-hidden">',
              '<div class="pt-account-avatar" id="pt-dock-account-badge" aria-hidden="true">G</div>',
              '<div class="pt-account-meta">',
                '<span id="pt-dock-account-email" class="pt-account-email"></span>',
                '<span id="pt-dock-account-sub" class="pt-account-sub">Google Account</span>',
              '</div>',
              '<button type="button" id="pt-dock-signout" class="pt-account-signout" aria-label="Sign out of this Google Account">Sign out</button>',
            '</div>',
            '<button type="button" id="pt-dock-signin" class="pt-google-btn">',
              '<span class="pt-google-btn-icon" aria-hidden="true"><svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>',
              '<span class="pt-google-btn-label">Continue with Google</span>',
            '</button>',
          '</div>',

          // Hero card
          '<div class="pt-hero-card">',
            '<div class="pt-hero-count" id="pt-today-count">0</div>',
            '<div class="pt-hero-label" id="pt-today-label">jobs applied today</div>',
            '<div class="pt-action-row">',
              '<button type="button" class="pt-btn-primary pt-flow-btn" id="pt-quick-add-job">',
                '<span class="pt-flow-btn-circle" aria-hidden="true"></span>',
                '<span class="pt-flow-btn-arrow pt-flow-btn-arrow-in" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>',
                '<span class="pt-flow-btn-label">+1 Job Applied</span>',
                '<span class="pt-flow-btn-arrow pt-flow-btn-arrow-out" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>',
              '</button>',
              '<button class="pt-btn-secondary" id="pt-undo-job">-1</button>',
            '</div>',
          '</div>',

          // LeetCode Solve Timer (dock)
          '<div class="pt-timer-widget pt-hidden" id="pt-dock-timer-widget">',
            '<div class="pt-timer-header">',
              '<span class="pt-timer-title">LeetCode Solve Timer</span>',
              '<span class="pt-timer-hint">Click time to edit</span>',
            '</div>',
            '<div class="pt-timer-controls-row">',
              '<div class="pt-timer-input-wrap">',
                '<input type="text" id="pt-dock-timer-input" class="pt-timer-input" value="00:00" placeholder="00:00" spellcheck="false" autocomplete="off" />',
              '</div>',
              '<div class="pt-timer-btn-group">',
                '<button type="button" id="pt-dock-timer-toggle" class="pt-timer-btn pt-timer-btn-start">Start</button>',
                '<button type="button" id="pt-dock-timer-reset" class="pt-timer-btn pt-timer-btn-reset">Reset</button>',
              '</div>',
            '</div>',
          '</div>',

          // Secondary
          '<div class="pt-secondary-actions" id="pt-secondary-actions"></div>',

          // Details
          '<div>',
            '<button class="pt-details-toggle" id="pt-details-toggle">+ Log with details</button>',
            '<div class="pt-details-form pt-hidden" id="pt-details-form">',
              '<select id="pt-form-metric"></select>',
              '<input type="text" id="pt-form-company" placeholder="Company or problem name" />',
              '<input type="text" id="pt-form-role" placeholder="Role or tag" />',
              '<input type="text" id="pt-form-notes" placeholder="Notes or link" />',
              '<button class="pt-btn-primary" id="pt-form-submit" style="padding:6px;font-size:12px;">Save Entry</button>',
            '</div>',
          '</div>',

          // Trackers
          '<div>',
            '<div class="pt-section-title">',
              '<span>Trackers</span>',
              '<button id="pt-add-tracker-btn" style="background:none;border:none;color:#1a73e8;font-size:11px;cursor:pointer;font-weight:600;">+ Add</button>',
            '</div>',
            '<div class="pt-tracker-list" id="pt-tracker-list"></div>',
          '</div>',

          // 30-Day Activity
          '<div class="pt-activity-section">',
            '<button class="pt-activity-toggle" id="pt-activity-toggle">',
              '<span>30-Day Activity</span>',
              '<span id="pt-activity-arrow" style="font-size:10px;">\u25bc</span>',
            '</button>',
            '<div class="pt-activity-body pt-hidden" id="pt-activity-body">',
              '<div class="pt-activity-tabs" id="pt-activity-tabs" style="display:flex;gap:4px;margin-bottom:6px;overflow-x:auto;"></div>',
              '<div class="pt-chart-container" id="pt-activity-bars"></div>',
              '<div class="pt-activity-stats">',
                '<div><div class="pt-act-stat-num" id="pt-act-total">0</div><div class="pt-act-stat-lbl">30D Total</div></div>',
                '<div><div class="pt-act-stat-num" id="pt-act-avg">0.0</div><div class="pt-act-stat-lbl">Daily Avg</div></div>',
                '<div><div class="pt-act-stat-num" id="pt-act-days">0</div><div class="pt-act-stat-lbl">Active Days</div></div>',
                '<div><div class="pt-act-stat-num" id="pt-act-best">0</div><div class="pt-act-stat-lbl">Best Day</div></div>',
              '</div>',
            '</div>',
          '</div>',

          // Stats bar
          '<div class="pt-dock-stats-bar" style="background:#f8f9fa;border:1px solid #e8eaed;border-radius:6px;padding:8px;font-size:11px;display:flex;justify-content:space-around;">',
            '<div style="text-align:center;">',
              '<div class="pt-stat-val" style="font-size:14px;font-weight:bold;color:#202124;" id="pt-stat-week">0</div>',
              '<div class="pt-stat-lbl" style="color:#5f6368;text-transform:uppercase;font-size:9px;">This Week</div>',
            '</div>',
            '<div class="pt-stat-divider" style="width:1px;background:#dadce0;"></div>',
            '<div style="text-align:center;">',
              '<div class="pt-stat-val" style="font-size:14px;font-weight:bold;color:#202124;" id="pt-stat-month">0</div>',
              '<div class="pt-stat-lbl" style="color:#5f6368;text-transform:uppercase;font-size:9px;">This Month</div>',
            '</div>',
            '<div class="pt-stat-divider" style="width:1px;background:#dadce0;"></div>',
            '<div style="text-align:center;">',
              '<div class="pt-stat-val" style="font-size:14px;font-weight:bold;color:#202124;" id="pt-stat-total">0</div>',
              '<div class="pt-stat-lbl" style="color:#5f6368;text-transform:uppercase;font-size:9px;">Total</div>',
            '</div>',
          '</div>',

        '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(dock);
    setupDockListeners();
  }

  function setupDockListeners() {
    const toggleBtn = document.getElementById('pt-dock-toggle');
    const panel = document.getElementById('pt-dock-panel');
    const closeBtn = document.getElementById('pt-dock-close');
    const themeBtn = document.getElementById('pt-dock-theme-btn');
    const quickAddJob = document.getElementById('pt-quick-add-job');
    const undoJob = document.getElementById('pt-undo-job');
    const detailsToggle = document.getElementById('pt-details-toggle');
    const detailsForm = document.getElementById('pt-details-form');
    const formSubmit = document.getElementById('pt-form-submit');
    const addTrackerBtn = document.getElementById('pt-add-tracker-btn');

    const timerToggleBtn = document.getElementById('pt-dock-timer-toggle');
    const timerResetBtn = document.getElementById('pt-dock-timer-reset');
    const timerInput = document.getElementById('pt-dock-timer-input');

    if (themeBtn) {
      themeBtn.addEventListener('click', async () => {
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        await TrackerStorage.setTheme(nextTheme);
      });
    }

    if (timerToggleBtn) {
      timerToggleBtn.addEventListener('click', () => {
        if (isDockTimerRunning) pauseDockTimer(); else startDockTimer();
      });
    }

    if (timerResetBtn) {
      timerResetBtn.addEventListener('click', () => {
        resetDockTimer();
      });
    }

    if (timerInput) {
      timerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          timerInput.blur();
        }
      });
      timerInput.addEventListener('focus', () => {
        dockTimerInputAtFocus = timerInput.value;
      });
      timerInput.addEventListener('blur', () => {
        applyDockTimerInput(timerInput.value, dockTimerInputAtFocus);
        dockTimerInputAtFocus = null;
        updateDockTimerInputDisplay();
      });
    }

    // Bound once for the lifetime of the page: setupDockListeners runs again if
    // the SPA ever tears the dock out of the DOM, and a second window listener
    // would toggle the timer twice per keypress.
    if (!isGlobalKeyHandlerBound) {
      isGlobalKeyHandlerBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && isPanelOpen && !document.querySelector('.pt-modal-backdrop')) {
          const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
          if (activeTag !== 'input' && activeTag !== 'textarea') {
            e.preventDefault();
            if (isDockTimerRunning) pauseDockTimer(); else startDockTimer();
          }
        }
      });
    }

    toggleBtn.addEventListener('click', () => {
      isPanelOpen = !isPanelOpen;
      panel.classList.toggle('pt-hidden', !isPanelOpen);
    });

    closeBtn.addEventListener('click', () => {
      isPanelOpen = false;
      panel.classList.add('pt-hidden');
    });

    quickAddJob.addEventListener('click', async () => {
      await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });
      await refreshData();
    });

    undoJob.addEventListener('click', async () => {
      await TrackerStorage.undoLastLog('jobs');
      await refreshData();
    });

    detailsToggle.addEventListener('click', () => {
      isDetailFormOpen = !isDetailFormOpen;
      detailsForm.classList.toggle('pt-hidden', !isDetailFormOpen);
    });

    formSubmit.addEventListener('click', async () => {
      const metricId = document.getElementById('pt-form-metric').value;
      const company = document.getElementById('pt-form-company').value;
      const role = document.getElementById('pt-form-role').value;
      let notes = document.getElementById('pt-form-notes').value ? document.getElementById('pt-form-notes').value.trim() : '';

      let solveTimeSeconds = 0;
      if (metricId === 'leetcode' && dockTimerTargetSeconds > 0) {
        solveTimeSeconds = consumeDockSolveTime();
        if (solveTimeSeconds > 0) {
          const solveTimeStr = formatSolveTimeString(solveTimeSeconds);
          notes = notes ? `${notes} (${solveTimeStr})` : solveTimeStr;
        }
      }

      await TrackerStorage.addLog({ metricId, count: 1, company, role, notes, solveTimeSeconds });

      document.getElementById('pt-form-company').value = '';
      document.getElementById('pt-form-role').value = '';
      document.getElementById('pt-form-notes').value = '';
      isDetailFormOpen = false;
      detailsForm.classList.add('pt-hidden');
      await refreshData();
    });

    addTrackerBtn.addEventListener('click', () => {
      openCreateTrackerModal();
    });

    const signInBtn = document.getElementById('pt-dock-signin');
    const signOutBtn = document.getElementById('pt-dock-signout');

    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        try {
          await TrackerAuth.signInWithGoogle();
          await refreshData();
        } catch (err) {
          console.warn('Sign-in cancelled:', err.message);
        }
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await TrackerAuth.signOut();
        await refreshData();
      });
    }

    const actToggle = document.getElementById('pt-activity-toggle');
    const actBody = document.getElementById('pt-activity-body');
    const actArrow = document.getElementById('pt-activity-arrow');
    let isActOpen = false;
    if (actToggle && actBody) {
      actToggle.addEventListener('click', () => {
        isActOpen = !isActOpen;
        actBody.classList.toggle('pt-hidden', !isActOpen);
        if (actArrow) actArrow.textContent = isActOpen ? '\u25b2' : '\u25bc';
        if (isActOpen) updateActivityChart();
      });
    }
  }

  let dockChartMetricId = 'jobs';

  async function updateActivityChart() {
    const barsContainer = document.getElementById('pt-activity-bars');
    const tabsContainer = document.getElementById('pt-activity-tabs');
    if (!barsContainer) return;

    if (!metrics.some(m => m.id === dockChartMetricId)) {
      dockChartMetricId = metrics[0] ? metrics[0].id : 'jobs';
    }

    const current = metrics.find(m => m.id === dockChartMetricId) || { color: '#1a73e8', name: 'Jobs' };

    if (tabsContainer) {
      tabsContainer.innerHTML = '';
      metrics.forEach(m => {
        const tab = document.createElement('button');
        tab.className = 'pt-act-tab';
        const isSelected = m.id === dockChartMetricId;
        tab.style.padding = '2px 8px';
        tab.style.fontSize = '10px';
        tab.style.fontWeight = '600';
        tab.style.borderRadius = '10px';
        tab.style.border = '1px solid ' + (isSelected ? m.color : '#dadce0');
        tab.style.background = isSelected ? m.color : '#fff';
        tab.style.color = isSelected ? '#fff' : '#5f6368';
        tab.style.cursor = 'pointer';
        tab.textContent = m.name;
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          dockChartMetricId = m.id;
          updateActivityChart();
        });
        tabsContainer.appendChild(tab);
      });
    }

    const history = await TrackerStorage.getActivityHistory(30, dockChartMetricId);
    const totalEl = document.getElementById('pt-act-total');
    const avgEl = document.getElementById('pt-act-avg');
    const daysEl = document.getElementById('pt-act-days');
    const bestEl = document.getElementById('pt-act-best');

    if (totalEl) totalEl.textContent = history.totalCount;
    if (avgEl) avgEl.textContent = history.dailyAverage;
    if (daysEl) daysEl.textContent = history.activeDaysCount;
    if (bestEl) bestEl.textContent = history.bestDay.count;

    barsContainer.innerHTML = '';
    const maxVal = Math.max(4, ...history.days.map(d => d.count));
    history.days.forEach(day => {
      const col = document.createElement('div');
      col.className = 'pt-bar-col';

      const heightPct = Math.round((day.count / maxVal) * 100);
      const bar = document.createElement('div');
      bar.className = 'pt-bar' + (day.count > 0 ? ' has-activity' : '');
      bar.style.height = (day.count > 0 ? Math.max(10, heightPct) : 4) + '%';
      if (day.count > 0) {
        bar.style.backgroundColor = current.color;
      }

      const tooltip = document.createElement('div');
      tooltip.className = 'pt-bar-tooltip';
      tooltip.textContent = day.label + ': ' + day.count;

      col.appendChild(bar);
      col.appendChild(tooltip);
      barsContainer.appendChild(col);
    });
  }

  function updateDock() {
    if (!stats) return;

    // Update Account UI
    if (typeof TrackerAuth !== 'undefined') {
      TrackerAuth.getCurrentUser().then(user => {
        const info = document.getElementById('pt-dock-account-info');
        const signin = document.getElementById('pt-dock-signin');
        const emailEl = document.getElementById('pt-dock-account-email');
        const badgeEl = document.getElementById('pt-dock-account-badge');
        const subEl = document.getElementById('pt-dock-account-sub');
        if (user && user.email) {
          if (info) info.classList.remove('pt-hidden');
          if (signin) signin.classList.add('pt-hidden');
          if (emailEl) {
            emailEl.textContent = user.email;
            emailEl.title = user.email;
          }
          if (badgeEl) {
            badgeEl.textContent = '';
            if (user.picture) {
              const img = document.createElement('img');
              img.alt = '';
              img.referrerPolicy = 'no-referrer';
              img.src = user.picture;
              img.addEventListener('error', () => {
                badgeEl.textContent = (user.name || user.email)[0].toUpperCase();
              });
              badgeEl.appendChild(img);
            } else {
              badgeEl.textContent = (user.name || user.email)[0].toUpperCase();
            }
          }
          if (subEl) {
            const expired = user.sessionExpired === true;
            subEl.textContent = expired
              ? 'Session expired. Sign out and back in to reconnect.'
              : (user.token ? 'Google Account' : 'Google Account (email sign-in)');
            subEl.classList.toggle('pt-expired', expired);
          }
        } else {
          if (info) info.classList.add('pt-hidden');
          if (signin) signin.classList.remove('pt-hidden');
        }
      });
    }

    const jobsToday = stats.today.jobs || 0;

    const el = (id) => document.getElementById(id);

    el('pt-dock-label').textContent = jobsToday + ' Jobs Today';
    el('pt-dock-streak').textContent = (stats.currentStreak || 0) + ' day streak';
    el('pt-today-count').textContent = jobsToday;
    el('pt-stat-week').textContent = stats.thisWeek.jobs || 0;
    el('pt-stat-month').textContent = stats.thisMonth.jobs || 0;
    el('pt-stat-total').textContent = stats.totals.jobs || 0;

    // Metric dropdown
    const select = el('pt-form-metric');
    if (select) {
      select.innerHTML = '';
      metrics.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        select.appendChild(opt);
      });
    }

    // Secondary quick-add and undo buttons (non-jobs metrics)
    const secContainer = el('pt-secondary-actions');
    if (secContainer) {
      secContainer.innerHTML = '';
      metrics.filter(m => m.id !== 'jobs').forEach(m => {
        const todayC = stats.today[m.id] || 0;
        const row = document.createElement('div');
        row.className = 'pt-secondary-row';

        const addBtn = document.createElement('button');
        addBtn.className = 'pt-btn-metric';
        addBtn.id = 'pt-quick-add-' + m.id;
        addBtn.style.color = m.color;
        addBtn.style.borderColor = m.color + '60';
        addBtn.textContent = '+1 ' + m.name + ' (' + todayC + ')';
        addBtn.addEventListener('click', async () => {
          let notes = undefined;
          let solveTimeSeconds = 0;
          if (m.id === 'leetcode' && dockTimerTargetSeconds > 0) {
            solveTimeSeconds = consumeDockSolveTime();
            if (solveTimeSeconds > 0) notes = formatSolveTimeString(solveTimeSeconds);
          }
          await TrackerStorage.addLog({ metricId: m.id, count: 1, notes, solveTimeSeconds });
          await refreshData();
        });

        const undoBtn = document.createElement('button');
        undoBtn.className = 'pt-btn-secondary pt-btn-metric-undo';
        undoBtn.id = 'pt-undo-' + m.id;
        undoBtn.title = 'Undo last ' + m.name;
        undoBtn.textContent = '-1';
        undoBtn.addEventListener('click', async () => {
          await TrackerStorage.undoLastLog(m.id);
          await refreshData();
        });

        row.appendChild(addBtn);
        row.appendChild(undoBtn);
        secContainer.appendChild(row);
      });
    }

    // LeetCode Timer Widget visibility
    const timerWidgetEl = el('pt-dock-timer-widget');
    if (timerWidgetEl) {
      const hasLeetcode = metrics.some(m => m.id === 'leetcode');
      timerWidgetEl.classList.toggle('pt-hidden', !hasLeetcode);
      updateDockTimerInputDisplay();
    }

    // Trackers list with delete
    const trackerList = el('pt-tracker-list');
    if (trackerList) {
      trackerList.innerHTML = '';
      metrics.forEach(m => {
        const isVisible = activeVisibleMetrics.has(m.id);
        const item = document.createElement('div');
        item.className = 'pt-tracker-item';

        const left = document.createElement('div');
        left.className = 'pt-tracker-left';

        const cb = document.createElement('div');
        cb.className = 'pt-checkbox';
        cb.style.backgroundColor = isVisible ? m.color : 'transparent';
        cb.style.border = '2px solid ' + m.color;
        if (isVisible) cb.textContent = '\u2713';

        const label = document.createElement('span');
        label.style.fontWeight = '500';
        label.style.color = '#3c4043';
        label.textContent = m.name;

        const goalTag = document.createElement('span');
        goalTag.className = 'pt-goal-tag';
        goalTag.textContent = 'Goal: ' + (m.dailyGoal || 1);
        goalTag.title = 'Click to edit daily goal';
        goalTag.addEventListener('click', async (e) => {
          e.stopPropagation();
          const val = prompt('Set daily goal for ' + m.name + ':', m.dailyGoal || 1);
          if (val !== null && val.trim() !== '') {
            const num = parseInt(val.trim(), 10);
            if (!isNaN(num) && num > 0) {
              await TrackerStorage.setMetricGoal(m.id, num);
              await refreshData();
            }
          }
        });

        left.appendChild(cb);
        left.appendChild(label);
        left.appendChild(goalTag);

        const right = document.createElement('div');
        right.className = 'pt-tracker-right';

        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '11px';
        countSpan.style.color = '#5f6368';
        countSpan.style.fontWeight = '600';
        countSpan.textContent = stats.totals[m.id] || 0;
        right.appendChild(countSpan);

        // Delete button (only for non-default trackers)
        if (!m.isDefault) {
          const delBtn = document.createElement('button');
          delBtn.className = 'pt-delete-tracker-btn';
          delBtn.textContent = '\u00d7';
          delBtn.title = 'Delete "' + m.name + '" tracker';
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // Historical logs are deliberately preserved by deleteMetric, so do
            // not promise the user that their entries go away with the tracker.
            if (confirm('Delete tracker "' + m.name + '"? Entries already logged are kept in your history.')) {
              await TrackerStorage.deleteMetric(m.id);
              knownMetricIds.delete(m.id);
              activeVisibleMetrics.delete(m.id);
              saveActiveVisibleMetrics();
              await refreshData();
            }
          });
          right.appendChild(delBtn);
        }

        item.appendChild(left);
        item.appendChild(right);

        item.addEventListener('click', () => {
          if (activeVisibleMetrics.has(m.id)) {
            if (activeVisibleMetrics.size > 1) activeVisibleMetrics.delete(m.id);
          } else {
            activeVisibleMetrics.add(m.id);
          }
          saveActiveVisibleMetrics();
          updateDock();
          renderBadges();
        });

        trackerList.appendChild(item);
      });
    }

    updateActivityChart();
  }

  // ---------------------------------------------------------------
  // 3. DAY MODAL — add an entry for a date
  // ---------------------------------------------------------------
  async function openDayModal(dateStr, focusForm) {
    const old = document.getElementById('pt-day-modal');
    if (old) old.remove();

    const logs = await TrackerStorage.getLogs({ startDate: dateStr, endDate: dateStr });
    const mMap = metricsMap();

    const backdrop = document.createElement('div');
    backdrop.id = 'pt-day-modal';
    backdrop.className = 'pt-modal-backdrop';

    // Count summary per metric
    const counts = {};
    logs.forEach(l => {
      counts[l.metricId] = (counts[l.metricId] || 0) + (l.count || 1);
    });
    const summaryParts = Object.entries(counts).map(([id, c]) => {
      const m = mMap[id];
      return c + ' ' + (m ? m.name : id);
    });
    const summaryText = summaryParts.length > 0 ? summaryParts.join(', ') : 'Nothing logged yet';

    // Metric options
    let metricOptions = '';
    metrics.forEach(m => {
      metricOptions += '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name) + '</option>';
    });

    backdrop.innerHTML = [
      '<div class="pt-modal-dialog' + (currentTheme === 'dark' ? ' pt-dark' : '') + '">',
        '<div class="pt-modal-header">',
          '<div>',
            '<div class="pt-modal-header-title">' + escapeHtml(formatDateNice(dateStr)) + '</div>',
            '<div class="pt-modal-header-sub">' + escapeHtml(summaryText) + '</div>',
          '</div>',
          '<button class="pt-close-btn" id="pt-modal-close">&times;</button>',
        '</div>',
        '<div class="pt-modal-body">',
          '<div class="pt-modal-form">',
            '<label>Add entry for ' + escapeHtml(dateStr) + '</label>',
            '<select id="pt-modal-metric">' + metricOptions + '</select>',
            '<div class="pt-modal-form-row">',
              '<input type="text" id="pt-modal-company" placeholder="Company or title" />',
              '<input type="text" id="pt-modal-role" placeholder="Role or tag" />',
            '</div>',
            '<input type="text" id="pt-modal-notes" placeholder="Notes or link (optional)" />',
            '<button class="pt-btn-primary" id="pt-modal-add" style="padding:6px;font-size:12px;">Add Entry</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(backdrop);

    // Close
    backdrop.querySelector('#pt-modal-close').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    // Add entry, then close: the badge count is the only readout for a day.
    backdrop.querySelector('#pt-modal-add').addEventListener('click', async () => {
      const metricId = backdrop.querySelector('#pt-modal-metric').value;
      const company = backdrop.querySelector('#pt-modal-company').value;
      const role = backdrop.querySelector('#pt-modal-role').value;
      const notes = backdrop.querySelector('#pt-modal-notes').value;

      await TrackerStorage.addLog({ metricId, date: dateStr, count: 1, company, role, notes });
      backdrop.remove();
      await refreshData();
    });

    if (focusForm) {
      const companyInput = backdrop.querySelector('#pt-modal-company');
      if (companyInput) setTimeout(() => companyInput.focus(), 50);
    }
  }

  // ---------------------------------------------------------------
  // 4. CREATE TRACKER MODAL
  // ---------------------------------------------------------------
  function openCreateTrackerModal() {
    const old = document.getElementById('pt-create-modal');
    if (old) old.remove();

    const colors = ['#1a73e8','#1e8e3e','#d93025','#f9ab00','#9334e6','#007b83','#e52592','#e37400'];

    const backdrop = document.createElement('div');
    backdrop.id = 'pt-create-modal';
    backdrop.className = 'pt-modal-backdrop';

    let colorBtns = '';
    colors.forEach((c, i) => {
      colorBtns += '<button type="button" class="pt-color-btn' + (i === 4 ? ' pt-selected' : '') + '" data-color="' + c + '" style="background:' + c + ';"></button>';
    });

    backdrop.innerHTML = [
      '<div class="pt-modal-dialog' + (currentTheme === 'dark' ? ' pt-dark' : '') + '" style="width:380px;">',
        '<div class="pt-modal-header">',
          '<div class="pt-modal-header-title">Create New Tracker</div>',
          '<button class="pt-close-btn" id="pt-create-close">&times;</button>',
        '</div>',
        '<div class="pt-modal-body">',
          '<div class="pt-modal-form" style="border:none;padding-top:0;">',
            '<label>Name</label>',
            '<input type="text" id="pt-create-name" placeholder="e.g. Cold Emails, System Design" />',
            '<label>Unit label</label>',
            '<input type="text" id="pt-create-unit" placeholder="e.g. emails, sessions" value="items" />',
            '<label>Color</label>',
            '<div style="display:flex;gap:8px;" id="pt-create-colors">' + colorBtns + '</div>',
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">',
              '<button class="pt-btn-secondary" id="pt-create-cancel">Cancel</button>',
              '<button class="pt-btn-primary" id="pt-create-submit">Create</button>',
            '</div>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(backdrop);

    let selectedColor = '#9334e6';
    backdrop.querySelectorAll('.pt-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        backdrop.querySelectorAll('.pt-color-btn').forEach(b => b.classList.remove('pt-selected'));
        btn.classList.add('pt-selected');
        selectedColor = btn.dataset.color;
      });
    });

    backdrop.querySelector('#pt-create-close').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#pt-create-cancel').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    backdrop.querySelector('#pt-create-submit').addEventListener('click', async () => {
      const name = backdrop.querySelector('#pt-create-name').value.trim();
      const unit = backdrop.querySelector('#pt-create-unit').value.trim() || 'items';
      if (!name) return;

      const created = await TrackerStorage.addMetric({ name, color: selectedColor, unit, icon: 'custom' });
      knownMetricIds.add(created.id);
      activeVisibleMetrics.add(created.id);
      saveActiveVisibleMetrics();
      backdrop.remove();
      await refreshData();
    });
  }

  // ---------------------------------------------------------------
  // 5. OBSERVER & INIT
  // ---------------------------------------------------------------
  // Google Calendar is an SPA and can replace large parts of the document when
  // the user switches month/week/day. Re-mount the dock if it went with it,
  // restoring the transient state that does not live in storage.
  function ensureDockMounted() {
    if (document.getElementById('pt-floating-dock')) return;
    mountFloatingDock();
    applyTheme(currentTheme);
    const panel = document.getElementById('pt-dock-panel');
    if (panel) panel.classList.toggle('pt-hidden', !isPanelOpen);
    syncDockTimerControls();
    updateDock();
  }

  let debounceTimer = null;
  let observer = null;

  function createObserver() {
    return new MutationObserver((mutations) => {
      const isOnlyInternal = mutations && mutations.length > 0 && mutations.every(mutation => {
        const target = mutation.target;
        if (target && target.closest && (
          target.closest('.pt-cell-overlay') ||
          target.closest('#pt-floating-dock') ||
          target.closest('.pt-modal-backdrop')
        )) {
          return true;
        }
        return false;
      });

      if (isOnlyInternal) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        ensureDockMounted();
        renderBadges();
      }, 100);
    });
  }

  async function init() {
    mountFloatingDock();
    // Recover a countdown that kept running while this page was closed.
    hydrateDockTimer();
    TrackerStorage.onTimerChanged(DOCK_TIMER_KEY, (record) => {
      // Our own write, echoed back. Another Calendar tab or the service worker
      // closing out a countdown is what this listener is actually for.
      if (record && record.updatedAt === lastPersistedDockTimerAt) return;
      applyStoredDockTimer(record);
    });
    const savedTheme = await TrackerStorage.getTheme();
    applyTheme(savedTheme);
    await refreshData();

    observer = createObserver();
    observer.observe(document.body, { childList: true, subtree: true });

    // Single storage listener. A second raw chrome.storage.onChanged listener
    // used to live here as well, which meant every log write ran refreshData
    // (three storage reads plus a full re-render) twice.
    TrackerStorage.onChanged((changes) => {
      if (changes && changes.pt_theme) {
        applyTheme(changes.pt_theme.newValue);
      }
      refreshData();
    });

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'PT_REFRESH') {
          TrackerStorage.getTheme().then(t => {
            applyTheme(t);
            refreshData();
          });
        }
        // Returning a promise from an onMessage listener is not supported in MV3.
        return false;
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Test-only surface. `module` is undefined in a content script, so this block
  // never runs in the browser; the Node suite uses it to drive the pure helpers
  // and the solve-timer state machine without a real browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      dateFromDateKey,
      escapeHtml,
      formatSolveTimeString,
      applyDockTimerInput,
      consumeDockSolveTime,
      getDockElapsedSeconds,
      startDockTimer,
      pauseDockTimer,
      resetDockTimer,
      tickDockTimer,
      hydrateDockTimer,
      applyStoredDockTimer,
      dockTimerRecord,
      __setNow: (fn) => { nowMs = fn || (() => Date.now()); },
      getDockTimerState: () => ({
        seconds: getDockRemainingSeconds(),
        target: dockTimerTargetSeconds,
        running: isDockTimerRunning,
        hasInterval: dockTimerInterval !== null,
        finishedAt: dockTimerFinishedAt
      })
    };
  }
})();
