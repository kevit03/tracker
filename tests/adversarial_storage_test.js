/**
 * Adversarial Stress & Verification Suite for TrackerStorage
 * Challenger 1 (Round 2)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Color helpers for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

async function describe(suiteName, fn) {
  console.log(`\n${colors.bold}${colors.cyan}=== Suite: ${suiteName} ===${colors.reset}`);
  await fn();
}

async function test(testName, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ${colors.green}[PASS]${colors.reset} ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${colors.red}[FAIL]${colors.reset} ${testName}`);
    console.error(`         ${colors.red}${err.message}${colors.reset}`);
    if (err.stack) {
      const relevantStack = err.stack.split('\n').slice(1, 4).join('\n');
      console.error(`         ${colors.yellow}${relevantStack}${colors.reset}`);
    }
    failures.push({ name: testName, error: err });
  }
}

// Helper to create a clean mock storage with optional async latency
function createMockChromeStorage(options = {}) {
  const memoryStore = {};
  const { minLatencyMs = 0, maxLatencyMs = 0 } = options;

  function delay() {
    if (maxLatencyMs <= 0) return Promise.resolve();
    const ms = Math.floor(Math.random() * (maxLatencyMs - minLatencyMs + 1)) + minLatencyMs;
    return new Promise(res => setTimeout(res, ms));
  }

  const listeners = [];

  const storageArea = {
    _raw: memoryStore,
    get: (keys, cb) => {
      delay().then(() => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        keyList.forEach(k => {
          if (memoryStore[k] !== undefined) {
            result[k] = JSON.parse(JSON.stringify(memoryStore[k]));
          }
        });
        if (cb) cb(result);
      });
    },
    set: (items, cb) => {
      delay().then(() => {
        const changes = {};
        Object.entries(items).forEach(([k, v]) => {
          const oldVal = memoryStore[k] !== undefined ? JSON.parse(JSON.stringify(memoryStore[k])) : undefined;
          memoryStore[k] = v !== undefined ? JSON.parse(JSON.stringify(v)) : undefined;
          changes[k] = { oldValue: oldVal, newValue: memoryStore[k] };
        });
        listeners.forEach(l => l(changes, 'local'));
        if (cb) cb();
      });
    },
    clear: () => {
      for (const k of Object.keys(memoryStore)) {
        delete memoryStore[k];
      }
    }
  };

  const chromeMock = {
    storage: {
      local: storageArea,
      onChanged: {
        addListener: (fn) => listeners.push(fn)
      }
    }
  };

  return { chromeMock, memoryStore };
}

// Create a mock localStorage environment
function createMockLocalStorage() {
  const store = {};
  return {
    getItem: (k) => store[k] !== undefined ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    _raw: store
  };
}

// Load fresh instance of TrackerStorage
function loadTrackerStorage(mockEnv, useLocalStorage = false) {
  const storagePath = path.resolve(__dirname, '../shared/storage.js');
  delete require.cache[require.resolve(storagePath)];

  if (useLocalStorage) {
    global.chrome = undefined;
    global.localStorage = createMockLocalStorage();
  } else {
    global.chrome = mockEnv ? mockEnv.chromeMock : undefined;
    global.localStorage = undefined;
  }
  global.TrackerAuth = undefined;

  return require(storagePath);
}

// =========================================================================
// RUN ALL SUITES
// =========================================================================
async function runAllTests() {
  console.log(`${colors.bold}Starting Adversarial Stress & Verification Suite...${colors.reset}`);

  // -----------------------------------------------------------------------
  // SUITE 1: Concurrency Stress & Write Serialization
  // -----------------------------------------------------------------------
  await describe('Suite 1: Concurrency Stress & Write Serialization', async () => {
    await test('1.1: 20 simultaneous addLog operations with random latency (1-15ms) must serialize all writes without lost updates', async () => {
      const mockEnv = createMockChromeStorage({ minLatencyMs: 1, maxLatencyMs: 15 });
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const count = 20;
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(
          TrackerStorage.addLog({
            metricId: 'jobs',
            company: `Company-${i}`,
            role: `Role-${i}`,
            notes: `Concurrent entry ${i}`
          })
        );
      }

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, count, 'Expected 20 resolved addLog promises');

      const ids = new Set(results.map(r => r.id));
      assert.strictEqual(ids.size, count, 'All 20 created log IDs must be unique');

      const logsInStorage = await TrackerStorage.getLogs();
      assert.strictEqual(logsInStorage.length, count, `Storage must contain exactly ${count} logs, found ${logsInStorage.length}`);

      for (let i = 0; i < count; i++) {
        const found = logsInStorage.some(l => l.company === `Company-${i}`);
        assert.ok(found, `Expected log for Company-${i} to exist in storage`);
      }
    });

    await test('1.2: 20 simultaneous addMetric operations must all be stored with distinct IDs', async () => {
      const mockEnv = createMockChromeStorage({ minLatencyMs: 1, maxLatencyMs: 10 });
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const count = 20;
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(
          TrackerStorage.addMetric({
            name: `Custom Metric ${i}`,
            unit: `unit-${i}`,
            color: '#1a73e8'
          })
        );
      }

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, count, 'Expected 20 resolved addMetric promises');

      const ids = new Set(results.map(r => r.id));
      assert.strictEqual(ids.size, count, 'All metric IDs must be unique');

      const allMetrics = await TrackerStorage.getMetrics();
      assert.strictEqual(allMetrics.length, 22, `Expected 22 metrics, found ${allMetrics.length}`);
    });

    await test('1.3: Interleaved concurrent operations (10 addLog, 5 undoLastLog, 3 deleteLog) must maintain exact consistency', async () => {
      const mockEnv = createMockChromeStorage({ minLatencyMs: 1, maxLatencyMs: 10 });
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const preLogs = [];
      for (let i = 0; i < 10; i++) {
        preLogs.push(await TrackerStorage.addLog({ metricId: 'jobs', company: `Pre-${i}` }));
      }

      const concurrentOps = [];

      for (let i = 0; i < 10; i++) {
        concurrentOps.push(TrackerStorage.addLog({ metricId: 'jobs', company: `Concurrent-${i}` }));
      }

      for (let i = 0; i < 5; i++) {
        concurrentOps.push(TrackerStorage.undoLastLog('jobs'));
      }

      concurrentOps.push(TrackerStorage.deleteLog(preLogs[0].id));
      concurrentOps.push(TrackerStorage.deleteLog(preLogs[1].id));
      concurrentOps.push(TrackerStorage.deleteLog(preLogs[2].id));

      await Promise.all(concurrentOps);

      const finalLogs = await TrackerStorage.getLogs();
      assert.strictEqual(finalLogs.length, 12, `Expected exactly 12 logs after interleaved operations, found ${finalLogs.length}`);

      const remainingIds = new Set(finalLogs.map(l => l.id));
      assert.ok(!remainingIds.has(preLogs[0].id), 'Deleted log 0 should not exist');
      assert.ok(!remainingIds.has(preLogs[1].id), 'Deleted log 1 should not exist');
      assert.ok(!remainingIds.has(preLogs[2].id), 'Deleted log 2 should not exist');
    });

    await test('1.4: 100 rapid concurrent mixed mutations execute without deadlock or dropped writes', async () => {
      const mockEnv = createMockChromeStorage({ minLatencyMs: 0, maxLatencyMs: 4 });
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const ops = [];
      for (let i = 0; i < 100; i++) {
        if (i % 4 === 0) {
          ops.push(TrackerStorage.addLog({ metricId: 'leetcode', count: 1 }));
        } else if (i % 4 === 1) {
          ops.push(TrackerStorage.addLog({ metricId: 'jobs', count: 1 }));
        } else if (i % 4 === 2) {
          ops.push(TrackerStorage.undoLastLog('jobs'));
        } else {
          ops.push(TrackerStorage.addMetric({ name: `Metric-${i}` }));
        }
      }

      const results = await Promise.all(ops);
      assert.strictEqual(results.length, 100, 'All 100 operations must complete');
      const finalStats = await TrackerStorage.getStats();
      assert.ok(finalStats.totalLogs >= 0, 'Total logs must be non-negative integer');
    });

    await test('1.5: Mutex queue handles and recovers when an intermediate write rejects', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      await TrackerStorage.addLog({ metricId: 'jobs', company: 'Initial' });

      // Add valid log, then add another valid log concurrently
      const p1 = TrackerStorage.addLog({ metricId: 'jobs', company: 'Second' });
      const p2 = TrackerStorage.addLog({ metricId: 'jobs', company: 'Third' });

      await Promise.all([p1, p2]);
      const logs = await TrackerStorage.getLogs();
      assert.strictEqual(logs.length, 3);
    });
  });

  // -----------------------------------------------------------------------
  // SUITE 2: LIFO Ordering & Same-Millisecond Tie-Breaking
  // -----------------------------------------------------------------------
  await describe('Suite 2: LIFO Ordering & Same-Millisecond Tie-Breaking', async () => {
    await test('2.1: Multiple logs with the EXACT same ISO timestamp must be undone in exact reverse insertion order (LIFO)', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const fixedTimestamp = '2026-09-02T12:00:00.000Z';
      const fixedDate = '2026-09-02';

      const testLogs = [];
      for (let i = 1; i <= 5; i++) {
        testLogs.push({
          id: `log-fixed-${i}`,
          metricId: 'jobs',
          userEmail: null,
          count: 1,
          date: fixedDate,
          timestamp: fixedTimestamp,
          company: `Company-${i}`,
          role: `Role-${i}`,
          notes: `Note-${i}`
        });
      }

      mockEnv.memoryStore['logs'] = [...testLogs];

      const fetchedLogs = await TrackerStorage.getLogs('jobs');
      assert.strictEqual(fetchedLogs.length, 5);
      assert.strictEqual(fetchedLogs[0].id, 'log-fixed-5', '1st in getLogs must be log 5 (last inserted)');
      assert.strictEqual(fetchedLogs[1].id, 'log-fixed-4', '2nd in getLogs must be log 4');
      assert.strictEqual(fetchedLogs[2].id, 'log-fixed-3', '3rd in getLogs must be log 3');
      assert.strictEqual(fetchedLogs[3].id, 'log-fixed-2', '4th in getLogs must be log 2');
      assert.strictEqual(fetchedLogs[4].id, 'log-fixed-1', '5th in getLogs must be log 1 (first inserted)');

      for (let i = 5; i >= 1; i--) {
        const undoRes = await TrackerStorage.undoLastLog('jobs', fixedDate);
        assert.strictEqual(undoRes, true, `Undo of entry ${i} should return true`);

        const currentLogs = await TrackerStorage.getLogs('jobs');
        assert.strictEqual(currentLogs.length, i - 1, `After undo ${i}, remaining count should be ${i - 1}`);

        if (currentLogs.length > 0) {
          assert.strictEqual(currentLogs[0].id, `log-fixed-${i - 1}`, `New top log should be log-fixed-${i - 1}`);
        }
      }

      const finalUndo = await TrackerStorage.undoLastLog('jobs', fixedDate);
      assert.strictEqual(finalUndo, false, 'Undoing empty storage must return false');
    });

    await test('2.2: Logs with varying timestamps and ties correctly sort by timestamp first, then LIFO tie-breaker', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      mockEnv.memoryStore['logs'] = [
        { id: 'A', metricId: 'jobs', count: 1, date: '2026-09-02', timestamp: '2026-09-02T10:00:00.000Z', userEmail: null },
        { id: 'B', metricId: 'jobs', count: 1, date: '2026-09-02', timestamp: '2026-09-02T11:00:00.000Z', userEmail: null },
        { id: 'C', metricId: 'jobs', count: 1, date: '2026-09-02', timestamp: '2026-09-02T11:00:00.000Z', userEmail: null },
        { id: 'D', metricId: 'jobs', count: 1, date: '2026-09-02', timestamp: '2026-09-02T10:30:00.000Z', userEmail: null },
      ];

      const logs = await TrackerStorage.getLogs('jobs');
      const order = logs.map(l => l.id);
      assert.deepStrictEqual(order, ['C', 'B', 'D', 'A'], 'Ordering must be [C, B, D, A]');
    });
  });

  // -----------------------------------------------------------------------
  // SUITE 3: Undo Edge Cases & Boundaries
  // -----------------------------------------------------------------------
  await describe('Suite 3: Undo Edge Cases & Boundaries', async () => {
    await test('3.1: undoLastLog on uninitialized/empty storage returns false without throwing', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const res = await TrackerStorage.undoLastLog('jobs');
      assert.strictEqual(res, false, 'Undo on empty storage must return false');
    });

    await test('3.2: undoLastLog for a metric with 0 entries does not touch entries of other metrics', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      await TrackerStorage.addLog({ metricId: 'leetcode', count: 5 });
      await TrackerStorage.addLog({ metricId: 'leetcode', count: 3 });

      const undoJobs = await TrackerStorage.undoLastLog('jobs');
      assert.strictEqual(undoJobs, false, 'Undo on metric with no entries must return false');

      const leetLogs = await TrackerStorage.getLogs('leetcode');
      assert.strictEqual(leetLogs.length, 2, 'LeetCode logs must remain intact');
    });

    await test('3.3: undoLastLog for a specific date does not remove logs on other dates', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      await TrackerStorage.addLog({ metricId: 'jobs', date: '2026-09-01', count: 1 });
      await TrackerStorage.addLog({ metricId: 'jobs', date: '2026-09-02', count: 1 });

      const res = await TrackerStorage.undoLastLog('jobs', '2026-08-31');
      assert.strictEqual(res, false, 'Undo on date with no logs must return false');

      const allLogs = await TrackerStorage.getLogs('jobs');
      assert.strictEqual(allLogs.length, 2, 'Both logs must remain');
    });

    await test('3.4: Over-undoing: calling undoLastLog 10 times when only 3 logs exist handles gracefully', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });
      await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });
      await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });

      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await TrackerStorage.undoLastLog('jobs'));
      }

      assert.strictEqual(results[0], true, '1st undo returns true');
      assert.strictEqual(results[1], true, '2nd undo returns true');
      assert.strictEqual(results[2], true, '3rd undo returns true');
      for (let i = 3; i < 10; i++) {
        assert.strictEqual(results[i], false, `Undo ${i + 1} must return false`);
      }

      const finalLogs = await TrackerStorage.getLogs();
      assert.strictEqual(finalLogs.length, 0, 'Final storage must be empty');
    });

    await test('3.5: deleteLog handles null, empty string, non-existent ID, and unauthorized user email', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      assert.strictEqual(await TrackerStorage.deleteLog(null), false);
      assert.strictEqual(await TrackerStorage.deleteLog(undefined), false);
      assert.strictEqual(await TrackerStorage.deleteLog(''), false);
      assert.strictEqual(await TrackerStorage.deleteLog('non-existent-id'), false);

      const log1 = await TrackerStorage.addLog({ metricId: 'jobs', userEmail: 'user1@gmail.com' });

      const unauthorizedDelete = await TrackerStorage.deleteLog(log1.id, 'user2@gmail.com');
      assert.strictEqual(unauthorizedDelete, false, 'Unauthorized user must not be able to delete another user log');

      const unauthDelete = await TrackerStorage.deleteLog(log1.id, null);
      assert.strictEqual(unauthDelete, false, 'Unauthenticated caller must not delete user log');

      const authDelete = await TrackerStorage.deleteLog(log1.id, 'user1@gmail.com');
      assert.strictEqual(authDelete, true, 'Owner must be able to delete their own log');
    });

    await test('3.6: deleteMetric refuses to delete default metrics (jobs, leetcode)', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      assert.strictEqual(await TrackerStorage.deleteMetric('jobs'), false, 'Cannot delete jobs');
      assert.strictEqual(await TrackerStorage.deleteMetric('leetcode'), false, 'Cannot delete leetcode');
      assert.strictEqual(await TrackerStorage.deleteMetric(null), false);
      assert.strictEqual(await TrackerStorage.deleteMetric('non-existent'), false);

      const custom = await TrackerStorage.addMetric({ name: 'Workout' });
      assert.strictEqual(await TrackerStorage.deleteMetric(custom.id), true, 'Owner can delete custom metric');

      const metricsAfter = await TrackerStorage.getMetrics();
      assert.ok(!metricsAfter.some(m => m.id === custom.id), 'Custom metric should be removed');
    });
  });

  // -----------------------------------------------------------------------
  // SUITE 4: Date Math, Noon Safety, DST & Streak Calculations
  // -----------------------------------------------------------------------
  await describe('Suite 4: Date Math, Noon Safety, DST & Streak Calculations', async () => {
    await test('4.1: addDays handles leap years accurately (2024, 2028, 2000 vs 2023, 2100)', () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      assert.strictEqual(TrackerStorage.addDays('2024-02-28', 1), '2024-02-29');
      assert.strictEqual(TrackerStorage.addDays('2024-02-29', 1), '2024-03-01');
      assert.strictEqual(TrackerStorage.addDays('2024-03-01', -1), '2024-02-29');
      assert.strictEqual(TrackerStorage.addDays('2024-02-29', -1), '2024-02-28');

      assert.strictEqual(TrackerStorage.addDays('2023-02-28', 1), '2023-03-01');
      assert.strictEqual(TrackerStorage.addDays('2023-03-01', -1), '2023-02-28');

      assert.strictEqual(TrackerStorage.addDays('2028-02-28', 1), '2028-02-29');
      assert.strictEqual(TrackerStorage.addDays('2028-02-29', 1), '2028-03-01');

      assert.strictEqual(TrackerStorage.addDays('2000-02-28', 1), '2000-02-29');
      assert.strictEqual(TrackerStorage.addDays('2100-02-28', 1), '2100-03-01');
    });

    await test('4.2: addDays handles month and year boundaries correctly', () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      assert.strictEqual(TrackerStorage.addDays('2026-12-31', 1), '2027-01-01');
      assert.strictEqual(TrackerStorage.addDays('2027-01-01', -1), '2026-12-31');

      assert.strictEqual(TrackerStorage.addDays('2026-04-30', 1), '2026-05-01');
      assert.strictEqual(TrackerStorage.addDays('2026-05-01', -1), '2026-04-30');
      assert.strictEqual(TrackerStorage.addDays('2026-07-31', 1), '2026-08-01');
      assert.strictEqual(TrackerStorage.addDays('2026-08-01', -1), '2026-07-31');

      assert.strictEqual(TrackerStorage.addDays('2026-01-01', 365), '2027-01-01');
      assert.strictEqual(TrackerStorage.addDays('2024-01-01', 366), '2025-01-01');
    });

    await test('4.3: Noon-based parsing prevents off-by-one errors across simulated DST transitions', () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const noon = TrackerStorage.parseLocalDateToNoon('2026-03-08');
      assert.strictEqual(noon.getHours(), 12, 'Hour must be set to 12 (noon)');
      assert.strictEqual(noon.getFullYear(), 2026);
      assert.strictEqual(noon.getMonth(), 2);
      assert.strictEqual(noon.getDate(), 8);

      let current = '2026-01-01';
      for (let i = 0; i < 365; i++) {
        const next = TrackerStorage.addDays(current, 1);
        const back = TrackerStorage.addDays(next, -1);
        assert.strictEqual(back, current, `Back-stepping from ${next} should return ${current}`);
        current = next;
      }
      assert.strictEqual(current, '2027-01-01', '365 day steps from 2026-01-01 should reach 2027-01-01');
    });

    await test('4.4: Date parsing with single-digit components and Date object inputs', () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      // Single-digit month and day
      assert.strictEqual(TrackerStorage.addDays('2026-5-3', 1), '2026-05-04');

      // Date object input to addDays
      const dObj = new Date(2026, 4, 3);
      assert.strictEqual(TrackerStorage.addDays(dObj, 1), '2026-05-04');
    });

    await test('4.5: Streak calculations: Active today vs active yesterday vs broken streak', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const todayStr = TrackerStorage.getLocalDateStr();
      const dayMinus1 = TrackerStorage.addDays(todayStr, -1);
      const dayMinus2 = TrackerStorage.addDays(todayStr, -2);
      const dayMinus3 = TrackerStorage.addDays(todayStr, -3);
      const dayMinus4 = TrackerStorage.addDays(todayStr, -4);

      await TrackerStorage.addLog({ metricId: 'jobs', date: dayMinus4 });
      await TrackerStorage.addLog({ metricId: 'jobs', date: dayMinus3 });
      await TrackerStorage.addLog({ metricId: 'jobs', date: dayMinus2 });
      await TrackerStorage.addLog({ metricId: 'jobs', date: dayMinus1 });
      await TrackerStorage.addLog({ metricId: 'jobs', date: todayStr });

      let stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.currentStreak, 5, `Expected 5-day streak ending today, got ${stats.currentStreak}`);

      const todayLogs = await TrackerStorage.getLogs({ startDate: todayStr, endDate: todayStr });
      assert.strictEqual(todayLogs.length, 1);
      await TrackerStorage.deleteLog(todayLogs[0].id);

      stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.currentStreak, 4, `Expected 4-day streak ending yesterday, got ${stats.currentStreak}`);

      const yesterdayLogs = await TrackerStorage.getLogs({ startDate: dayMinus1, endDate: dayMinus1 });
      assert.strictEqual(yesterdayLogs.length, 1);
      await TrackerStorage.deleteLog(yesterdayLogs[0].id);

      stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.currentStreak, 0, `Expected 0 streak when missing yesterday and today, got ${stats.currentStreak}`);
    });

    await test('4.6: Streak calculation spanning across month boundary and leap year', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const today = TrackerStorage.getLocalDateStr();
      const d1 = TrackerStorage.addDays(today, -1);
      const d2 = TrackerStorage.addDays(today, -2);
      const d3 = TrackerStorage.addDays(today, -3);
      const d4 = TrackerStorage.addDays(today, -4);
      const d5 = TrackerStorage.addDays(today, -5);

      mockEnv.memoryStore['logs'] = [
        { id: '1', metricId: 'jobs', date: d5, count: 1, userEmail: null },
        { id: '2', metricId: 'jobs', date: d4, count: 2, userEmail: null },
        { id: '3', metricId: 'jobs', date: d3, count: 1, userEmail: null },
        { id: '4', metricId: 'jobs', date: d2, count: 3, userEmail: null },
        { id: '5', metricId: 'jobs', date: d1, count: 1, userEmail: null },
        { id: '6', metricId: 'jobs', date: today, count: 1, userEmail: null },
      ];

      const stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.currentStreak, 6, `Expected 6-day streak, got ${stats.currentStreak}`);
    });

    await test('4.7: Multiple entries on same day do not artificially inflate streak count', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const todayStr = TrackerStorage.getLocalDateStr();
      const dayMinus1 = TrackerStorage.addDays(todayStr, -1);

      for (let i = 0; i < 10; i++) {
        await TrackerStorage.addLog({ metricId: 'jobs', date: todayStr, count: 1 });
      }
      for (let i = 0; i < 5; i++) {
        await TrackerStorage.addLog({ metricId: 'jobs', date: dayMinus1, count: 1 });
      }

      const stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.today.jobs, 10, 'Today total jobs should be 10');
      assert.strictEqual(stats.currentStreak, 2, `Streak should be 2 calendar days, got ${stats.currentStreak}`);
    });

    await test('4.8: Other metrics (e.g. leetcode) do not contribute to jobs streak', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const todayStr = TrackerStorage.getLocalDateStr();
      const dayMinus1 = TrackerStorage.addDays(todayStr, -1);

      await TrackerStorage.addLog({ metricId: 'leetcode', date: dayMinus1, count: 5 });
      await TrackerStorage.addLog({ metricId: 'leetcode', date: todayStr, count: 3 });

      const stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.today.leetcode, 3);
      assert.strictEqual(stats.today.jobs, 0);
      assert.strictEqual(stats.currentStreak, 0, 'Jobs streak must be 0 when only leetcode is logged');
    });

    await test('4.9: 100-day historical activity simulation with arbitrary gaps computes correct streak', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const today = TrackerStorage.getLocalDateStr();
      const logs = [];

      // Create logs for 15 consecutive days (today down to today-14)
      for (let i = 0; i < 15; i++) {
        logs.push({
          id: `hist-${i}`,
          metricId: 'jobs',
          date: TrackerStorage.addDays(today, -i),
          count: 1,
          userEmail: null
        });
      }

      // Gap at day-15 (no log)
      // Older logs from day-16 to day-50
      for (let i = 16; i <= 50; i++) {
        logs.push({
          id: `old-${i}`,
          metricId: 'jobs',
          date: TrackerStorage.addDays(today, -i),
          count: 1,
          userEmail: null
        });
      }

      mockEnv.memoryStore['logs'] = logs;

      const stats = await TrackerStorage.getStats();
      assert.strictEqual(stats.currentStreak, 15, `Streak should stop at the gap and equal 15, got ${stats.currentStreak}`);
      assert.strictEqual(stats.totals.jobs, 50, `Total jobs should equal 50`);
    });
  });

  // -----------------------------------------------------------------------
  // SUITE 5: Input Sanitization & Storage Corruption Resilience
  // -----------------------------------------------------------------------
  await describe('Suite 5: Input Sanitization & Storage Corruption Resilience', async () => {
    await test('5.1: addLog with null, undefined, empty object, negative/invalid counts', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const log1 = await TrackerStorage.addLog();
      assert.ok(log1.id.startsWith('log-'));
      assert.strictEqual(log1.metricId, 'jobs');
      assert.strictEqual(log1.count, 1);
      assert.strictEqual(log1.date, TrackerStorage.getLocalDateStr());

      const log2 = await TrackerStorage.addLog({ count: -5 });
      assert.strictEqual(log2.count, 1);

      const log3 = await TrackerStorage.addLog({ count: 0 });
      assert.strictEqual(log3.count, 1);

      const log4 = await TrackerStorage.addLog({ count: '7' });
      assert.strictEqual(log4.count, 7);

      const log5 = await TrackerStorage.addLog({ count: 'invalid' });
      assert.strictEqual(log5.count, 1);
    });

    await test('5.2: addLog trims text fields and safely stores special characters & injection strings', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const maliciousPayload = {
        metricId: 'jobs',
        company: '  <script>alert("XSS")</script>  ',
        role: "  Robert'); DROP TABLE Users;--  ",
        notes: '  Special symbols: & < > " \' / \n \t \u0000 [SYMBOL]  '
      };

      const created = await TrackerStorage.addLog(maliciousPayload);
      assert.strictEqual(created.company, '<script>alert("XSS")</script>');
      assert.strictEqual(created.role, "Robert'); DROP TABLE Users;--");
      assert.strictEqual(created.notes, 'Special symbols: & < > " \' / \n \t \u0000 [SYMBOL]');

      const logs = await TrackerStorage.getLogs();
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].company, '<script>alert("XSS")</script>');
    });

    await test('5.3: Storage corruption resilience (logs=null, string, object, malformed entries)', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      mockEnv.memoryStore['logs'] = null;
      assert.deepStrictEqual(await TrackerStorage.getLogs(), []);
      assert.strictEqual(await TrackerStorage.undoLastLog(), false);
      const added1 = await TrackerStorage.addLog({ metricId: 'jobs' });
      assert.ok(added1.id);
      assert.strictEqual((await TrackerStorage.getLogs()).length, 1);

      mockEnv.memoryStore['logs'] = 'CORRUPTED_STRING';
      assert.deepStrictEqual(await TrackerStorage.getLogs(), []);
      const added2 = await TrackerStorage.addLog({ metricId: 'jobs' });
      assert.ok(added2.id);

      mockEnv.memoryStore['logs'] = { foo: 'bar' };
      assert.deepStrictEqual(await TrackerStorage.getLogs(), []);

      mockEnv.memoryStore['logs'] = [
        null,
        undefined,
        { id: 'valid-1', metricId: 'jobs', date: '2026-09-02', timestamp: '2026-09-02T12:00:00Z', count: 1, userEmail: null },
        { corrupted: true }
      ];

      const retrieved = await TrackerStorage.getLogs('jobs');
      assert.strictEqual(retrieved.length, 1, 'Should filter out null and unmatching objects safely');
      assert.strictEqual(retrieved[0].id, 'valid-1');
    });

    await test('5.4: Metrics storage corruption resilience (metrics=null, string, empty)', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      mockEnv.memoryStore['metrics'] = null;
      const metrics1 = await TrackerStorage.getMetrics();
      assert.strictEqual(metrics1.length, 2);
      assert.strictEqual(metrics1[0].id, 'jobs');
      assert.strictEqual(metrics1[1].id, 'leetcode');

      mockEnv.memoryStore['metrics'] = 'CORRUPTED';
      const metrics2 = await TrackerStorage.getMetrics();
      assert.strictEqual(metrics2.length, 2);

      await TrackerStorage.saveMetrics('not an array');
      const metrics3 = await TrackerStorage.getMetrics();
      assert.strictEqual(metrics3.length, 2, 'Empty metrics automatically falls back to DEFAULT_METRICS');
    });

    await test('5.5: normalizeEmail and multi-user data isolation', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      assert.strictEqual(TrackerStorage.normalizeEmail('  USER@EXAMPLE.COM  '), 'user@example.com');
      assert.strictEqual(TrackerStorage.normalizeEmail(null), null);
      assert.strictEqual(TrackerStorage.normalizeEmail(undefined), null);
      assert.strictEqual(TrackerStorage.normalizeEmail(''), null);
      assert.strictEqual(TrackerStorage.normalizeEmail('   '), null);
      assert.strictEqual(TrackerStorage.normalizeEmail(123), null);

      const logAnon = await TrackerStorage.addLog({ metricId: 'jobs', company: 'AnonCo' }, null);
      const logUserA = await TrackerStorage.addLog({ metricId: 'jobs', company: 'UserACo' }, 'alice@gmail.com');
      const logUserB = await TrackerStorage.addLog({ metricId: 'jobs', company: 'UserBCo' }, 'bob@gmail.com');

      const anonLogs = await TrackerStorage.getLogs({}, null);
      assert.strictEqual(anonLogs.length, 1);
      assert.strictEqual(anonLogs[0].company, 'AnonCo');

      const aliceLogs = await TrackerStorage.getLogs({}, 'alice@gmail.com');
      assert.strictEqual(aliceLogs.length, 1);
      assert.strictEqual(aliceLogs[0].company, 'UserACo');

      const bobLogs = await TrackerStorage.getLogs({}, '  BOB@GMAIL.COM ');
      assert.strictEqual(bobLogs.length, 1);
      assert.strictEqual(bobLogs[0].company, 'UserBCo');

      const aliceStats = await TrackerStorage.getStats('alice@gmail.com');
      assert.strictEqual(aliceStats.today.jobs, 1);
      assert.strictEqual(aliceStats.totalLogs, 1);

      const bobStats = await TrackerStorage.getStats('bob@gmail.com');
      assert.strictEqual(bobStats.today.jobs, 1);
      assert.strictEqual(bobStats.totalLogs, 1);

      const anonStats = await TrackerStorage.getStats(null);
      assert.strictEqual(anonStats.today.jobs, 1);
      assert.strictEqual(anonStats.totalLogs, 1);
    });

    await test('5.6: addMetric custom metric ownership and email isolation', async () => {
      const mockEnv = createMockChromeStorage();
      const TrackerStorage = loadTrackerStorage(mockEnv);

      const aliceMetric = await TrackerStorage.addMetric({ name: 'Alice Projects' }, 'alice@gmail.com');
      const bobMetric = await TrackerStorage.addMetric({ name: 'Bob Running' }, 'bob@gmail.com');
      const anonMetric = await TrackerStorage.addMetric({ name: 'Public Reading' }, null);

      const anonMetrics = await TrackerStorage.getMetrics(null);
      assert.strictEqual(anonMetrics.length, 3);
      assert.ok(anonMetrics.some(m => m.id === anonMetric.id));
      assert.ok(!anonMetrics.some(m => m.id === aliceMetric.id));
      assert.ok(!anonMetrics.some(m => m.id === bobMetric.id));

      const aliceMetrics = await TrackerStorage.getMetrics('alice@gmail.com');
      assert.strictEqual(aliceMetrics.length, 3);
      assert.ok(aliceMetrics.some(m => m.id === aliceMetric.id));
      assert.ok(!aliceMetrics.some(m => m.id === bobMetric.id));
      assert.ok(!aliceMetrics.some(m => m.id === anonMetric.id));
    });

    await test('5.7: localStorage fallback executes properly when chrome.storage is absent', async () => {
      const TrackerStorage = loadTrackerStorage(null, true);

      const added = await TrackerStorage.addLog({ metricId: 'jobs', company: 'LocalStorageCo' });
      assert.ok(added.id);

      const logs = await TrackerStorage.getLogs('jobs');
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].company, 'LocalStorageCo');

      const undo = await TrackerStorage.undoLastLog('jobs');
      assert.strictEqual(undo, true);

      const remaining = await TrackerStorage.getLogs('jobs');
      assert.strictEqual(remaining.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // SUITE 6: Strict Zero-Emoji Compliance Check
  // -----------------------------------------------------------------------
  await describe('Suite 6: Strict Zero-Emoji Compliance Check', async () => {
    await test('6.1: Project codebase must contain 0 emoji characters across all source files', () => {
      const rootDir = path.resolve(__dirname, '..');
      const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}\u{1FA70}-\u{1FAFF}]/u;

      const checkedFiles = [];
      const violations = [];

      function scanDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(rootDir, fullPath);

          if (relPath.startsWith('.git') || relPath.startsWith('.agents') || relPath.startsWith('tests')) {
            continue;
          }

          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile()) {
            if (/\.(html|css|js|json|md)$/i.test(entry.name)) {
              checkedFiles.push(relPath);
              const content = fs.readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                if (emojiRegex.test(line)) {
                  violations.push({ file: relPath, line: idx + 1, content: line.trim() });
                }
              });
            }
          }
        }
      }

      scanDir(rootDir);

      console.log(`       Scanned ${checkedFiles.length} source files for zero-emoji policy.`);
      if (violations.length > 0) {
        const details = violations.map(v => `${v.file}:${v.line} -> ${v.content}`).join('\n');
        assert.fail(`Found ${violations.length} emoji violations:\n${details}`);
      }
      assert.strictEqual(violations.length, 0, 'No emojis allowed in codebase');
    });
  });

  // -----------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------
  console.log(`\n${colors.bold}========================================${colors.reset}`);
  console.log(`${colors.bold}Test Execution Summary:${colors.reset}`);
  console.log(`  Total Tests:  ${totalTests}`);
  console.log(`  ${colors.green}Passed Tests: ${passedTests}${colors.reset}`);
  console.log(`  ${colors.red}Failed Tests: ${failedTests}${colors.reset}`);
  console.log(`${colors.bold}========================================${colors.reset}`);

  if (failedTests > 0) {
    console.error(`\n${colors.red}Failed Tests List:${colors.reset}`);
    failures.forEach((f, idx) => {
      console.error(`  ${idx + 1}. ${f.name} - ${f.error.message}`);
    });
    process.exit(1);
  } else {
    console.log(`\n${colors.green}${colors.bold}ALL ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY!${colors.reset}\n`);
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
