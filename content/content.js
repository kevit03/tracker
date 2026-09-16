// Google Calendar Content Script — Locked In
//
// Paints a badge with each day's counts into Google Calendar's day cells and
// offers a quick-add button per cell. Everything else (timers, charts, the
// tracker list, sign-in) lives in the popup.
(() => {
  let metrics = [];
  let stats = null;
  let currentTheme = 'light';

  // Theme is chosen in the popup and mirrored here for the day modal.
  function applyTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    document.querySelectorAll('.pt-modal-dialog').forEach(dlg => {
      dlg.classList.toggle('pt-dark', currentTheme === 'dark');
    });
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
    [metrics, stats] = await Promise.all([
      TrackerStorage.getMetrics(),
      TrackerStorage.getStats()
    ]);
    renderBadges();
  }

  // Only this cell's own overlay and button count. A nested or sibling cell
  // for the same date may hold its own (soon to be removed) copies, and those
  // must never be mistaken for ours.
  function ownChild(cell, className) {
    const kids = cell.children || [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains(className)) return kids[i];
    }
    return null;
  }

  function stripCell(cell) {
    ['pt-cell-overlay', 'pt-quick-add-cell'].forEach(cls => {
      const node = ownChild(cell, cls);
      if (node) node.remove();
    });
  }

  function ensureQuickAddButton(cell, dateStr) {
    if (ownChild(cell, 'pt-quick-add-cell')) return;
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
  // Badges sit directly under the cell's date header; a cell with no usable
  // header gets a fixed offset.
  function badgeTopOffset(cell) {
    const headerEl = cell.querySelector('h2, [role="heading"], button, [class*="header"]') || cell.firstElementChild;
    if (headerEl && headerEl.offsetHeight > 0 && headerEl.offsetHeight < 60) {
      return Math.max(24, headerEl.offsetTop + headerEl.offsetHeight + 2);
    }
    return 26;
  }

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

    // One badge per date. Week and Day views give a date more than one
    // gridcell (the all-day strip and the timed column, for instance), and
    // an event chip's aria-label can attribute its date to yet another
    // container. Keep the cell whose badge lands lowest on screen and strip
    // the rest, so a day is never announced twice.
    const hosts = {};
    const losers = [];
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

      const topOffset = badgeTopOffset(cell);
      const rect = typeof cell.getBoundingClientRect === 'function' ? cell.getBoundingClientRect() : { top: 0 };
      const badgeY = (rect.top || 0) + topOffset;
      const current = hosts[dateStr];
      if (!current) {
        hosts[dateStr] = { cell, dateStr, topOffset, badgeY };
        return;
      }
      if (badgeY >= current.badgeY) {
        losers.push(current.cell);
        hosts[dateStr] = { cell, dateStr, topOffset, badgeY };
      } else {
        losers.push(cell);
      }
    });

    losers.forEach(stripCell);

    Object.keys(hosts).forEach(key => {
      const { cell, dateStr, topOffset } = hosts[key];

      const computedPos = window.getComputedStyle(cell).position;
      if (computedPos === 'static') {
        cell.style.position = 'relative';
      }

      const dateCounts = stats.dailyMap[dateStr] || {};
      const stateKeyParts = [];
      metrics.forEach(m => {
        const count = dateCounts[m.id] || 0;
        if (count > 0) {
          const isGoalMet = m.dailyGoal && count >= m.dailyGoal;
          stateKeyParts.push(m.id + ':' + count + ':' + m.color + ':' + (isGoalMet ? '1' : '0'));
        }
      });
      const stateKey = stateKeyParts.join('|');

      const existing = ownChild(cell, 'pt-cell-overlay');
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
  // 2. DAY MODAL — add an entry for a date
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
  // 3. OBSERVER & INIT
  // ---------------------------------------------------------------
  let debounceTimer = null;
  let observer = null;

  function createObserver() {
    return new MutationObserver((mutations) => {
      const isOnlyInternal = mutations && mutations.length > 0 && mutations.every(mutation => {
        const target = mutation.target;
        if (target && target.closest && (
          target.closest('.pt-cell-overlay') ||
          target.closest('.pt-modal-backdrop')
        )) {
          return true;
        }
        return false;
      });

      if (isOnlyInternal) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderBadges, 100);
    });
  }

  async function init() {
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
  // and the badge renderer without a real browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      dateFromDateKey,
      escapeHtml,
      renderBadges,
      __setOverlayState: (next) => {
        if (next.metrics) metrics = next.metrics;
        if (next.stats) stats = next.stats;
      }
    };
  }
})();
