// Google Calendar overlay tests: one badge per date even when several grid
// cells decode to the same day, header and short cells skipped, idempotent
// re-render, and stale duplicates cleaned up.
const assert = require('assert');
const path = require('path');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');
const dom = require('./mock_dom');

function loadContentScript() {
  const mock = installMockChrome();
  const doc = dom.installDom();
  global.document = doc;
  global.window = {
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ position: 'static' }),
    location: { href: 'https://calendar.google.com/calendar/u/0/r/week' }
  };
  ['../shared/auth', '../shared/storage', '../content/content'].forEach(m => {
    delete require.cache[require.resolve(m)];
  });
  global.TrackerAuth = require('../shared/auth');
  global.TrackerStorage = require('../shared/storage');
  const content = require('../content/content');
  return { mock, doc, content };
}

function teardown(content) {
  if (content && typeof content.pauseDockTimer === 'function') content.pauseDockTimer();
  delete global.document;
  delete global.window;
  delete global.TrackerAuth;
  delete global.TrackerStorage;
  uninstallMockChrome();
}

const METRICS = [
  { id: 'jobs', name: 'Job Applications', color: '#1a73e8', unit: 'jobs', dailyGoal: 5, isDefault: true },
  { id: 'leetcode', name: 'LeetCode', color: '#1e8e3e', unit: 'problems', dailyGoal: 2, isDefault: true }
];

function dateKeyFor(y, m, d) {
  return (y - 1970) * 512 + (m - 1) * 32 + d + 32;
}

// A gridcell the way Calendar renders one: role, date key, a size, a place on
// screen, and optionally a header button the badge is positioned under.
function gridcell(doc, key, { height, top, header }) {
  const cell = dom.el(doc, 'div[role="gridcell"]', { attrs: { 'data-datekey': String(key) } });
  cell.offsetHeight = height;
  cell.rectTop = top;
  if (header) {
    const h = dom.el(doc, 'h2', { text: header });
    h.offsetTop = 4;
    h.offsetHeight = 20;
    cell.appendChild(h);
  }
  return cell;
}

function overlaysIn(doc) {
  return doc.querySelectorAll('.pt-cell-overlay');
}

async function run() {
  console.log('--- Running test/calendar.test.js ---');

  // Week view: the all-day strip and the timed column share a date.
  {
    const { doc, content } = loadContentScript();
    const key14 = dateKeyFor(2026, 9, 14);
    const key15 = dateKeyFor(2026, 9, 15);
    assert.strictEqual(content.dateFromDateKey(key14), '2026-09-14', 'fixture date key decodes');

    const allDay14 = gridcell(doc, key14, { height: 82, top: 100, header: '14' });
    const timed14 = gridcell(doc, key14, { height: 1152, top: 182 });
    const allDay15 = gridcell(doc, key15, { height: 82, top: 100, header: '15' });
    const timed15 = gridcell(doc, key15, { height: 1152, top: 182 });
    // Cells that must never get a badge: a column header and a sliver row.
    const header = dom.el(doc, 'div[role="columnheader"]', { children: [gridcell(doc, key14, { height: 60, top: 0 })] });
    const sliver = gridcell(doc, key14, { height: 30, top: 60 });
    [allDay14, allDay15, timed14, timed15, header, sliver].forEach(c => doc.body.appendChild(c));

    content.__setOverlayState({
      metrics: METRICS,
      stats: { dailyMap: { '2026-09-14': { jobs: 1 }, '2026-09-15': { jobs: 2, leetcode: 2 } } },
      visible: ['jobs', 'leetcode']
    });

    content.renderBadges();

    const overlays = overlaysIn(doc);
    assert.strictEqual(overlays.length, 2, 'one overlay per date, not per cell');
    assert.strictEqual(overlays[0].parentElement, timed14, 'the 14th renders in its lower cell');
    assert.strictEqual(overlays[1].parentElement, timed15, 'the 15th renders in its lower cell');
    assert.strictEqual(allDay14.querySelectorAll('.pt-cell-overlay').length, 0, 'the upper cell for the 14th stays empty');
    assert.strictEqual(allDay14.querySelectorAll('.pt-quick-add-cell').length, 0, 'the upper cell gets no quick-add button either');
    assert.strictEqual(timed14.querySelectorAll('.pt-quick-add-cell').length, 1, 'quick-add lives with the badge');
    assert.strictEqual(header.querySelectorAll('.pt-cell-overlay').length, 0, 'column headers are never badged');
    assert.strictEqual(sliver.querySelectorAll('.pt-cell-overlay').length, 0, 'short cells are never badged');

    const badges14 = timed14.querySelectorAll('.pt-badge');
    assert.strictEqual(badges14.length, 1);
    assert.strictEqual(badges14[0].querySelector('.pt-badge-text').textContent, '1 Job Applied');
    const badges15 = timed15.querySelectorAll('.pt-badge');
    assert.deepStrictEqual(badges15.map(b => b.querySelector('.pt-badge-text').textContent), ['2 Jobs Applied', '2 LeetCode (Goal Met)']);
    assert.ok(badges15[1].classList.contains('pt-goal-met'), 'a met goal is styled');

    // Re-render is idempotent and reuses the overlay when nothing changed.
    const before = overlays[0];
    content.renderBadges();
    assert.strictEqual(overlaysIn(doc).length, 2, 'a second render adds nothing');
    assert.strictEqual(overlaysIn(doc)[0], before, 'unchanged day keeps its overlay node');

    // A data change replaces the overlay, still exactly one for the day.
    content.__setOverlayState({ stats: { dailyMap: { '2026-09-14': { jobs: 3 }, '2026-09-15': { jobs: 2, leetcode: 2 } } } });
    content.renderBadges();
    assert.strictEqual(timed14.querySelectorAll('.pt-cell-overlay').length, 1);
    assert.strictEqual(timed14.querySelector('.pt-badge-text').textContent, '3 Jobs Applied');
    assert.strictEqual(overlaysIn(doc).length, 2);

    teardown(content);
    console.log('[PASS] Week view: a date with two grid cells gets exactly one badge, in the lower cell');
  }

  // Stale duplicates from an earlier render (the reported bug) are removed,
  // including when one cell is nested inside another for the same date.
  {
    const { doc, content } = loadContentScript();
    const key = dateKeyFor(2026, 9, 14);
    const outer = gridcell(doc, key, { height: 400, top: 100, header: '14' });
    const inner = gridcell(doc, key, { height: 300, top: 140 });
    outer.appendChild(inner);
    doc.body.appendChild(outer);

    // Leftovers a previous version left behind in BOTH cells.
    const staleOuter = dom.el(doc, 'div.pt-cell-overlay', { attrs: { 'data-state-key': 'jobs:1:#1a73e8:0' } });
    const staleInner = dom.el(doc, 'div.pt-cell-overlay', { attrs: { 'data-state-key': 'jobs:1:#1a73e8:0' } });
    outer.appendChild(staleOuter);
    inner.appendChild(staleInner);
    outer.appendChild(dom.el(doc, 'button.pt-quick-add-cell'));

    content.__setOverlayState({
      metrics: METRICS,
      stats: { dailyMap: { '2026-09-14': { jobs: 1 } } },
      visible: ['jobs', 'leetcode']
    });
    content.renderBadges();

    assert.strictEqual(overlaysIn(doc).length, 1, 'exactly one overlay survives');
    assert.strictEqual(overlaysIn(doc)[0].parentElement, inner, 'the nested, lower cell wins');
    assert.strictEqual(outer.children.filter(c => c.classList.contains('pt-cell-overlay')).length, 0, 'the outer cell was stripped');
    assert.strictEqual(outer.children.filter(c => c.classList.contains('pt-quick-add-cell')).length, 0, 'the outer quick-add was stripped');
    assert.strictEqual(inner.children.filter(c => c.classList.contains('pt-quick-add-cell')).length, 1);

    // The outer cell must not adopt the inner cell's overlay as its own on a
    // later pass: still one after re-rendering.
    content.renderBadges();
    assert.strictEqual(overlaysIn(doc).length, 1);

    teardown(content);
    console.log('[PASS] Stale duplicate badges are cleaned up, nested same-date cells included');
  }

  // Month view is unaffected: one cell per date renders exactly as before.
  {
    const { doc, content } = loadContentScript();
    const cells = [12, 13, 14].map((d, i) => gridcell(doc, dateKeyFor(2026, 9, d), { height: 120, top: 200, header: String(d) }));
    cells.forEach(c => doc.body.appendChild(c));
    content.__setOverlayState({
      metrics: METRICS,
      stats: { dailyMap: { '2026-09-13': { leetcode: 1 } } },
      visible: ['jobs', 'leetcode']
    });
    content.renderBadges();
    assert.strictEqual(overlaysIn(doc).length, 1);
    assert.strictEqual(overlaysIn(doc)[0].parentElement, cells[1]);
    assert.strictEqual(overlaysIn(doc)[0].style.top, '26px', 'badge sits under the 20px date header');
    assert.strictEqual(cells[0].querySelectorAll('.pt-quick-add-cell').length, 1, 'empty days still get a quick-add button');
    assert.strictEqual(cells[0].querySelectorAll('.pt-cell-overlay').length, 0, 'empty days get no overlay');

    // Hiding a tracker removes its badge on the next render.
    content.__setOverlayState({ visible: ['jobs'] });
    content.renderBadges();
    assert.strictEqual(overlaysIn(doc).length, 0, 'a hidden tracker leaves no overlay behind');

    teardown(content);
    console.log('[PASS] Month view: single cells render one badge, empty days only a quick-add');
  }

  console.log('--- test/calendar.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
