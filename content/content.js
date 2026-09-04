// Google Calendar Content Script — Job & Activity Tracker
(() => {
  let metrics = [];
  let stats = null;
  let allLogs = [];
  let knownMetricIds = new Set();
  let activeVisibleMetrics = new Set(['jobs', 'leetcode']);
  let isPanelOpen = false;
  let isDetailFormOpen = false;

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
    if (num >= 25000) {
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

  function formatDateNice(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
  async function refreshData() {
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
        badge.title = baseLabel + ' on ' + dateStr + ' (' + count + '/' + (m.dailyGoal || 1) + ' goal). Click to view details.';

        const dot = document.createElement('span');
        dot.className = 'pt-badge-dot';
        dot.style.backgroundColor = isGoalMet ? '#ffffff' : m.color;

        const text = document.createElement('span');
        text.className = 'pt-badge-text';
        text.textContent = label;

        badge.appendChild(dot);
        badge.appendChild(text);

        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          openDayModal(dateStr, false);
        });

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
          '<button class="pt-close-btn" id="pt-dock-close">&times;</button>',
        '</div>',
        '<div class="pt-panel-body">',

          // Google Account bar
          '<div id="pt-dock-account" style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#f8f9fa;border:1px solid #e8eaed;border-radius:6px;font-size:11px;">',
            '<div id="pt-dock-account-info" class="pt-hidden" style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">',
              '<div style="width:18px;height:18px;border-radius:50%;background:#1a73e8;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;" id="pt-dock-account-badge">G</div>',
              '<span id="pt-dock-account-email" style="font-weight:500;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;"></span>',
              '<button id="pt-dock-signout" style="background:none;border:none;color:#d93025;font-size:11px;font-weight:500;cursor:pointer;padding:2px 4px;">Sign Out</button>',
            '</div>',
            '<button id="pt-dock-signin" style="width:100%;background:#fff;border:1px solid #dadce0;border-radius:4px;padding:5px 8px;font-size:11px;font-weight:600;color:#202124;cursor:pointer;">Sign In with Google</button>',
          '</div>',

          // Hero card
          '<div class="pt-hero-card">',
            '<div class="pt-hero-count" id="pt-today-count">0</div>',
            '<div class="pt-hero-label" id="pt-today-label">jobs applied today</div>',
            '<div class="pt-action-row">',
              '<button class="pt-btn-primary" id="pt-quick-add-job">+1 Job Applied</button>',
              '<button class="pt-btn-secondary" id="pt-undo-job">-1</button>',
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
          '<div style="background:#f8f9fa;border:1px solid #e8eaed;border-radius:6px;padding:8px;font-size:11px;display:flex;justify-content:space-around;">',
            '<div style="text-align:center;">',
              '<div style="font-size:14px;font-weight:bold;color:#202124;" id="pt-stat-week">0</div>',
              '<div style="color:#5f6368;text-transform:uppercase;font-size:9px;">This Week</div>',
            '</div>',
            '<div style="width:1px;background:#dadce0;"></div>',
            '<div style="text-align:center;">',
              '<div style="font-size:14px;font-weight:bold;color:#202124;" id="pt-stat-month">0</div>',
              '<div style="color:#5f6368;text-transform:uppercase;font-size:9px;">This Month</div>',
            '</div>',
            '<div style="width:1px;background:#dadce0;"></div>',
            '<div style="text-align:center;">',
              '<div style="font-size:14px;font-weight:bold;color:#202124;" id="pt-stat-total">0</div>',
              '<div style="color:#5f6368;text-transform:uppercase;font-size:9px;">Total</div>',
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
    const quickAddJob = document.getElementById('pt-quick-add-job');
    const undoJob = document.getElementById('pt-undo-job');
    const detailsToggle = document.getElementById('pt-details-toggle');
    const detailsForm = document.getElementById('pt-details-form');
    const formSubmit = document.getElementById('pt-form-submit');
    const addTrackerBtn = document.getElementById('pt-add-tracker-btn');

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
      const notes = document.getElementById('pt-form-notes').value;

      await TrackerStorage.addLog({ metricId, count: 1, company, role, notes });

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

  async function updateActivityChart() {
    const barsContainer = document.getElementById('pt-activity-bars');
    if (!barsContainer) return;
    const history = await TrackerStorage.getActivityHistory(30);
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

      const tooltip = document.createElement('div');
      tooltip.className = 'pt-bar-tooltip';
      tooltip.textContent = day.label + ': ' + day.count;

      col.appendChild(bar);
      col.appendChild(tooltip);
      col.addEventListener('click', () => {
        openDayModal(day.date, false);
      });
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
        if (user && user.email) {
          if (info) info.classList.remove('pt-hidden');
          if (signin) signin.classList.add('pt-hidden');
          if (emailEl) emailEl.textContent = user.email;
          if (badgeEl) badgeEl.textContent = (user.name || user.email)[0].toUpperCase();
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
          await TrackerStorage.addLog({ metricId: m.id, count: 1 });
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
            if (confirm('Delete tracker "' + m.name + '" and all its entries?')) {
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
  // 3. DAY MODAL — view entries, add entries, delete entries
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
    const summaryText = summaryParts.length > 0 ? summaryParts.join(', ') : 'No entries';

    // Build entries HTML
    let entriesHTML = '';
    if (logs.length === 0) {
      entriesHTML = '<div class="pt-empty-state">No entries logged for this date.</div>';
    } else {
      logs.forEach(log => {
        const m = mMap[log.metricId] || { name: log.metricId, color: '#1a73e8' };
        const mainText = log.company || m.name;
        const sub = log.role ? log.role : '';
        const notes = log.notes ? log.notes : '';
        const time = formatTime(log.timestamp);

        entriesHTML += [
          '<div class="pt-entry-item" data-id="' + log.id + '">',
            '<div class="pt-entry-dot" style="background:' + m.color + '"></div>',
            '<div class="pt-entry-details">',
              '<div class="pt-entry-main">' + mainText + '</div>',
              sub ? '<div class="pt-entry-sub">' + sub + '</div>' : '',
              notes ? '<div class="pt-entry-sub" style="font-style:italic;">' + notes + '</div>' : '',
              '<div class="pt-entry-meta">' + m.name + ' &middot; ' + time + '</div>',
            '</div>',
            '<button class="pt-delete-entry" data-id="' + log.id + '" title="Delete">&times;</button>',
          '</div>'
        ].join('');
      });
    }

    // Metric options
    let metricOptions = '';
    metrics.forEach(m => {
      metricOptions += '<option value="' + m.id + '">' + m.name + '</option>';
    });

    backdrop.innerHTML = [
      '<div class="pt-modal-dialog">',
        '<div class="pt-modal-header">',
          '<div>',
            '<div class="pt-modal-header-title">' + formatDateNice(dateStr) + '</div>',
            '<div class="pt-modal-header-sub">' + summaryText + '</div>',
          '</div>',
          '<button class="pt-close-btn" id="pt-modal-close">&times;</button>',
        '</div>',
        '<div class="pt-modal-body">',
          '<div id="pt-modal-entries">' + entriesHTML + '</div>',
          '<div class="pt-modal-form">',
            '<label>Add entry for ' + dateStr + '</label>',
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

    // Delete entry buttons
    backdrop.querySelectorAll('.pt-delete-entry').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await TrackerStorage.deleteLog(btn.dataset.id);
        backdrop.remove();
        await refreshData();
        openDayModal(dateStr);
      });
    });

    // Add entry
    backdrop.querySelector('#pt-modal-add').addEventListener('click', async () => {
      const metricId = backdrop.querySelector('#pt-modal-metric').value;
      const company = backdrop.querySelector('#pt-modal-company').value;
      const role = backdrop.querySelector('#pt-modal-role').value;
      const notes = backdrop.querySelector('#pt-modal-notes').value;

      await TrackerStorage.addLog({ metricId, date: dateStr, count: 1, company, role, notes });
      backdrop.remove();
      await refreshData();
      openDayModal(dateStr);
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
      '<div class="pt-modal-dialog" style="width:380px;">',
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
  let debounceTimer = null;
  const observer = new MutationObserver((mutations) => {
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
    debounceTimer = setTimeout(() => renderBadges(), 100);
  });

  async function init() {
    mountFloatingDock();
    await refreshData();

    observer.observe(document.body, { childList: true, subtree: true });

    TrackerStorage.onChanged(() => refreshData());
    if (typeof TrackerAuth !== 'undefined') {
      TrackerAuth.onAuthChanged(() => refreshData());
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.logs || changes.metrics)) {
          refreshData();
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'PT_REFRESH') {
          refreshData();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
