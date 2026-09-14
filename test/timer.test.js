// LeetCode countdown solve-timer state machine, timer input parsing, and
// Google Calendar date-key decoding tests.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

// ---------------------------------------------------------------------------
// Minimal DOM stub. content.js only reaches for a handful of dock elements from
// the code paths exercised here, so a tiny fake document is enough to drive the
// timer state machine headlessly.
// ---------------------------------------------------------------------------
function makeElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    style: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    }
  };
}

function installDomStub() {
  const elements = {
    'pt-dock-timer-input': makeElement('pt-dock-timer-input'),
    'pt-dock-timer-toggle': makeElement('pt-dock-timer-toggle')
  };
  global.document = {
    readyState: 'loading',
    activeElement: null,
    addEventListener() {},
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  global.window = { addEventListener() {} };
  return elements;
}

// The countdown is deadline-based, so a test advances the CLOCK; calling the
// repaint tick on its own is not supposed to move the timer.
let fakeNow = 1700000000000;

function advance(content, seconds) {
  fakeNow += seconds * 1000;
  content.tickDockTimer();
}

function readKey(key) {
  return new Promise(resolve => {
    global.chrome.storage.local.get([key], r => resolve(r && r[key]));
  });
}

function loadContentScript() {
  const mock = installMockChrome();
  delete require.cache[require.resolve('../shared/auth')];
  delete require.cache[require.resolve('../shared/storage')];
  delete require.cache[require.resolve('../content/content')];
  global.TrackerAuth = require('../shared/auth');
  global.TrackerStorage = require('../shared/storage');
  const elements = installDomStub();
  const content = require('../content/content');
  fakeNow = 1700000000000;
  content.__setNow(() => fakeNow);
  return { mock, content, elements, TrackerStorage: global.TrackerStorage };
}

function teardown(content) {
  // Stop any interval the test left running before the DOM stub disappears.
  if (content && typeof content.pauseDockTimer === 'function') content.pauseDockTimer();
  if (content && typeof content.__setNow === 'function') content.__setNow(null);
  delete global.document;
  delete global.window;
  delete global.TrackerAuth;
  delete global.TrackerStorage;
  uninstallMockChrome();
}

async function run() {
  console.log('--- Running test/timer.test.js ---');

  // 1. Countdown records ELAPSED time, never the remaining time
  {
    const { content } = loadContentScript();

    assert.strictEqual(content.applyDockTimerInput('25:00'), true);
    let state = content.getDockTimerState();
    assert.strictEqual(state.seconds, 1500);
    assert.strictEqual(state.target, 1500);

    content.startDockTimer();
    state = content.getDockTimerState();
    assert.strictEqual(state.running, true, 'Timer should be running after start');
    assert.strictEqual(state.hasInterval, true, 'Timer should hold an interval handle');

    advance(content, 5);
    assert.strictEqual(content.getDockTimerState().seconds, 1495);
    assert.strictEqual(content.getDockElapsedSeconds(), 5, 'Elapsed must be target minus remaining');

    // The value threaded into addLog must be the 5 seconds spent, not the 1495 left
    const solve = content.consumeDockSolveTime();
    assert.strictEqual(solve, 5);
    assert.strictEqual(content.formatSolveTimeString(solve), 'Solve time: 5s');

    state = content.getDockTimerState();
    assert.strictEqual(state.seconds, 0, 'Consuming a session clears the countdown');
    assert.strictEqual(state.target, 0, 'Consuming a session clears the target');
    assert.strictEqual(state.running, false);
    assert.strictEqual(state.hasInterval, false, 'Consuming a session must clear the interval');

    console.log('[PASS] Countdown reports elapsed time, not remaining time');
    teardown(content);
  }

  // 2. A countdown that runs out records the full target and stops cleanly
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('0:03');
    assert.strictEqual(content.getDockTimerState().target, 3);
    content.startDockTimer();

    advance(content, 3);

    const state = content.getDockTimerState();
    assert.strictEqual(state.seconds, 0, 'Countdown must land exactly on zero');
    assert.strictEqual(state.running, false, 'Finished countdown must stop itself');
    assert.strictEqual(state.hasInterval, false, 'Finished countdown must clear its interval');
    assert.strictEqual(content.getDockElapsedSeconds(), 3, 'Full target counts as elapsed');

    // Extra time after completion must not drive the value negative
    advance(content, 1);
    assert.strictEqual(content.getDockTimerState().seconds, 0);
    assert.strictEqual(content.getDockElapsedSeconds(), 3);

    console.log('[PASS] Expired countdown stops cleanly and records the full target');
    teardown(content);
  }

  // 3. Starting twice must not leak a second interval (double-speed countdown)
  {
    const realSetInterval = global.setInterval;
    let intervalsCreated = 0;
    let intervalsCleared = 0;
    const realClearInterval = global.clearInterval;
    global.setInterval = function (fn, ms) { intervalsCreated++; return realSetInterval(fn, ms); };
    global.clearInterval = function (h) { intervalsCleared++; return realClearInterval(h); };

    const { content } = loadContentScript();
    content.applyDockTimerInput('10:00');
    content.startDockTimer();
    content.startDockTimer();
    content.startDockTimer();
    assert.strictEqual(intervalsCreated, 1, 'Repeated start must not create extra intervals');

    content.pauseDockTimer();
    assert.strictEqual(content.getDockTimerState().hasInterval, false);
    assert.ok(intervalsCleared >= 1, 'Pause must clear the interval');

    // Pause is idempotent and safe to call when nothing is running
    content.pauseDockTimer();
    assert.strictEqual(content.getDockTimerState().running, false);

    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
    console.log('[PASS] Repeated start and pause do not leak intervals');
    teardown(content);
  }

  // 4. Focusing the time field without editing must not discard elapsed progress
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('25:00');
    content.startDockTimer();
    advance(content, 10);
    assert.strictEqual(content.getDockElapsedSeconds(), 10);

    // User clicks into the field and clicks away again without typing.
    const displayed = global.TrackerStorage.formatSecondsToMMSS(content.getDockTimerState().seconds);
    const rearmed = content.applyDockTimerInput(displayed, displayed);
    assert.strictEqual(rearmed, false, 'An unchanged field must not re-arm the countdown');
    assert.strictEqual(content.getDockElapsedSeconds(), 10, 'Elapsed progress must survive focus/blur');
    assert.strictEqual(content.getDockTimerState().target, 1500, 'Target must survive focus/blur');

    // A real edit does re-arm and resets the elapsed baseline, as intended.
    assert.strictEqual(content.applyDockTimerInput('30:00', displayed), true);
    assert.strictEqual(content.getDockTimerState().target, 1800);
    assert.strictEqual(content.getDockElapsedSeconds(), 0);

    console.log('[PASS] Focus without edit preserves elapsed progress');
    teardown(content);
  }

  // 5. Reset restores the armed target rather than zeroing the timer
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('25:00');
    content.startDockTimer();
    advance(content, 30);
    assert.strictEqual(content.getDockTimerState().seconds, 1470);

    content.resetDockTimer();
    const state = content.getDockTimerState();
    assert.strictEqual(state.seconds, 1500, 'Reset restores the countdown target');
    assert.strictEqual(state.target, 1500);
    assert.strictEqual(state.running, false);
    assert.strictEqual(state.hasInterval, false);
    assert.strictEqual(content.getDockElapsedSeconds(), 0);

    console.log('[PASS] Reset restores the armed countdown target');
    teardown(content);
  }

  // 6. Garbage input must never arm a negative, NaN, or absurd countdown
  {
    const { content, TrackerStorage } = loadContentScript();

    const garbage = ['abc', '', '   ', '-5', '-5:30', '1:-30', '1:2:3:4', ':', 'abc:def', '::', 'Infinity', 'NaN'];
    garbage.forEach(value => {
      assert.strictEqual(
        TrackerStorage.parseStringToSeconds(value),
        0,
        'parseStringToSeconds("' + value + '") must be 0, got ' + TrackerStorage.parseStringToSeconds(value)
      );
    });

    // Well-formed values still parse as before
    assert.strictEqual(TrackerStorage.parseStringToSeconds('99:99'), 6039);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('1:2:3'), 3723);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('0:01'), 1);

    // Absurd values are clamped to 24 hours instead of arming a multi-year countdown
    assert.strictEqual(TrackerStorage.parseStringToSeconds('99999999999'), 86400);
    assert.strictEqual(TrackerStorage.parseStringToSeconds('999:99:99'), 86400);

    // Garbage leaves the timer disarmed and start refuses to run
    content.applyDockTimerInput('abc');
    let state = content.getDockTimerState();
    assert.strictEqual(state.seconds, 0);
    assert.strictEqual(state.target, 0);
    content.startDockTimer();
    state = content.getDockTimerState();
    assert.strictEqual(state.running, false, 'A zero countdown must not start');
    assert.strictEqual(state.hasInterval, false, 'A refused start must not leave an interval');
    assert.strictEqual(content.getDockElapsedSeconds(), 0, 'A disarmed timer reports no elapsed time');

    console.log('[PASS] Garbage timer input never arms a negative or unbounded countdown');
    teardown(content);
  }

  // 7. Editing the field to zero while running stops the countdown
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('0:05');
    content.startDockTimer();
    advance(content, 1);
    assert.strictEqual(content.getDockTimerState().running, true);

    content.applyDockTimerInput('abc', '00:04');
    const state = content.getDockTimerState();
    assert.strictEqual(state.seconds, 0);
    assert.strictEqual(state.running, false, 'Clearing the field must stop the countdown');
    assert.strictEqual(state.hasInterval, false, 'Clearing the field must clear the interval');

    console.log('[PASS] Clearing the time field stops a running countdown');
    teardown(content);
  }

  // 8. Google Calendar date-key decoding
  {
    const { content } = loadContentScript();

    // dateKey = (year - 1970) * 512 + (month - 1) * 32 + day + 32
    const encode = (y, m, d) => (y - 1970) * 512 + (m - 1) * 32 + d + 32;
    const iso = (y, m, d) =>
      y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

    assert.strictEqual(content.dateFromDateKey(String(encode(2026, 9, 10))), '2026-09-10');
    assert.strictEqual(content.dateFromDateKey(String(encode(2026, 1, 1))), '2026-01-01');
    assert.strictEqual(content.dateFromDateKey(String(encode(2026, 12, 31))), '2026-12-31');

    // Regression: keys below the old 25000 floor fell through to the epoch-days
    // branch and decoded roughly 19 years into the future.
    assert.strictEqual(content.dateFromDateKey(String(encode(2018, 1, 1))), '2018-01-01');
    assert.strictEqual(content.dateFromDateKey(String(encode(2010, 6, 15))), '2010-06-15');
    assert.strictEqual(content.dateFromDateKey(String(encode(1990, 1, 1))), '1990-01-01');

    // Exhaustive round-trip across the supported range
    for (let y = 1990; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        const daysInMonth = new Date(y, m, 0).getDate();
        for (const d of [1, 15, daysInMonth]) {
          assert.strictEqual(
            content.dateFromDateKey(String(encode(y, m, d))),
            iso(y, m, d),
            'Round-trip failed for ' + iso(y, m, d)
          );
        }
      }
    }

    assert.strictEqual(content.dateFromDateKey('not-a-number'), null);

    console.log('[PASS] Google Calendar date-key decoding round-trips 1990 through 2100');
    teardown(content);
  }

  // 9. Day-modal entry text is HTML-escaped
  {
    const { content } = loadContentScript();

    assert.strictEqual(
      content.escapeHtml('<img src=x onerror="alert(1)">'),
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
    assert.strictEqual(content.escapeHtml('Johnson & Johnson'), 'Johnson &amp; Johnson');
    assert.strictEqual(content.escapeHtml("O'Reilly"), 'O&#39;Reilly');
    assert.strictEqual(content.escapeHtml(null), '');
    assert.strictEqual(content.escapeHtml(undefined), '');

    console.log('[PASS] Day-modal entry text is HTML-escaped');
    teardown(content);
  }

  // 10. Source pin: every LeetCode log path must consume elapsed time via the
  //     shared helper. The dock quick-add button used to log the REMAINING time.
  {
    const source = fs.readFileSync(path.resolve(__dirname, '../content/content.js'), 'utf8');
    assert.ok(
      !/formatSolveTimeString\(\s*dockTimerSeconds\s*\)/.test(source),
      'content.js must not format the remaining countdown value as the solve time'
    );
    const consumeCalls = (source.match(/consumeDockSolveTime\(\)/g) || []).length;
    assert.ok(
      consumeCalls >= 3,
      'Every LeetCode log path must route through consumeDockSolveTime, found ' + consumeCalls
    );
    assert.ok(
      /solveTimeSeconds/.test(source),
      'content.js must thread solveTimeSeconds into addLog'
    );

    console.log('[PASS] All LeetCode log paths consume elapsed solve time');
  }

  // 11. A running countdown is persisted as a DEADLINE, which is what lets it
  //     survive the page being closed.
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('25:00');
    content.startDockTimer();
    advance(content, 60);

    const rec = content.dockTimerRecord();
    assert.strictEqual(rec.status, 'running');
    assert.strictEqual(rec.targetSeconds, 1500);
    assert.ok(rec.endsAt > 0, 'A running countdown must persist a deadline');
    assert.strictEqual(rec.remainingSeconds, 1440);

    const stored = await readKey('pt_timer_dock');
    assert.ok(stored, 'A running countdown must be written to storage');
    assert.strictEqual(stored.status, 'running', 'Storage record drives the background alarm');
    assert.ok(stored.endsAt > 0, 'Stored record must carry the deadline');

    console.log('[PASS] A running countdown persists a deadline to storage');
    teardown(content);
  }

  // 12. Reopening while the deadline is still ahead resumes at the correct
  //     remaining time, counting the wall-clock time the page was gone.
  {
    const { content } = loadContentScript();

    const endsAt = fakeNow + 900 * 1000;
    content.applyStoredDockTimer({
      status: 'running',
      targetSeconds: 1500,
      endsAt: endsAt,
      remainingSeconds: 1500,
      finishedAt: null,
      updatedAt: endsAt - 1500 * 1000
    });

    const st = content.getDockTimerState();
    assert.strictEqual(st.running, true, 'A live deadline must resume running');
    assert.strictEqual(st.seconds, 900, 'Remaining time comes from the deadline, not a tick count');
    assert.strictEqual(content.getDockElapsedSeconds(), 600, 'Elapsed must span the time the page was closed');

    console.log('[PASS] A countdown resumes correctly after the page was closed');
    teardown(content);
  }

  // 13. The case this whole design exists for: the countdown ran out while the
  //     page was closed. Reopening must show it finished, not still ticking.
  {
    const { content } = loadContentScript();

    const endsAt = fakeNow - 5 * 1000;
    content.applyStoredDockTimer({
      status: 'running',
      targetSeconds: 1500,
      endsAt: endsAt,
      remainingSeconds: 1500,
      finishedAt: null,
      updatedAt: endsAt - 1500 * 1000
    });

    const st = content.getDockTimerState();
    assert.strictEqual(st.running, false, 'An expired deadline must not resume running');
    assert.strictEqual(st.hasInterval, false, 'An expired deadline must not leave an interval behind');
    assert.strictEqual(st.seconds, 0);
    assert.strictEqual(st.finishedAt, endsAt, 'Finish time is the deadline, not the moment of reopening');
    assert.strictEqual(content.getDockElapsedSeconds(), 1500, 'A completed countdown counts the full target');

    console.log('[PASS] A countdown that ran out while closed reopens as finished');
    teardown(content);
  }

  // 14. Pausing clears the deadline, which is what disarms the background alarm.
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('10:00');
    content.startDockTimer();
    advance(content, 120);
    content.pauseDockTimer();

    const rec = content.dockTimerRecord();
    assert.strictEqual(rec.status, 'paused');
    assert.strictEqual(rec.endsAt, null, 'A paused countdown must not leave a deadline armed');
    assert.strictEqual(rec.remainingSeconds, 480);

    // Time passing while paused must not move the countdown.
    fakeNow += 300 * 1000;
    assert.strictEqual(content.getDockTimerState().seconds, 480, 'A paused countdown must not drift');

    console.log('[PASS] Pausing disarms the deadline and cannot drift');
    teardown(content);
  }

  // 15. Logging the solve clears the record, so no alarm outlives the session.
  {
    const { content } = loadContentScript();

    content.applyDockTimerInput('30:00');
    content.startDockTimer();
    advance(content, 300);

    assert.strictEqual(content.consumeDockSolveTime(), 300, 'Elapsed, not remaining');

    const rec = content.dockTimerRecord();
    assert.strictEqual(rec.status, 'idle');
    assert.strictEqual(rec.endsAt, null, 'Logging a solve must disarm the background alarm');
    assert.strictEqual(rec.targetSeconds, 0);

    console.log('[PASS] Logging a solve clears the persisted countdown');
    teardown(content);
  }

  console.log('--- test/timer.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
