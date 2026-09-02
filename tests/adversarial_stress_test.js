/**
 * Empirical Adversarial Test Harness for Job & Activity Tracker
 * Challenger 2 (Round 2) — Full Multi-Account, Custom Tracker & Storage Event Verification Suite
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Mock Chrome Storage & Identity Environment
class MockChromeStorage {
  constructor() {
    this.store = {};
    this.listeners = [];
  }

  get(keys, cb) {
    const res = {};
    const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
    keyList.forEach(k => {
      if (this.store[k] !== undefined) {
        res[k] = JSON.parse(JSON.stringify(this.store[k]));
      }
    });
    setTimeout(() => cb(res), 0);
  }

  set(items, cb) {
    const changes = {};
    Object.entries(items).forEach(([k, v]) => {
      const oldValue = this.store[k] !== undefined ? JSON.parse(JSON.stringify(this.store[k])) : undefined;
      const newValue = JSON.parse(JSON.stringify(v));
      this.store[k] = newValue;
      changes[k] = { oldValue, newValue };
    });

    setTimeout(() => {
      this.listeners.forEach(fn => fn(changes, 'local'));
      if (cb) cb();
    }, 0);
  }

  clear() {
    this.store = {};
  }

  addListener(fn) {
    this.listeners.push(fn);
  }

  removeListener(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
}

const mockStorage = new MockChromeStorage();

global.chrome = {
  runtime: {
    lastError: null
  },
  storage: {
    local: {
      get: (keys, cb) => mockStorage.get(keys, cb),
      set: (items, cb) => mockStorage.set(items, cb),
    },
    onChanged: {
      addListener: (fn) => mockStorage.addListener(fn),
      removeListener: (fn) => mockStorage.removeListener(fn)
    }
  },
  identity: {
    getAuthToken: (opts, cb) => cb('mock-token-123'),
    removeCachedAuthToken: (opts, cb) => cb()
  }
};

// Load modules & expose to global scope as in browser extension runtime
const TrackerAuth = require(path.join(__dirname, '../shared/auth.js'));
global.TrackerAuth = TrackerAuth;
const TrackerStorage = require(path.join(__dirname, '../shared/storage.js'));
global.TrackerStorage = TrackerStorage;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failures.push({ name, error: err });
  }
}

async function runAllTests() {
  console.log('===============================================================');
  console.log('CHALLENGER 2 — ADVERSARIAL EMPIRICAL VERIFICATION SUITE (ROUND 2)');
  console.log('===============================================================\n');

  // -----------------------------------------------------------------
  // SUITE 1: Multi-User Isolation & Session Transitions
  // -----------------------------------------------------------------
  console.log('--- Suite 1: Multi-User Isolation & Session Transitions ---');
  mockStorage.clear();

  await test('1.1: Account A logs 5 jobs, logs out -> logged-out view sees 0 logs and 0 stats', async () => {
    await TrackerAuth.setUser({ email: 'userA@gmail.com', name: 'User A' });
    const userA = await TrackerAuth.getCurrentUser();
    assert.strictEqual(userA.email, 'usera@gmail.com');

    for (let i = 1; i <= 5; i++) {
      await TrackerStorage.addLog({ metricId: 'jobs', company: `Company A${i}`, count: 1 });
    }

    const logsA = await TrackerStorage.getLogs();
    assert.strictEqual(logsA.length, 5, 'User A should see 5 logs');

    const statsA = await TrackerStorage.getStats();
    assert.strictEqual(statsA.totals.jobs, 5, 'User A total jobs should be 5');
    assert.strictEqual(statsA.currentStreak, 1, 'User A streak should be 1');

    // User A logs out
    await TrackerAuth.signOut();
    const currentUser = await TrackerAuth.getCurrentUser();
    assert.strictEqual(currentUser, null, 'Current user should be null after sign out');

    // Logged-out view check
    const loggedOutLogs = await TrackerStorage.getLogs();
    assert.strictEqual(loggedOutLogs.length, 0, 'Logged-out view must see 0 logs from User A');

    const loggedOutStats = await TrackerStorage.getStats();
    assert.strictEqual(loggedOutStats.totals.jobs, 0, 'Logged-out stats must show 0 jobs');
    assert.strictEqual(loggedOutStats.totalLogs, 0, 'Logged-out totalLogs must be 0');
    assert.strictEqual(loggedOutStats.currentStreak, 0, 'Logged-out streak must be 0');
  });

  await test('1.2: Account B logs in -> sees 0 logs from Account A', async () => {
    await TrackerAuth.setUser({ email: 'userB@gmail.com', name: 'User B' });
    const userB = await TrackerAuth.getCurrentUser();
    assert.strictEqual(userB.email, 'userb@gmail.com');

    const logsB = await TrackerStorage.getLogs();
    assert.strictEqual(logsB.length, 0, 'Account B must see 0 logs initially');

    const statsB = await TrackerStorage.getStats();
    assert.strictEqual(statsB.totals.jobs, 0, 'Account B must see 0 total jobs');
    assert.strictEqual(statsB.totalLogs, 0, 'Account B must see 0 total logs');
    assert.strictEqual(statsB.currentStreak, 0, 'Account B streak must be 0');
  });

  await test('1.3: Account B logs entries -> strictly isolated from Account A', async () => {
    await TrackerStorage.addLog({ metricId: 'leetcode', count: 3, notes: 'Problems 1-3' });
    await TrackerStorage.addLog({ metricId: 'jobs', count: 2, company: 'Company B' });

    const logsB = await TrackerStorage.getLogs();
    assert.strictEqual(logsB.length, 2, 'Account B should have 2 log entries');
    const statsB = await TrackerStorage.getStats();
    assert.strictEqual(statsB.totals.leetcode, 3, 'Account B leetcode total should be 3');
    assert.strictEqual(statsB.totals.jobs, 2, 'Account B jobs total should be 2');

    // Switch back to Account A
    await TrackerAuth.setUser({ email: 'userA@gmail.com', name: 'User A' });
    const logsA = await TrackerStorage.getLogs();
    assert.strictEqual(logsA.length, 5, 'Account A should still see its original 5 logs');
    const statsA = await TrackerStorage.getStats();
    assert.strictEqual(statsA.totals.jobs, 5, 'Account A jobs should remain 5');
    assert.strictEqual(statsA.totals.leetcode, 0, 'Account A leetcode should be 0');
  });

  await test('1.4: Custom tracker isolation between Account B and Account A', async () => {
    // Account B creates custom tracker
    await TrackerAuth.setUser({ email: 'userB@gmail.com', name: 'User B' });
    const customB = await TrackerStorage.addMetric({ name: 'System Design', unit: 'chapters', color: '#9334e6' });
    assert(customB.id, 'Custom metric should have an ID');
    assert.strictEqual(customB.userEmail, 'userb@gmail.com');

    const metricsB = await TrackerStorage.getMetrics();
    const customBIds = metricsB.map(m => m.id);
    assert(customBIds.includes('jobs'));
    assert(customBIds.includes('leetcode'));
    assert(customBIds.includes(customB.id), 'Account B should see custom tracker');

    // Switch to Account A
    await TrackerAuth.setUser({ email: 'userA@gmail.com', name: 'User A' });
    const metricsA = await TrackerStorage.getMetrics();
    const customAIds = metricsA.map(m => m.id);
    assert(customAIds.includes('jobs'));
    assert(customAIds.includes('leetcode'));
    assert(!customAIds.includes(customB.id), 'Account A must NOT see Account B custom tracker');

    // Logged-out check
    await TrackerAuth.signOut();
    const metricsOut = await TrackerStorage.getMetrics();
    const outIds = metricsOut.map(m => m.id);
    assert(!outIds.includes(customB.id), 'Logged-out user must NOT see Account B custom tracker');
  });

  await test('1.5: Logged-out custom tracker is isolated from authenticated accounts', async () => {
    await TrackerAuth.signOut();
    const customAnon = await TrackerStorage.addMetric({ name: 'Meditation', unit: 'mins', color: '#007b83' });
    assert.strictEqual(customAnon.userEmail, null);

    const anonMetrics = await TrackerStorage.getMetrics();
    assert(anonMetrics.some(m => m.id === customAnon.id), 'Logged-out user sees anonymous tracker');

    // Account A logs in
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const metricsA = await TrackerStorage.getMetrics();
    assert(!metricsA.some(m => m.id === customAnon.id), 'Account A must NOT see anonymous tracker');
  });

  // -----------------------------------------------------------------
  // SUITE 2: Cross-Account Mutation Attacks
  // -----------------------------------------------------------------
  console.log('\n--- Suite 2: Cross-Account Mutation Attacks ---');

  await test('2.1: Cross-account deleteLog attack: Account B cannot delete Account A log', async () => {
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const logA = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Target A' });
    assert(logA.id);

    // Account B logs in
    await TrackerAuth.setUser({ email: 'userB@gmail.com' });

    // Attack 1: Account B calls deleteLog(logA.id)
    const result1 = await TrackerStorage.deleteLog(logA.id);
    assert.strictEqual(result1, false, 'deleteLog should return false for unauthorized cross-account deletion');

    // Attack 2: Account B explicitly passes its own email as override to delete A log
    const result2 = await TrackerStorage.deleteLog(logA.id, 'userB@gmail.com');
    assert.strictEqual(result2, false, 'deleteLog with override should return false');

    // Verify logA is intact in Account A
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const logsA = await TrackerStorage.getLogs();
    assert(logsA.some(l => l.id === logA.id), 'Account A log must remain intact');
  });

  await test('2.2: Logged-out cross-account deleteLog attack', async () => {
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const logA = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Target A2' });

    await TrackerAuth.signOut();
    const res = await TrackerStorage.deleteLog(logA.id);
    assert.strictEqual(res, false, 'Unauthenticated deleteLog of user log must return false');

    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const logsA = await TrackerStorage.getLogs();
    assert(logsA.some(l => l.id === logA.id), 'Log must remain intact');
  });

  await test('2.3: Cross-account undoLastLog attack', async () => {
    const today = TrackerStorage.getLocalDateStr();
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const initialLogsA = await TrackerStorage.getLogs();
    const countA = initialLogsA.length;

    // Account B logs in and attempts undoLastLog
    await TrackerAuth.setUser({ email: 'userB@gmail.com' });
    const logsB = await TrackerStorage.getLogs();
    for (const b of logsB) {
      await TrackerStorage.deleteLog(b.id);
    }

    const undoResult = await TrackerStorage.undoLastLog('jobs', today);
    assert.strictEqual(undoResult, false, 'undoLastLog should return false when Account B has no logs');

    // Verify Account A count is unchanged
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const logsAfter = await TrackerStorage.getLogs();
    assert.strictEqual(logsAfter.length, countA, 'Account A logs count must remain unchanged');
  });

  await test('2.4: Cross-account deleteMetric attack: Account B cannot delete Account A custom metric', async () => {
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const metricA = await TrackerStorage.addMetric({ name: 'Account A Custom', unit: 'items' });

    // Account B attempts to delete metricA
    await TrackerAuth.setUser({ email: 'userB@gmail.com' });
    const delResult = await TrackerStorage.deleteMetric(metricA.id);
    assert.strictEqual(delResult, false, 'deleteMetric should return false for cross-account attack');

    // Verify metricA exists in Account A
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const metricsA = await TrackerStorage.getMetrics();
    assert(metricsA.some(m => m.id === metricA.id), 'Account A metric must still exist');
  });

  await test('2.5: Logged-out deleteMetric attack on authenticated custom metric', async () => {
    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const metricA = await TrackerStorage.addMetric({ name: 'Private A Metric' });

    await TrackerAuth.signOut();
    const delResult = await TrackerStorage.deleteMetric(metricA.id);
    assert.strictEqual(delResult, false, 'Unauthenticated deleteMetric of user metric must return false');

    await TrackerAuth.setUser({ email: 'userA@gmail.com' });
    const metricsA = await TrackerStorage.getMetrics();
    assert(metricsA.some(m => m.id === metricA.id), 'Private metric must still exist');
  });

  // -----------------------------------------------------------------
  // SUITE 3: Default Metrics Protection Attacks
  // -----------------------------------------------------------------
  console.log('\n--- Suite 3: Default Metrics Protection Attacks ---');

  await test('3.1: Attempt to delete default metric "jobs" (logged-out and logged-in)', async () => {
    await TrackerAuth.signOut();
    const res1 = await TrackerStorage.deleteMetric('jobs');
    assert.strictEqual(res1, false, 'deleteMetric("jobs") logged-out must return false');

    await TrackerAuth.setUser({ email: 'admin@google.com' });
    const res2 = await TrackerStorage.deleteMetric('jobs');
    assert.strictEqual(res2, false, 'deleteMetric("jobs") as user must return false');

    const res3 = await TrackerStorage.deleteMetric('jobs', 'superuser@gmail.com');
    assert.strictEqual(res3, false, 'deleteMetric("jobs") with override must return false');

    const metrics = await TrackerStorage.getMetrics();
    assert(metrics.some(m => m.id === 'jobs' && m.isDefault), '"jobs" metric must remain present and default');
  });

  await test('3.2: Attempt to delete default metric "leetcode" (logged-out and logged-in)', async () => {
    await TrackerAuth.signOut();
    const res1 = await TrackerStorage.deleteMetric('leetcode');
    assert.strictEqual(res1, false, 'deleteMetric("leetcode") logged-out must return false');

    await TrackerAuth.setUser({ email: 'attacker@evil.com' });
    const res2 = await TrackerStorage.deleteMetric('leetcode');
    assert.strictEqual(res2, false, 'deleteMetric("leetcode") logged-in must return false');

    const metrics = await TrackerStorage.getMetrics();
    assert(metrics.some(m => m.id === 'leetcode' && m.isDefault), '"leetcode" metric must remain present and default');
  });

  await test('3.3: Attempt to delete with falsy/invalid/proto IDs', async () => {
    assert.strictEqual(await TrackerStorage.deleteMetric(null), false);
    assert.strictEqual(await TrackerStorage.deleteMetric(''), false);
    assert.strictEqual(await TrackerStorage.deleteMetric(undefined), false);
    assert.strictEqual(await TrackerStorage.deleteMetric('__proto__'), false);
    assert.strictEqual(await TrackerStorage.deleteMetric('non-existent-id-9999'), false);

    assert.strictEqual(await TrackerStorage.deleteLog(null), false);
    assert.strictEqual(await TrackerStorage.deleteLog(''), false);
    assert.strictEqual(await TrackerStorage.deleteLog(undefined), false);
    assert.strictEqual(await TrackerStorage.deleteLog('non-existent-log-9999'), false);
  });

  // -----------------------------------------------------------------
  // SUITE 4: Email Casing & Normalization Invariance
  // -----------------------------------------------------------------
  console.log('\n--- Suite 4: Email Casing & Normalization Invariance ---');
  mockStorage.clear();

  await test('4.1: Normalization function handles all edge cases', async () => {
    assert.strictEqual(TrackerStorage.normalizeEmail('User.Name@Gmail.com'), 'user.name@gmail.com');
    assert.strictEqual(TrackerStorage.normalizeEmail('  ALICE@DOMAIN.ORG  '), 'alice@domain.org');
    assert.strictEqual(TrackerStorage.normalizeEmail(''), null);
    assert.strictEqual(TrackerStorage.normalizeEmail('   '), null);
    assert.strictEqual(TrackerStorage.normalizeEmail(null), null);
    assert.strictEqual(TrackerStorage.normalizeEmail(undefined), null);
    assert.strictEqual(TrackerStorage.normalizeEmail(123), null);
  });

  await test('4.2: Auth signIn and setUser automatically lowercases email', async () => {
    await TrackerAuth.setUser({ email: '  Test.User+Sub@GMAIL.COM  ', name: 'Test' });
    const user = await TrackerAuth.getCurrentUser();
    assert.strictEqual(user.email, 'test.user+sub@gmail.com');

    await TrackerAuth.signInWithGoogle('  John.Doe@Company.COM ');
    const user2 = await TrackerAuth.getCurrentUser();
    assert.strictEqual(user2.email, 'john.doe@company.com');
  });

  await test('4.3: Logs added with uppercase email are queryable with lowercase and vice versa', async () => {
    const log = await TrackerStorage.addLog(
      { metricId: 'jobs', company: 'Case Test Co' },
      'MixedCase.User@DOMAIN.COM'
    );
    assert.strictEqual(log.userEmail, 'mixedcase.user@domain.com');

    // Query with lowercase email
    const logs1 = await TrackerStorage.getLogs({}, 'mixedcase.user@domain.com');
    assert.strictEqual(logs1.length, 1);
    assert.strictEqual(logs1[0].company, 'Case Test Co');

    // Query with uppercase email
    const logs2 = await TrackerStorage.getLogs({}, 'MIXEDCASE.USER@DOMAIN.COM');
    assert.strictEqual(logs2.length, 1);
    assert.strictEqual(logs2[0].id, log.id);

    // Query with padded mixed case
    const logs3 = await TrackerStorage.getLogs({}, '  MixedCase.User@Domain.COM  ');
    assert.strictEqual(logs3.length, 1);

    // Delete with different case
    const delRes = await TrackerStorage.deleteLog(log.id, 'MIXEDCASE.USER@DOMAIN.COM');
    assert.strictEqual(delRes, true, 'deleteLog with uppercase email should succeed on normalized match');

    const logsAfter = await TrackerStorage.getLogs({}, 'mixedcase.user@domain.com');
    assert.strictEqual(logsAfter.length, 0);
  });

  await test('4.4: Custom metrics casing invariance', async () => {
    const metric = await TrackerStorage.addMetric(
      { name: 'Casing Metric', unit: 'pts' },
      'Owner.Case@Test.COM'
    );
    assert.strictEqual(metric.userEmail, 'owner.case@test.com');

    const metricsQuery = await TrackerStorage.getMetrics('OWNER.CASE@TEST.COM');
    assert(metricsQuery.some(m => m.id === metric.id), 'Metric should be retrieved with uppercase query');

    const delRes = await TrackerStorage.deleteMetric(metric.id, '  Owner.Case@Test.com  ');
    assert.strictEqual(delRes, true, 'deleteMetric with mixed case should succeed');
  });

  // -----------------------------------------------------------------
  // SUITE 5: Storage Event Broadcasting & Real-Time Listeners
  // -----------------------------------------------------------------
  console.log('\n--- Suite 5: Storage Event Broadcasting & Real-Time Listeners ---');
  mockStorage.clear();

  await test('5.1: TrackerStorage.onChanged triggers on log addition', async () => {
    let triggered = false;
    let receivedChanges = null;

    const listener = (changes) => {
      triggered = true;
      receivedChanges = changes;
    };

    TrackerStorage.onChanged(listener);

    await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(triggered, true, 'TrackerStorage.onChanged must be triggered');
    assert(receivedChanges.logs, 'Changes should contain logs');
  });

  await test('5.2: TrackerAuth.onAuthChanged triggers on signIn and signOut', async () => {
    let authChanges = [];

    TrackerAuth.onAuthChanged((newUser) => {
      authChanges.push(newUser);
    });

    await TrackerAuth.setUser({ email: 'liveuser@gmail.com', name: 'Live' });
    await new Promise(r => setTimeout(r, 20));

    await TrackerAuth.signOut();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(authChanges.length, 2, 'onAuthChanged should fire twice (login + logout)');
    assert.strictEqual(authChanges[0].email, 'liveuser@gmail.com');
    assert.strictEqual(authChanges[1], null);
  });

  await test('5.3: Multiple listeners simulate simultaneous popup and content script broadcast', async () => {
    let popupUpdated = 0;
    let dockUpdated = 0;
    let overlayUpdated = 0;

    TrackerStorage.onChanged(() => popupUpdated++);
    TrackerStorage.onChanged(() => dockUpdated++);
    TrackerStorage.onChanged(() => overlayUpdated++);

    await TrackerStorage.addMetric({ name: 'Broadcast Test' });
    await new Promise(r => setTimeout(r, 20));

    assert(popupUpdated >= 1, 'Popup listener should have received event');
    assert(dockUpdated >= 1, 'Dock listener should have received event');
    assert(overlayUpdated >= 1, 'Overlay listener should have received event');
  });

  await test('5.4: Live broadcast does not leak cross-account logs during re-fetch', async () => {
    // Simulate content script in User B session listening to storage changes
    await TrackerAuth.setUser({ email: 'userB@gmail.com' });
    let observedUserBLogsCount = null;

    TrackerStorage.onChanged(async () => {
      // Re-fetch data as User B
      const logs = await TrackerStorage.getLogs();
      observedUserBLogsCount = logs.length;
    });

    // Account A adds 3 logs in the background (e.g. from another tab or API)
    await TrackerStorage.addLog({ metricId: 'jobs', company: 'Background Co A1' }, 'userA@gmail.com');
    await TrackerStorage.addLog({ metricId: 'jobs', company: 'Background Co A2' }, 'userA@gmail.com');
    await new Promise(r => setTimeout(r, 30));

    // User B's listener re-fetched and must still see 0 logs
    assert.strictEqual(observedUserBLogsCount, 0, 'User B listener must see 0 logs despite User A writes');
  });

  // -----------------------------------------------------------------
  // SUITE 6: Concurrency & Mutex Queue Stress-Testing
  // -----------------------------------------------------------------
  console.log('\n--- Suite 6: Concurrency & Mutex Queue Stress-Testing ---');
  mockStorage.clear();

  await test('6.1: 40 concurrent addLog operations across 2 users without race condition or lost writes', async () => {
    const promises = [];
    const countUserA = 20;
    const countUserB = 20;

    for (let i = 0; i < countUserA; i++) {
      promises.push(TrackerStorage.addLog({ metricId: 'jobs', company: `A-${i}`, count: 1 }, 'userA@gmail.com'));
    }
    for (let i = 0; i < countUserB; i++) {
      promises.push(TrackerStorage.addLog({ metricId: 'jobs', company: `B-${i}`, count: 1 }, 'userB@gmail.com'));
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 40);

    const logsA = await TrackerStorage.getLogs({}, 'userA@gmail.com');
    const logsB = await TrackerStorage.getLogs({}, 'userB@gmail.com');

    assert.strictEqual(logsA.length, 20, 'User A must have exactly 20 logs');
    assert.strictEqual(logsB.length, 20, 'User B must have exactly 20 logs');

    const allRaw = mockStorage.store.logs || [];
    assert.strictEqual(allRaw.length, 40, 'Total stored logs must be exactly 40 (no lost writes)');
  });

  await test('6.2: Interleaved concurrent adds, undos, and metric creations', async () => {
    mockStorage.clear();
    const today = TrackerStorage.getLocalDateStr();

    // User A adds 10 logs
    const addPromises = [];
    for (let i = 0; i < 10; i++) {
      addPromises.push(TrackerStorage.addLog({ metricId: 'jobs', company: `A-${i}` }, 'userA@gmail.com'));
    }
    await Promise.all(addPromises);

    // Concurrently: User A undos 3, User B adds 5, User A creates a metric
    const concurrentOps = [
      TrackerStorage.undoLastLog('jobs', today, 'userA@gmail.com'),
      TrackerStorage.undoLastLog('jobs', today, 'userA@gmail.com'),
      TrackerStorage.undoLastLog('jobs', today, 'userA@gmail.com'),
      TrackerStorage.addLog({ metricId: 'jobs', company: 'B-1' }, 'userB@gmail.com'),
      TrackerStorage.addLog({ metricId: 'jobs', company: 'B-2' }, 'userB@gmail.com'),
      TrackerStorage.addMetric({ name: 'A Metric' }, 'userA@gmail.com'),
    ];

    await Promise.all(concurrentOps);

    const logsA = await TrackerStorage.getLogs({}, 'userA@gmail.com');
    const logsB = await TrackerStorage.getLogs({}, 'userB@gmail.com');
    const metricsA = await TrackerStorage.getMetrics('userA@gmail.com');

    assert.strictEqual(logsA.length, 7, 'User A should have 10 - 3 = 7 logs');
    assert.strictEqual(logsB.length, 2, 'User B should have 2 logs');
    assert(metricsA.some(m => m.name === 'A Metric'), 'User A metric must be created');
  });

  // -----------------------------------------------------------------
  // SUITE 7: Custom Tracker Security, Collision & Isolation
  // -----------------------------------------------------------------
  console.log('\n--- Suite 7: Custom Tracker Security, Collision & Isolation ---');
  mockStorage.clear();

  await test('7.1: Custom metric ID collision prevention against default metric names', async () => {
    // Attempt to name custom trackers "Jobs" or "LeetCode"
    const fakeJobs = await TrackerStorage.addMetric({ name: 'Jobs', unit: 'jobs' }, 'userA@gmail.com');
    const fakeLeet = await TrackerStorage.addMetric({ name: 'LeetCode', unit: 'problems' }, 'userA@gmail.com');

    assert.notStrictEqual(fakeJobs.id, 'jobs', 'Custom tracker ID must not collide with default "jobs"');
    assert.notStrictEqual(fakeLeet.id, 'leetcode', 'Custom tracker ID must not collide with default "leetcode"');
    assert(fakeJobs.id.startsWith('jobs-'), 'Custom tracker ID has random suffix');
    assert(fakeLeet.id.startsWith('leetcode-'), 'Custom tracker ID has random suffix');
    assert.strictEqual(fakeJobs.isDefault, false);
    assert.strictEqual(fakeLeet.isDefault, false);
  });

  await test('7.2: Custom tracker with prototype pollution keys & malicious strings', async () => {
    const maliciousMetric = await TrackerStorage.addMetric(
      {
        name: '__proto__',
        unit: '<script>alert(1)</script>',
        color: 'javascript:void(0)'
      },
      'attacker@gmail.com'
    );

    assert(maliciousMetric.id);
    assert.strictEqual(maliciousMetric.name, '__proto__');
    assert.strictEqual(maliciousMetric.unit, '<script>alert(1)</script>');

    // Check Object prototype is not polluted
    const plainObj = {};
    assert.strictEqual(plainObj.unit, undefined);

    // Deletion by owner succeeds
    const delRes = await TrackerStorage.deleteMetric(maliciousMetric.id, 'attacker@gmail.com');
    assert.strictEqual(delRes, true);
  });

  // -----------------------------------------------------------------
  // SUITE 8: Strict Zero-Emoji Compliance & Manifest Validation
  // -----------------------------------------------------------------
  console.log('\n--- Suite 8: Strict Zero-Emoji Compliance & Manifest Validation ---');

  await test('8.1: Zero-emoji scan across all application source files (content, popup, shared, manifest)', async () => {
    const projectRoot = path.join(__dirname, '..');
    const extensionsToScan = ['.js', '.html', '.css', '.json'];
    const filesToIgnore = ['node_modules', '.git', '.agents', 'tests'];

    const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}\u{1FA70}-\u{1FAFF}]/u;

    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const foundEmojiFiles = [];

      for (const entry of entries) {
        if (filesToIgnore.includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          foundEmojiFiles.push(...scanDir(fullPath));
        } else if (entry.isFile() && extensionsToScan.some(ext => entry.name.endsWith(ext))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (emojiRegex.test(content)) {
            foundEmojiFiles.push(fullPath);
          }
        }
      }
      return foundEmojiFiles;
    }

    const emojiFiles = scanDir(projectRoot);
    if (emojiFiles.length > 0) {
      throw new Error(`Emoji detected in files: ${emojiFiles.join(', ')}`);
    }
  });

  await test('8.2: Manifest V3 validation', async () => {
    const manifestPath = path.join(__dirname, '../manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
    assert(manifest.permissions.includes('storage'), 'Must include storage permission');
    assert(manifest.permissions.includes('identity'), 'Must include identity permission');
    assert(manifest.content_scripts && manifest.content_scripts.length > 0, 'Must define content scripts');
    assert(manifest.content_scripts[0].matches.includes('https://calendar.google.com/*'), 'Must match calendar.google.com');
  });

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${totalTests} Total | ${passedTests} Passed | ${failedTests} Failed`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test harness error:', err);
  process.exit(1);
});
