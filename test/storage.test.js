// Storage CRUD, LIFO tie-breaker, streak calculation, DST protection, input sanitization tests
const assert = require('assert');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

function getFreshStorage(initialStore = {}) {
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
  console.log('--- Running test/storage.test.js ---');

  // 1. Basic CRUD operations
  {
    const { TrackerStorage } = getFreshStorage();
    const today = TrackerStorage.getLocalDateStr();

    // Create log
    const log1 = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: 'Google',
      role: 'Staff Software Engineer',
      notes: 'Applied via portal',
      date: today
    });

    assert.ok(log1.id, 'Log ID should be generated');
    assert.strictEqual(log1.metricId, 'jobs');
    assert.strictEqual(log1.company, 'Google');
    assert.strictEqual(log1.role, 'Staff Software Engineer');
    assert.strictEqual(log1.notes, 'Applied via portal');
    assert.strictEqual(log1.date, today);
    assert.strictEqual(log1.count, 1);

    // Read logs
    let logs = await TrackerStorage.getLogs({ metricId: 'jobs', date: today });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, log1.id);

    // Add second log for leetcode
    const log2 = await TrackerStorage.addLog({
      metricId: 'leetcode',
      count: 3,
      date: today
    });
    assert.strictEqual(log2.count, 3);

    // Query all logs
    logs = await TrackerStorage.getLogs();
    assert.strictEqual(logs.length, 2);

    // Delete single log
    const delResult = await TrackerStorage.deleteLog(log1.id);
    assert.strictEqual(delResult, true);
    logs = await TrackerStorage.getLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, log2.id);

    console.log('[PASS] Basic CRUD operations');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 2. LIFO Tie-Breaker and Deterministic Ordering
  {
    const { TrackerStorage } = getFreshStorage();
    const today = TrackerStorage.getLocalDateStr();

    // Add 3 logs for the same metric on the same date with simulated identical timestamps
    const sameIso = new Date().toISOString();
    const logA = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Company A', date: today, createdAt: sameIso });
    const logB = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Company B', date: today, createdAt: sameIso });
    const logC = await TrackerStorage.addLog({ metricId: 'jobs', company: 'Company C', date: today, createdAt: sameIso });

    let logs = await TrackerStorage.getLogs({ metricId: 'jobs', date: today });
    assert.strictEqual(logs.length, 3);
    // LIFO: most recently added (logC) must come first
    assert.strictEqual(logs[0].id, logC.id);
    assert.strictEqual(logs[1].id, logB.id);
    assert.strictEqual(logs[2].id, logA.id);

    // Undo last log -> should remove logC
    const undoRes1 = await TrackerStorage.undoLastLog('jobs', today);
    assert.strictEqual(undoRes1, true);

    logs = await TrackerStorage.getLogs({ metricId: 'jobs', date: today });
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0].id, logB.id);
    assert.strictEqual(logs[1].id, logA.id);

    // Undo last log again -> should remove logB
    const undoRes2 = await TrackerStorage.undoLastLog('jobs', today);
    assert.strictEqual(undoRes2, true);

    logs = await TrackerStorage.getLogs({ metricId: 'jobs', date: today });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, logA.id);

    // Undo last log again -> should remove logA
    const undoRes3 = await TrackerStorage.undoLastLog('jobs', today);
    assert.strictEqual(undoRes3, true);

    logs = await TrackerStorage.getLogs({ metricId: 'jobs', date: today });
    assert.strictEqual(logs.length, 0);

    // Over-undo returns false safely
    const undoRes4 = await TrackerStorage.undoLastLog('jobs', today);
    assert.strictEqual(undoRes4, false);

    console.log('[PASS] LIFO tie-breaker and deterministic undo');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 3. Streak Calculations
  {
    const { TrackerStorage } = getFreshStorage();
    const today = TrackerStorage.getLocalDateStr();
    const yesterday = TrackerStorage.addDays(today, -1);
    const twoDaysAgo = TrackerStorage.addDays(today, -2);
    const threeDaysAgo = TrackerStorage.addDays(today, -3);

    // 3-day consecutive streak ending today
    await TrackerStorage.addLog({ metricId: 'jobs', date: twoDaysAgo });
    await TrackerStorage.addLog({ metricId: 'jobs', date: yesterday });
    await TrackerStorage.addLog({ metricId: 'jobs', date: today });
    // Add multiple entries on today to ensure no streak inflation
    await TrackerStorage.addLog({ metricId: 'jobs', date: today });
    // Add LeetCode to ensure other metrics do not alter jobs streak
    await TrackerStorage.addLog({ metricId: 'leetcode', date: threeDaysAgo });

    let stats = await TrackerStorage.getStats();
    assert.strictEqual(stats.currentStreak, 3, 'Streak should be 3');
    assert.strictEqual(stats.today['jobs'], 2);
    assert.strictEqual(stats.totals['jobs'], 4);

    // Test streak active ending yesterday (user hasn't logged today yet)
    const { TrackerStorage: ts2 } = getFreshStorage();
    await ts2.addLog({ metricId: 'jobs', date: twoDaysAgo });
    await ts2.addLog({ metricId: 'jobs', date: yesterday });
    let stats2 = await ts2.getStats();
    assert.strictEqual(stats2.currentStreak, 2, 'Streak ending yesterday should be 2');

    // Test broken streak (gap between twoDaysAgo and fourDaysAgo)
    const { TrackerStorage: ts3 } = getFreshStorage();
    const fourDaysAgo = ts3.addDays(today, -4);
    await ts3.addLog({ metricId: 'jobs', date: fourDaysAgo });
    let stats3 = await ts3.getStats();
    assert.strictEqual(stats3.currentStreak, 0, 'Streak with gap to today/yesterday should be 0');

    console.log('[PASS] Streak calculations and boundary handling');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 4. DST Protection and Date Math
  {
    const { TrackerStorage } = getFreshStorage();

    // Leap year 2024: Feb 28 -> Feb 29 -> Mar 1
    assert.strictEqual(TrackerStorage.addDays('2024-02-28', 1), '2024-02-29');
    assert.strictEqual(TrackerStorage.addDays('2024-02-28', 2), '2024-03-01');

    // Non-leap year 2023: Feb 28 -> Mar 1
    assert.strictEqual(TrackerStorage.addDays('2023-02-28', 1), '2023-03-01');

    // Year boundary: 2025-12-31 -> 2026-01-01
    assert.strictEqual(TrackerStorage.addDays('2025-12-31', 1), '2026-01-01');
    assert.strictEqual(TrackerStorage.addDays('2026-01-01', -1), '2025-12-31');

    // Noon-based parsing prevents hour-shift errors
    const dStr = '2026-03-08'; // typical DST change weekend
    const nextDay = TrackerStorage.addDays(dStr, 1);
    assert.strictEqual(nextDay, '2026-03-09');

    console.log('[PASS] DST protection and leap year / date boundary math');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 5. Input Sanitization & Storage Corruption Resilience
  {
    const { TrackerStorage } = getFreshStorage();

    // Invalid / negative counts sanitized to 1
    const logNeg = await TrackerStorage.addLog({ metricId: 'jobs', count: -5 });
    assert.strictEqual(logNeg.count, 1);

    const logZero = await TrackerStorage.addLog({ metricId: 'jobs', count: 0 });
    assert.strictEqual(logZero.count, 1);

    const logStr = await TrackerStorage.addLog({ metricId: 'jobs', count: '4' });
    assert.strictEqual(logStr.count, 4);

    // Text fields trimmed
    const logTrim = await TrackerStorage.addLog({
      metricId: 'jobs',
      company: '  Acme Corp   ',
      role: '  Lead Architect  ',
      notes: '  Remote role  '
    });
    assert.strictEqual(logTrim.company, 'Acme Corp');
    assert.strictEqual(logTrim.role, 'Lead Architect');
    assert.strictEqual(logTrim.notes, 'Remote role');

    // Corrupt storage recovery (e.g. logs set to non-array or null)
    global.chrome.storage.local.store['logs'] = 'corrupt_string_value';
    const recoveredLogs = await TrackerStorage.getLogs();
    assert.deepStrictEqual(recoveredLogs, []);

    global.chrome.storage.local.store['logs'] = null;
    const addedAfterCorruption = await TrackerStorage.addLog({ metricId: 'jobs' });
    assert.ok(addedAfterCorruption.id);

    console.log('[PASS] Input sanitization and storage corruption resilience');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  // 6. Theme Storage & Time Helpers (LeetCode Timer)
  {
    const { TrackerStorage } = getFreshStorage();

    // Default theme is 'light'
    const defaultTheme = await TrackerStorage.getTheme();
    assert.strictEqual(defaultTheme, 'light');

    // Setting theme to 'dark'
    const darkTheme = await TrackerStorage.setTheme('dark');
    assert.strictEqual(darkTheme, 'dark');
    const readDark = await TrackerStorage.getTheme();
    assert.strictEqual(readDark, 'dark');

    // Sanitization: invalid theme falls back to 'light'
    const fallbackTheme = await TrackerStorage.setTheme('unknown_theme');
    assert.strictEqual(fallbackTheme, 'light');
    const readFallback = await TrackerStorage.getTheme();
    assert.strictEqual(readFallback, 'light');

    // Time formatting (formatSecondsToMMSS)
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(0), '00:00');
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(59), '00:59');
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(60), '01:00');
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(150), '02:30');
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(3600), '60:00');
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(-10), '00:00');
    assert.strictEqual(TrackerStorage.formatSecondsToMMSS(null), '00:00');

    // Time parsing (parseStringToSeconds)
    assert.strictEqual(TrackerStorage.parseStringToSeconds('25:00'), 1500);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('05:30'), 330);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('1:15:00'), 4500);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('25'), 1500);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('15'), 900);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('600'), 600);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('abc'), 0);
    assert.strictEqual(TrackerStorage.parseStringToSeconds(''), 0);
    assert.strictEqual(TrackerStorage.parseStringToSeconds(null), 0);

    // Cumulative LeetCode time helpers
    assert.strictEqual(TrackerStorage.formatTimeHMS(45), '45s');
    assert.strictEqual(TrackerStorage.formatTimeHMS(120), '2m');
    assert.strictEqual(TrackerStorage.formatTimeHMS(150), '2m 30s');
    assert.strictEqual(TrackerStorage.formatTimeHMS(3660), '1h 1m');

    // getLeetcodeTimeStats
    await TrackerStorage.addLog({ metricId: 'leetcode', count: 1, solveTimeSeconds: 1500 });
    await TrackerStorage.addLog({ metricId: 'leetcode', count: 1, solveTimeSeconds: 900 });
    await TrackerStorage.addLog({ metricId: 'jobs', count: 1 });

    const stats = await TrackerStorage.getLeetcodeTimeStats();
    assert.strictEqual(stats.totalSeconds, 2400);
    assert.strictEqual(stats.todaySeconds, 2400);
    assert.strictEqual(stats.sessionCount, 2);
    assert.strictEqual(stats.todaySessionCount, 2);
    assert.strictEqual(stats.avgSeconds, 1200);

    console.log('[PASS] Theme storage persistence and LeetCode time helpers');
    delete global.TrackerAuth;
    delete global.TrackerStorage;
    uninstallMockChrome();
  }

  console.log('--- test/storage.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
