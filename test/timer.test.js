// Google Calendar date-key decoding, day-modal HTML escaping, and the popup
// countdown's persistence guard. (The calendar dock and its timer are gone;
// the popup keeps the only countdown.)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

// content.js only needs a document to exist at load; it defers init until
// DOMContentLoaded, which the stub never fires.
function installDomStub() {
  global.document = {
    readyState: 'loading',
    activeElement: null,
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  global.window = { addEventListener() {} };
}

function loadContentScript() {
  const mock = installMockChrome();
  delete require.cache[require.resolve('../shared/auth')];
  delete require.cache[require.resolve('../shared/storage')];
  delete require.cache[require.resolve('../content/content')];
  global.TrackerAuth = require('../shared/auth');
  global.TrackerStorage = require('../shared/storage');
  installDomStub();
  const content = require('../content/content');
  return { mock, content, TrackerStorage: global.TrackerStorage };
}

function teardown() {
  delete global.document;
  delete global.window;
  delete global.TrackerAuth;
  delete global.TrackerStorage;
  uninstallMockChrome();
}

async function run() {
  console.log('--- Running test/timer.test.js ---');

  // 1. Google Calendar date-key decoding
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

  // 2. Day-modal entry text is HTML-escaped
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

  // 3. The popup timer must survive the popup closing.
  // The popup is a fresh script on every open. Its countdown only survives a
  // close if startup reads the persisted record back; this regressed once by
  // defining hydrateTimer() and never calling it.
  {
    const popupSrc = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.js'), 'utf8');
    const calls = popupSrc.match(/await hydrateTimer\(\)/g) || [];
    assert.ok(calls.length >= 1, 'popup.js must await hydrateTimer() on open');
    const callIdx = popupSrc.indexOf('await hydrateTimer()');
    const loadIdx = popupSrc.lastIndexOf('await loadData()');
    assert.ok(callIdx >= 0 && callIdx < loadIdx, 'the countdown must be hydrated before the first render');
    console.log('[PASS] Popup restores the persisted countdown before its first render');
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
