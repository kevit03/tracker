// Multi-account data isolation and cross-account mutation rejection tests
const assert = require('assert');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

function getFreshModules(initialStore = {}) {
  const mock = installMockChrome(initialStore);
  delete require.cache[require.resolve('../shared/auth')];
  delete require.cache[require.resolve('../shared/storage')];
  const TrackerAuth = require('../shared/auth');
  global.TrackerAuth = TrackerAuth;
  const TrackerStorage = require('../shared/storage');
  global.TrackerStorage = TrackerStorage;
  return { mock, TrackerStorage, TrackerAuth };
}

async function run() {
  console.log('--- Running test/isolation.test.js ---');

  // 1. Isolation between User A, User B, and Logged Out
  {
    const { TrackerStorage, TrackerAuth } = getFreshModules();

    // --- Logged Out (Anonymous) Session ---
    await TrackerAuth.signOut();
    const anonLog1 = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: 'Anon Corp',
      notes: 'Logged out application'
    });

    let anonLogs = await TrackerStorage.getLogs();
    assert.strictEqual(anonLogs.length, 1);
    assert.strictEqual(anonLogs[0].company, 'Anon Corp');

    let anonStats = await TrackerStorage.getStats();
    assert.strictEqual(anonStats.totals.jobs, 1);

    // --- User A Session ---
    await TrackerAuth.setUser({ email: 'user.a@example.com', name: 'User A' });

    const userALog1 = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: 'User A Corp 1'
    });
    const userALog2 = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: 'User A Corp 2'
    });
    const userALog3 = await TrackerStorage.addLog({
      metricId: 'leetcode',
      count: 5
    });

    let userALogs = await TrackerStorage.getLogs();
    assert.strictEqual(userALogs.length, 3, 'User A should see only their 3 logs');
    assert.ok(!userALogs.some(l => l.company === 'Anon Corp'), 'User A must not see anonymous logs');

    let userAStats = await TrackerStorage.getStats();
    assert.strictEqual(userAStats.totals.jobs, 2);
    assert.strictEqual(userAStats.totals.leetcode, 5);

    // --- User B Session ---
    await TrackerAuth.setUser({ email: 'user.b@example.com', name: 'User B' });

    let userBLogs = await TrackerStorage.getLogs();
    assert.strictEqual(userBLogs.length, 0, 'User B should have 0 logs initially');

    let userBStats = await TrackerStorage.getStats();
    assert.strictEqual(userBStats.totals.jobs, 0);
    assert.strictEqual(userBStats.totals.leetcode, 0);

    const userBLog1 = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: 'User B Corp 1'
    });

    userBLogs = await TrackerStorage.getLogs();
    assert.strictEqual(userBLogs.length, 1);
    assert.strictEqual(userBLogs[0].company, 'User B Corp 1');

    // Switch back to User A -> still sees only their 3 logs
    await TrackerAuth.setUser({ email: 'user.a@example.com', name: 'User A' });
    userALogs = await TrackerStorage.getLogs();
    assert.strictEqual(userALogs.length, 3);
    assert.ok(!userALogs.some(l => l.company === 'User B Corp 1'));

    console.log('[PASS] Multi-account log and stats isolation');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 2. Cross-Account Mutation Attacks Rejection
  {
    const { TrackerStorage, TrackerAuth } = getFreshModules();

    // Create entry as User A
    await TrackerAuth.setUser({ email: 'alice@example.com' });
    const aliceLog = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: 'Alice Target Corp'
    });
    const aliceMetric = await TrackerStorage.addMetric({
      name: 'Alice Custom Tracker',
      color: '#123456'
    });

    // Switch to User B (Bob)
    await TrackerAuth.setUser({ email: 'bob@example.com' });

    // Attack 1: Bob tries to delete Alice's log
    const delLogResult = await TrackerStorage.deleteLog(aliceLog.id);
    assert.strictEqual(delLogResult, false, 'Cross-account deleteLog must be rejected');

    // Attack 2: Bob tries to undo Alice's log
    const undoResult = await TrackerStorage.undoLastLog('jobs', aliceLog.date);
    assert.strictEqual(undoResult, false, 'Bob undoing when Bob has 0 logs must return false');

    // Attack 3: Bob tries to delete Alice's custom metric
    const delMetricResult = await TrackerStorage.deleteMetric(aliceMetric.id);
    assert.strictEqual(delMetricResult, false, 'Cross-account deleteMetric must be rejected');

    // Switch to Logged Out (Anonymous)
    await TrackerAuth.signOut();

    // Attack 4: Anonymous tries to delete Alice's log
    const anonDelLog = await TrackerStorage.deleteLog(aliceLog.id);
    assert.strictEqual(anonDelLog, false, 'Anonymous deleteLog on authenticated log must be rejected');

    // Attack 5: Anonymous tries to delete Alice's custom metric
    const anonDelMetric = await TrackerStorage.deleteMetric(aliceMetric.id);
    assert.strictEqual(anonDelMetric, false, 'Anonymous deleteMetric on authenticated custom metric must be rejected');

    // Switch back to Alice and verify everything is intact
    await TrackerAuth.setUser({ email: 'alice@example.com' });
    const aliceLogs = await TrackerStorage.getLogs();
    assert.strictEqual(aliceLogs.length, 1);
    assert.strictEqual(aliceLogs[0].id, aliceLog.id);

    const aliceMetrics = await TrackerStorage.getMetrics();
    assert.ok(aliceMetrics.some(m => m.id === aliceMetric.id));

    console.log('[PASS] Cross-account mutation attacks rejected');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 3. Email Casing Invariance in Multi-Account Scenarios
  {
    const { TrackerStorage, TrackerAuth } = getFreshModules();

    await TrackerAuth.setUser({ email: 'Dave.Miller@Domain.COM' });
    const log = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Dave Corp' });

    // Query with lowercase email
    await TrackerAuth.setUser({ email: 'dave.miller@domain.com' });
    const logs = await TrackerStorage.getLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, log.id);

    console.log('[PASS] Email casing invariance in multi-account scoping');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  console.log('--- test/isolation.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
