// Google Calendar Content Script for Job & Activity Tracker
(() => {
  let metrics = [];
  let stats = null;
  let activeVisibleMetrics = new Set(['jobs', 'leetcode']);
  let isPanelOpen = false;
  let isDetailFormOpen = false;

  // Convert Google Calendar data-datekey to YYYY-MM-DD
  function dateFromDateKey(key) {
    const num = parseInt(key, 10);
    if (isNaN(num)) return null;
    const d = new Date(1970, 0, 1);
    d.setDate(d.getDate() + num);
    return TrackerStorage.getLocalDateStr(d);
  }

  // Fallback date parser from aria-label or text
  function parseDateFromElement(el) {
    if (el.dataset && el.dataset.datekey) {
      return dateFromDateKey(el.dataset.datekey);
    }
    const label = el.getAttribute('aria-label') || '';
    const match = label.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (match) {
      const d = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
      if (!isNaN(d.getTime())) return TrackerStorage.getLocalDateStr(d);
    }
    return null;
  }

  // Load data
  async function refreshData() {
    [metrics, stats] = await Promise.all([
      TrackerStorage.getMetrics(),
      TrackerStorage.getStats()
    ]);
    renderBadges();
    updateDock();
  }

  // -------------------------------------------------------------
  // 1. INJECT DAY CELL BADGES ON GOOGLE CALENDAR
  // -------------------------------------------------------------
  function renderBadges() {
    if (!stats || !metrics.length) return;

    // Find all day cells in Month and Week views
    const dayCells = document.querySelectorAll('[data-datekey], [role="gridcell"]');
    const processedDates = new Set();

    dayCells.forEach(cell => {
      const dateStr = parseDateFromElement(cell);
      if (!dateStr) return;

      // Ensure relative positioning on the cell
      const computedPos = window.getComputedStyle(cell).position;
      if (computedPos === 'static') {
        cell.style.position = 'relative';
      }

      // Check or create overlay container
      let overlay = cell.querySelector('.pt-cell-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'pt-cell-overlay';
        cell.appendChild(overlay);
      }

      // Populate overlay
      const dateCounts = stats.dailyMap[dateStr] || {};
      overlay.innerHTML = '';

      // Check if any tracked metric has count > 0
      let hasData = false;
      metrics.forEach(m => {
        if (!activeVisibleMetrics.has(m.id)) return;
        const count = dateCounts[m.id] || 0;
        if (count > 0) {
          hasData = true;
          const badge = document.createElement('span');
          badge.className = 'pt-badge';
          badge.style.backgroundColor = `${m.color}18`;
          badge.style.color = m.color;
          badge.style.border = `1px solid ${m.color}40`;
          badge.title = `${count} ${m.name} on ${dateStr}. Click to view details.`;
          badge.innerHTML = `<span>${m.icon || '🎯'}</span> <span>${count}</span>`;

          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            openDayModal(dateStr);
          });

          overlay.appendChild(badge);
        }
      });

      // Quick add button on hover
      const quickAddBtn = document.createElement('button');
      quickAddBtn.className = 'pt-quick-add-cell';
      quickAddBtn.title = `Log application or activity for ${dateStr}`;
      quickAddBtn.textContent = '+';
      quickAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDayModal(dateStr, true);
      });
      overlay.appendChild(quickAddBtn);
    });
  }

  // -------------------------------------------------------------
  // 2. FLOATING IN-CALENDAR DOCK / SIDEBAR
  // -------------------------------------------------------------
  function mountFloatingDock() {
    if (document.getElementById('pt-floating-dock')) return;

    const dockContainer = document.createElement('div');
    dockContainer.id = 'pt-floating-dock';

    dockContainer.innerHTML = `
      <!-- Collapsed Button -->
      <button class="pt-dock-toggle" id="pt-dock-toggle">
        <span class="pt-icon">🎯</span>
        <span id="pt-dock-label">Jobs Tracker</span>
        <span class="pt-streak-pill" id="pt-dock-streak">🔥 0</span>
      </button>

      <!-- Slide-up Panel -->
      <div class="pt-dock-panel pt-hidden" id="pt-dock-panel">
        <div class="pt-panel-header">
          <div class="pt-panel-title">
            <span>🎯</span>
            <span>Application Tracker</span>
          </div>
          <button class="pt-close-btn" id="pt-dock-close">&times;</button>
        </div>

        <div class="pt-panel-body">
          <!-- Hero Card for Today's Jobs -->
          <div class="pt-hero-card">
            <div class="pt-hero-count" id="pt-today-count">0</div>
            <div class="pt-hero-label" id="pt-today-label">jobs applied today</div>
            <div class="pt-action-row">
              <button class="pt-btn-primary" id="pt-quick-add-job">+1 Job Applied</button>
              <button class="pt-btn-secondary" id="pt-undo-job" title="Undo / -1">-1</button>
            </div>
          </div>

          <!-- Secondary Trackers (LeetCode & Custom) -->
          <div class="pt-secondary-actions" id="pt-secondary-actions">
            <button class="pt-btn-metric" id="pt-quick-add-leetcode" style="color: #1e8e3e; border-color: #1e8e3e40;">
              <span>💡</span>
              <span>+1 LeetCode (<span id="pt-leetcode-count">0</span>)</span>
            </button>
          </div>

          <!-- Details Accordion -->
          <div>
            <button class="pt-details-toggle" id="pt-details-toggle">
              + Log with company name / notes
            </button>
            <div class="pt-details-form pt-hidden" id="pt-details-form">
              <select id="pt-form-metric" style="padding: 6px; font-size: 12px; border-radius: 4px; border: 1px solid #dadce0;">
                <!-- Populated dynamically -->
              </select>
              <input type="text" id="pt-form-company" placeholder="Company / Problem (e.g. Google, Two Sum)" />
              <input type="text" id="pt-form-role" placeholder="Role / Tag (e.g. SWE, Medium)" />
              <input type="text" id="pt-form-notes" placeholder="Notes or job link" />
              <button class="pt-btn-primary" id="pt-form-submit" style="padding: 6px; font-size: 12px;">Save Entry</button>
            </div>
          </div>

          <!-- Trackers List & Filter -->
          <div>
            <div class="pt-section-title">
              <span>Trackers on Calendar</span>
              <button id="pt-add-custom-tracker-btn" style="background:none; border:none; color:#1a73e8; font-size:11px; cursor:pointer; font-weight:600;">+ New</button>
            </div>
            <div class="pt-tracker-list" id="pt-tracker-list">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Stats Overview -->
          <div style="background:#f8f9fa; border: 1px solid #e8eaed; border-radius:8px; padding:10px; font-size:11px; display:flex; justify-content:space-around;">
            <div style="text-align:center;">
              <div style="font-size:14px; font-weight:bold; color:#202124;" id="pt-stat-week">0</div>
              <div style="color:#5f6368; text-transform:uppercase; font-size:9px;">This Week</div>
            </div>
            <div style="width:1px; background:#dadce0;"></div>
            <div style="text-align:center;">
              <div style="font-size:14px; font-weight:bold; color:#202124;" id="pt-stat-month">0</div>
              <div style="color:#5f6368; text-transform:uppercase; font-size:9px;">This Month</div>
            </div>
            <div style="width:1px; background:#dadce0;"></div>
            <div style="text-align:center;">
              <div style="font-size:14px; font-weight:bold; color:#202124;" id="pt-stat-total">0</div>
              <div style="color:#5f6368; text-transform:uppercase; font-size:9px;">Total Jobs</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dockContainer);
    setupDockListeners();
  }

  function setupDockListeners() {
    const toggleBtn = document.getElementById('pt-dock-toggle');
    const panel = document.getElementById('pt-dock-panel');
    const closeBtn = document.getElementById('pt-dock-close');
    const quickAddJob = document.getElementById('pt-quick-add-job');
    const undoJob = document.getElementById('pt-undo-job');
    const quickAddLeetcode = document.getElementById('pt-quick-add-leetcode');
    const detailsToggle = document.getElementById('pt-details-toggle');
    const detailsForm = document.getElementById('pt-details-form');
    const formSubmit = document.getElementById('pt-form-submit');
    const addCustomBtn = document.getElementById('pt-add-custom-tracker-btn');

    toggleBtn.addEventListener('click', () => {
      isPanelOpen = !isPanelOpen;
      panel.classList.toggle('pt-hidden', !isPanelOpen);
    });

    closeBtn.addEventListener('click', () => {
      isPanelOpen = false;
      panel.classList.add('pt-hidden');
    });

    // Quick +1 Job
    quickAddJob.addEventListener('click', async () => {
      await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });
      await refreshData();
    });

    // Undo Job
    undoJob.addEventListener('click', async () => {
      await TrackerStorage.undoLastLog('jobs');
      await refreshData();
    });

    // Quick +1 LeetCode
    quickAddLeetcode.addEventListener('click', async () => {
      await TrackerStorage.addLog({ metricId: 'leetcode', count: 1 });
      await refreshData();
    });

    // Details toggle
    detailsToggle.addEventListener('click', () => {
      isDetailFormOpen = !isDetailFormOpen;
      detailsForm.classList.toggle('pt-hidden', !isDetailFormOpen);
    });

    // Submit details
    formSubmit.addEventListener('click', async () => {
      const metricSelect = document.getElementById('pt-form-metric');
      const companyInput = document.getElementById('pt-form-company');
      const roleInput = document.getElementById('pt-form-role');
      const notesInput = document.getElementById('pt-form-notes');

      await TrackerStorage.addLog({
        metricId: metricSelect.value,
        count: 1,
        company: companyInput.value,
        role: roleInput.value,
        notes: notesInput.value
      });

      companyInput.value = '';
      roleInput.value = '';
      notesInput.value = '';
      isDetailFormOpen = false;
      detailsForm.classList.add('pt-hidden');
      await refreshData();
    });

    // Add custom tracker
    addCustomBtn.addEventListener('click', () => {
      openCreateTrackerModal();
    });
  }

  function updateDock() {
    if (!stats) return;

    const dockLabel = document.getElementById('pt-dock-label');
    const dockStreak = document.getElementById('pt-dock-streak');
    const todayCountEl = document.getElementById('pt-today-count');
    const leetcodeCountEl = document.getElementById('pt-leetcode-count');
    const statWeekEl = document.getElementById('pt-stat-week');
    const statMonthEl = document.getElementById('pt-stat-month');
    const statTotalEl = document.getElementById('pt-stat-total');
    const trackerListEl = document.getElementById('pt-tracker-list');
    const formMetricSelect = document.getElementById('pt-form-metric');

    const jobsToday = stats.today.jobs || 0;
    const leetToday = stats.today.leetcode || 0;

    if (dockLabel) dockLabel.textContent = `${jobsToday} Jobs Today`;
    if (dockStreak) dockStreak.textContent = `🔥 ${stats.currentStreak || 0}`;
    if (todayCountEl) todayCountEl.textContent = jobsToday;
    if (leetcodeCountEl) leetcodeCountEl.textContent = leetToday;

    if (statWeekEl) statWeekEl.textContent = stats.thisWeek.jobs || 0;
    if (statMonthEl) statMonthEl.textContent = stats.thisMonth.jobs || 0;
    if (statTotalEl) statTotalEl.textContent = stats.totals.jobs || 0;

    // Populate dropdown
    if (formMetricSelect) {
      formMetricSelect.innerHTML = '';
      metrics.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.icon || ''} ${m.name}`;
        formMetricSelect.appendChild(opt);
      });
    }

    // Populate trackers filter list
    if (trackerListEl) {
      trackerListEl.innerHTML = '';
      metrics.forEach(m => {
        const isVisible = activeVisibleMetrics.has(m.id);
        const item = document.createElement('div');
        item.className = 'pt-tracker-item';
        item.innerHTML = `
          <div class="pt-tracker-left">
            <div class="pt-checkbox" style="background-color: ${isVisible ? m.color : 'transparent'}; border: 2px solid ${m.color};">
              ${isVisible ? '✓' : ''}
            </div>
            <span style="font-weight: 500; color: #3c4043;">${m.name}</span>
          </div>
          <span style="font-size: 11px; color: #5f6368; font-weight: 600;">${stats.totals[m.id] || 0}</span>
        `;
        item.addEventListener('click', () => {
          if (activeVisibleMetrics.has(m.id)) {
            if (activeVisibleMetrics.size > 1) activeVisibleMetrics.delete(m.id);
          } else {
            activeVisibleMetrics.add(m.id);
          }
          updateDock();
          renderBadges();
        });
        trackerListEl.appendChild(item);
      });
    }
  }

  // -------------------------------------------------------------
  // 3. DAY DETAIL INSPECTOR MODAL
  // -------------------------------------------------------------
  async function openDayModal(dateStr, startWithForm = false) {
    const existing = document.getElementById('pt-day-modal');
    if (existing) existing.remove();

    const logs = await TrackerStorage.getLogs({ startDate: dateStr, endDate: dateStr });
    const modal = document.createElement('div');
    modal.id = 'pt-day-modal';
    modal.className = 'pt-modal-backdrop';

    const metricsMap = {};
    metrics.forEach(m => { metricsMap[m.id] = m; });

    modal.innerHTML = `
      <div class="pt-modal-dialog" id="pt-modal-dialog">
        <div class="pt-modal-header">
          <div>
            <div style="font-size: 15px; font-weight: 600; color: #202124;">${dateStr} Activity</div>
            <div style="font-size: 11px; color: #5f6368;" id="pt-modal-day-summary">
              ${logs.length} entries recorded
            </div>
          </div>
          <button class="pt-close-btn" id="pt-modal-close">&times;</button>
        </div>

        <div class="pt-modal-body">
          <!-- Entries List -->
          <div id="pt-modal-entries" style="display: flex; flex-direction: column; gap: 8px;">
            ${logs.map(log => {
              const m = metricsMap[log.metricId] || { name: log.metricId, color: '#1a73e8', icon: '🎯' };
              return `
                <div class="pt-entry-item" data-id="${log.id}">
                  <div style="display: flex; gap: 10px; align-items: flex-start;">
                    <span style="font-size: 16px;">${m.icon || '🎯'}</span>
                    <div>
                      <div style="font-weight: 600; color: #202124;">
                        ${log.company || m.name}
                        ${log.role ? `<span style="font-weight: normal; color: #5f6368;"> · ${log.role}</span>` : ''}
                      </div>
                      ${log.notes ? `<div style="font-size: 11px; color: #5f6368; margin-top: 2px;">${log.notes}</div>` : ''}
                      <div style="font-size: 10px; color: ${m.color}; font-weight: 600; margin-top: 3px;">
                        ${m.name} (+${log.count || 1})
                      </div>
                    </div>
                  </div>
                  <button class="pt-delete-entry" data-id="${log.id}" title="Delete entry">✕</button>
                </div>
              `;
            }).join('')}
            ${logs.length === 0 ? `<div style="text-align:center; color:#80868b; font-size:12px; padding:16px;">No entries logged for this date yet.</div>` : ''}
          </div>

          <!-- Add Entry Form -->
          <div style="border-top: 1px solid #e8eaed; padding-top: 12px;">
            <div style="font-size: 11px; font-weight: 600; color: #5f6368; text-transform: uppercase; margin-bottom: 8px;">
              + Add entry for this date
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <select id="pt-modal-select-metric" style="padding: 6px; font-size: 12px; border-radius: 4px; border: 1px solid #dadce0;">
                ${metrics.map(m => `<option value="${m.id}">${m.icon || ''} ${m.name}</option>`).join('')}
              </select>
              <input type="text" id="pt-modal-company" placeholder="Company / Problem name (e.g. Google, Two Sum)" style="padding: 6px; font-size: 12px; border-radius: 4px; border: 1px solid #dadce0;" />
              <input type="text" id="pt-modal-role" placeholder="Role / Tag (e.g. SWE Intern, Medium)" style="padding: 6px; font-size: 12px; border-radius: 4px; border: 1px solid #dadce0;" />
              <input type="text" id="pt-modal-notes" placeholder="Notes or link" style="padding: 6px; font-size: 12px; border-radius: 4px; border: 1px solid #dadce0;" />
              <button class="pt-btn-primary" id="pt-modal-add-btn" style="padding: 6px 12px; font-size: 12px;">Add to ${dateStr}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Modal listeners
    modal.querySelector('#pt-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Delete buttons
    modal.querySelectorAll('.pt-delete-entry').forEach(btn => {
      btn.addEventListener('click', async () => {
        await TrackerStorage.deleteLog(btn.dataset.id);
        modal.remove();
        await refreshData();
        openDayModal(dateStr);
      });
    });

    // Add entry
    modal.querySelector('#pt-modal-add-btn').addEventListener('click', async () => {
      const metricId = modal.querySelector('#pt-modal-select-metric').value;
      const company = modal.querySelector('#pt-modal-company').value;
      const role = modal.querySelector('#pt-modal-role').value;
      const notes = modal.querySelector('#pt-modal-notes').value;

      await TrackerStorage.addLog({
        metricId,
        date: dateStr,
        count: 1,
        company,
        role,
        notes
      });

      modal.remove();
      await refreshData();
      openDayModal(dateStr);
    });

    if (startWithForm) {
      modal.querySelector('#pt-modal-company').focus();
    }
  }

  // -------------------------------------------------------------
  // 4. CREATE CUSTOM TRACKER MODAL
  // -------------------------------------------------------------
  function openCreateTrackerModal() {
    const existing = document.getElementById('pt-create-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pt-create-modal';
    modal.className = 'pt-modal-backdrop';

    modal.innerHTML = `
      <div class="pt-modal-dialog">
        <div class="pt-modal-header">
          <span style="font-weight: 600; color: #202124;">Create New Tracker</span>
          <button class="pt-close-btn" id="pt-create-close">&times;</button>
        </div>
        <div class="pt-modal-body">
          <label style="font-size: 12px; font-weight: 600; color: #5f6368;">Tracker Name</label>
          <input type="text" id="pt-create-name" placeholder="e.g. Cold Emails, System Design, OA" style="padding: 8px; font-size: 13px; border: 1px solid #dadce0; border-radius: 6px;" />

          <label style="font-size: 12px; font-weight: 600; color: #5f6368; margin-top: 6px;">Icon Emoji</label>
          <input type="text" id="pt-create-icon" placeholder="e.g. ✉️, 📚, 💻" value="🎯" style="padding: 8px; font-size: 13px; border: 1px solid #dadce0; border-radius: 6px; width: 60px;" />

          <label style="font-size: 12px; font-weight: 600; color: #5f6368; margin-top: 6px;">Color</label>
          <div style="display: flex; gap: 8px;" id="pt-create-colors">
            <button type="button" class="pt-color-btn" data-color="#1a73e8" style="width:24px; height:24px; border-radius:50%; background:#1a73e8; border:2px solid black; cursor:pointer;"></button>
            <button type="button" class="pt-color-btn" data-color="#1e8e3e" style="width:24px; height:24px; border-radius:50%; background:#1e8e3e; border:none; cursor:pointer;"></button>
            <button type="button" class="pt-color-btn" data-color="#d93025" style="width:24px; height:24px; border-radius:50%; background:#d93025; border:none; cursor:pointer;"></button>
            <button type="button" class="pt-color-btn" data-color="#f9ab00" style="width:24px; height:24px; border-radius:50%; background:#f9ab00; border:none; cursor:pointer;"></button>
            <button type="button" class="pt-color-btn" data-color="#9334e6" style="width:24px; height:24px; border-radius:50%; background:#9334e6; border:none; cursor:pointer;"></button>
            <button type="button" class="pt-color-btn" data-color="#007b83" style="width:24px; height:24px; border-radius:50%; background:#007b83; border:none; cursor:pointer;"></button>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
            <button class="pt-btn-secondary" id="pt-create-cancel">Cancel</button>
            <button class="pt-btn-primary" id="pt-create-submit">Create Tracker</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let selectedColor = '#1a73e8';
    modal.querySelectorAll('.pt-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.pt-color-btn').forEach(b => b.style.border = 'none');
        btn.style.border = '2px solid black';
        selectedColor = btn.dataset.color;
      });
    });

    modal.querySelector('#pt-create-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#pt-create-cancel').addEventListener('click', () => modal.remove());

    modal.querySelector('#pt-create-submit').addEventListener('click', async () => {
      const name = modal.querySelector('#pt-create-name').value.trim();
      const icon = modal.querySelector('#pt-create-icon').value.trim() || '🎯';
      if (!name) return;

      const created = await TrackerStorage.addMetric({
        name,
        color: selectedColor,
        icon,
        unit: 'items'
      });
      activeVisibleMetrics.add(created.id);
      modal.remove();
      await refreshData();
    });
  }

  // -------------------------------------------------------------
  // 5. OBSERVER & INITIALIZATION
  // -------------------------------------------------------------
  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      renderBadges();
    }, 250);
  });

  async function init() {
    mountFloatingDock();
    await refreshData();

    // Observe calendar DOM changes (view switching, month next/prev)
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Listen to real-time storage changes (e.g. from popup)
    TrackerStorage.onChanged(() => {
      refreshData();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
