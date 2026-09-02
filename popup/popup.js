// Popup Script for Job & Activity Tracker
document.addEventListener('DOMContentLoaded', async () => {
  let metrics = [];
  let stats = null;
  let activeMetricId = 'jobs';

  // Elements
  const currentDateText = document.getElementById('current-date-text');
  const streakCountEl = document.getElementById('streak-count');
  const metricTabsContainer = document.getElementById('metric-tabs');
  const addMetricTabBtn = document.getElementById('add-metric-tab-btn');
  const metricCountEl = document.getElementById('metric-count');
  const metricUnitLabelEl = document.getElementById('metric-unit-label');
  const quickAddBtn = document.getElementById('quick-add-btn');
  const quickAddLabel = document.getElementById('quick-add-label');
  const undoBtn = document.getElementById('undo-btn');
  const toggleDetailsBtn = document.getElementById('toggle-details-btn');
  const detailsForm = document.getElementById('details-form');
  const detailCompanyInput = document.getElementById('detail-company');
  const detailRoleInput = document.getElementById('detail-role');
  const detailNotesInput = document.getElementById('detail-notes');
  const statWeekEl = document.getElementById('stat-week');
  const statMonthEl = document.getElementById('stat-month');
  const statTotalEl = document.getElementById('stat-total');
  const openCalendarBtn = document.getElementById('open-calendar-btn');
  const newMetricModal = document.getElementById('new-metric-modal');
  const closeMetricModalBtn = document.getElementById('close-metric-modal');
  const cancelMetricBtn = document.getElementById('cancel-metric-btn');
  const newMetricForm = document.getElementById('new-metric-form');
  const newMetricNameInput = document.getElementById('new-metric-name');
  const newMetricIconInput = document.getElementById('new-metric-icon');
  const colorPalette = document.getElementById('color-palette');

  function formatDateHeader() {
    const d = new Date();
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  currentDateText.textContent = formatDateHeader();

  async function loadData() {
    [metrics, stats] = await Promise.all([
      TrackerStorage.getMetrics(),
      TrackerStorage.getStats()
    ]);
    renderUI();
  }

  function renderUI() {
    const currentMetric = metrics.find(m => m.id === activeMetricId) || metrics[0];
    activeMetricId = currentMetric.id;

    // Tabs
    metricTabsContainer.innerHTML = '';
    metrics.forEach(m => {
      const tab = document.createElement('button');
      tab.className = `tab-item ${m.id === activeMetricId ? 'active' : ''}`;
      if (m.id === activeMetricId) {
        tab.style.borderColor = m.color;
        tab.style.color = m.color;
      }
      tab.innerHTML = `<span>${m.icon || '🎯'}</span> <span>${m.name}</span>`;
      tab.addEventListener('click', () => {
        activeMetricId = m.id;
        renderUI();
      });
      metricTabsContainer.appendChild(tab);
    });

    // Counts
    const todayCount = (stats && stats.today && stats.today[activeMetricId]) || 0;
    const weekCount = (stats && stats.thisWeek && stats.thisWeek[activeMetricId]) || 0;
    const monthCount = (stats && stats.thisMonth && stats.thisMonth[activeMetricId]) || 0;
    const totalCount = (stats && stats.totals && stats.totals[activeMetricId]) || 0;

    metricCountEl.textContent = todayCount;
    metricUnitLabelEl.textContent = `${currentMetric.unit || 'items'} logged today`;
    quickAddLabel.textContent = `+1 ${currentMetric.unit ? currentMetric.unit.replace(/s$/, '') : 'Item'}`;
    quickAddBtn.style.backgroundColor = currentMetric.color;

    streakCountEl.textContent = (stats && stats.currentStreak) || 0;
    statWeekEl.textContent = weekCount;
    statMonthEl.textContent = monthCount;
    statTotalEl.textContent = totalCount;
  }

  // Quick Add (+1)
  quickAddBtn.addEventListener('click', async () => {
    metricCountEl.classList.add('bump');
    setTimeout(() => metricCountEl.classList.remove('bump'), 150);

    await TrackerStorage.addLog({
      metricId: activeMetricId,
      count: 1
    });
    await loadData();
  });

  // Undo (-1)
  undoBtn.addEventListener('click', async () => {
    await TrackerStorage.undoLastLog(activeMetricId);
    await loadData();
  });

  // Toggle Details
  toggleDetailsBtn.addEventListener('click', () => {
    detailsForm.classList.toggle('hidden');
  });

  // Submit Details
  detailsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const company = detailCompanyInput.value.trim();
    const role = detailRoleInput.value.trim();
    const notes = detailNotesInput.value.trim();

    await TrackerStorage.addLog({
      metricId: activeMetricId,
      count: 1,
      company,
      role,
      notes
    });

    detailCompanyInput.value = '';
    detailRoleInput.value = '';
    detailNotesInput.value = '';
    detailsForm.classList.add('hidden');
    await loadData();
  });

  // Open Google Calendar
  openCalendarBtn.addEventListener('click', () => {
    const url = 'https://calendar.google.com';
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

  closeMetricModalBtn.addEventListener('click', () => newMetricModal.classList.add('hidden'));
  cancelMetricBtn.addEventListener('click', () => newMetricModal.classList.add('hidden'));

  let selectedColor = '#1a73e8';
  colorPalette.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-option');
    if (!btn) return;
    colorPalette.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedColor = btn.dataset.color;
  });

  newMetricForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newMetricNameInput.value.trim();
    const icon = newMetricIconInput.value.trim() || '🎯';
    if (!name) return;

    const created = await TrackerStorage.addMetric({
      name,
      icon,
      color: selectedColor,
      unit: 'items'
    });

    activeMetricId = created.id;
    newMetricNameInput.value = '';
    newMetricModal.classList.add('hidden');
    await loadData();
  });

  // Listen for storage changes from Google Calendar content script
  TrackerStorage.onChanged(() => {
    loadData();
  });

  // Initial load
  await loadData();
});
