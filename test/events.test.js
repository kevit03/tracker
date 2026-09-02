// Real-time storage change events and cross-tab/dock synchronization tests
const assert = require('assert');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

function getFreshModules(initialStore = {}) {
  const mock = installMockChrome(initialStore);
  delete require.cache[require.resolve('../shared/storage')];
  delete require.cache[require.resolve('../shared/auth')];
  const TrackerStorage = require('../shared/storage');
  const TrackerAuth = require('../shared/auth');
  return { mock, TrackerStorage, TrackerAuth };
}

async function run() {
  console.log('--- Running test/events.test.js ---');

  // 1. Storage Event Firing on Mutation Operations
  {
    const { TrackerStorage } = getFreshModules();

    const capturedChanges = [];
    TrackerStorage.onChanged(changes => {
      capturedChanges.push(changes);
    });

    // Mutation 1: Add log
    const log = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Event Test Corp' });
    await new Promise(r => setTimeout(r, 20));

    assert.ok(capturedChanges.length >= 1, 'Should capture at least 1 change event');
    const lastChange = capturedChanges[capturedChanges.length - 1];
    assert.ok(lastChange.logs, 'Change event should contain logs');
    assert.strictEqual(lastChange.logs.newValue.length, 1);

    // Mutation 2: Add metric
    const customMetric = await TrackerStorage.addMetric({ name: 'Event Custom', color: '#990099' });
    await new Promise(r => setTimeout(r, 20));

    const metricChange = capturedChanges[capturedChanges.length - 1];
    assert.ok(metricChange.metrics, 'Change event should contain metrics');

    // Mutation 3: Undo log
    await TrackerStorage.undoLastLog('jobs', log.date);
    await new Promise(r => setTimeout(r, 20));

    const undoChange = capturedChanges[capturedChanges.length - 1];
    assert.ok(undoChange.logs, 'Undo should emit logs change');
    assert.strictEqual(undoChange.logs.newValue.length, 0);

    console.log('[PASS] Storage event firing on mutations');
    uninstallMockChrome();
  }

  // 2. Multi-Listener Synchronization (Simulating Popup & Calendar Dock simultaneously)
  {
    const { TrackerStorage } = getFreshModules();

    let popupNotified = false;
    let calendarDockNotified = false;
    let dayModalNotified = false;

    // Simulate popup listener
    TrackerStorage.onChanged(changes => {
      if (changes.logs) popupNotified = true;
    });

    // Simulate calendar content script overlay dock listener
    TrackerStorage.onChanged(changes => {
      if (changes.logs) calendarDockNotified = true;
    });

    // Simulate day modal listener
    TrackerStorage.onChanged(changes => {
      if (changes.logs) dayModalNotified = true;
    });

    await TrackerStorage.addLog({ metricId: 'jobs', company: 'Multi-Listener Sync Test' });
    await new Promise(r => setTimeout(r, 25));

    assert.strictEqual(popupNotified, true, 'Popup listener must be notified');
    assert.strictEqual(calendarDockNotified, true, 'Calendar dock listener must be notified');
    assert.strictEqual(dayModalNotified, true, 'Day modal listener must be notified');

    console.log('[PASS] Multi-listener synchronization (popup, dock, modal)');
    uninstallMockChrome();
  }

  console.log('--- test/events.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
