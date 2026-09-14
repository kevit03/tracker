// NeetCode adapter: logs a `leetcode` entry for a passed IDE run or a problem
// ticked off on the practice / roadmap lists.
//
// Two triggers, one adapter:
//   IDE      /problems/<slug>  A Submit or Run action arms a scoped observer
//            that waits for the output panel to render a passing verdict.
//   Lists    /practice, /roadmap  A delegated, passive `change` listener on
//            checkboxes. Ticking a box counts; unticking does nothing.
//
// Dedupe scope is shared with LeetCode: NeetCode problems are LeetCode
// problems under the same slug, and the common workflow is to solve on
// LeetCode and tick the box on NeetCode. That must not count twice.
(() => {
  if (typeof AutoTrackerCore === 'undefined') return;
  const core = AutoTrackerCore;

  const SUBMIT_SELECTOR = 'button.submit-btn, button[class*="submit"], button[class*="run"], [data-testid*="submit"]';
  const OUTPUT_SELECTOR = '.output, [class*="output"], [class*="result"], [class*="console"], pre, .test-case-result';
  const CHECKBOX_SELECTOR = 'input[type="checkbox"]';
  const TITLE_SELECTOR = 'h1, .problem-title, [class*="problem-name"], [class*="title"]';
  const ROW_SELECTOR = 'tr, li, [class*="row"], [class*="problem"]';
  const CATEGORY_SELECTOR = 'h1, h2, h3, h4, [class*="pattern-name"], [class*="category"], [class*="modal-title"], .accordion-header, [class*="header"]';

  const ARM_WINDOW_MS = 120 * 1000;
  const PASSED = /\b(all tests? passed|passed|accepted)\b/i;
  const FAILED = /\b(wrong answer|failed|error|time limit)\b/i;

  function slugFrom(url) {
    const m = url.pathname.match(/^\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  function isListPage(url) {
    return /^\/(practice|roadmap)(\/|$)/.test(url.pathname);
  }

  function readProblemTitle(doc, slug) {
    const el = doc.querySelector(TITLE_SELECTOR);
    const text = core.textOf(el);
    if (text) return text;
    if (doc.title) return String(doc.title).replace(/\s*[-|]\s*NeetCode.*$/i, '').trim() || core.humanizeSlug(slug);
    return core.humanizeSlug(slug);
  }

  // Category is whatever heading sits closest above the row: the pattern
  // modal title on the roadmap, the accordion header on the practice list.
  function readCategory(row) {
    let node = row;
    while (node && node.parentElement) {
      const parent = node.parentElement;
      const heading = typeof parent.querySelector === 'function' ? parent.querySelector(CATEGORY_SELECTOR) : null;
      if (heading && heading !== row && !(row.contains && row.contains(heading))) {
        const text = core.textOf(heading);
        if (text && text.length <= 60) return text;
      }
      node = parent;
    }
    return '';
  }

  function payloadFromRow(row) {
    if (!row) return null;
    const link = typeof row.querySelector === 'function' ? row.querySelector('a[href*="/problems/"], a') : null;
    const title = core.textOf(link) || core.textOf(row).split(/\s{2,}|\n/)[0];
    if (!title) return null;
    let id = null;
    const href = link && link.getAttribute ? link.getAttribute('href') : (link && link.href);
    if (href) {
      const m = String(href).match(/\/problems\/([^/?#]+)/);
      if (m) id = m[1];
    }
    return {
      id: id || core.slugify(title),
      title: title.replace(/^\d+\.\s*/, '').slice(0, 120),
      meta: { category: readCategory(row) }
    };
  }

  function initIde(onSuccess, ctx, cleanup) {
    const doc = ctx.document;
    const root = doc.body || doc.documentElement;
    const slug = slugFrom(ctx.url);
    let stopWatch = null;
    let armedAt = 0;

    function disarm() {
      if (stopWatch) stopWatch();
      stopWatch = null;
      armedAt = 0;
    }

    function onOutput(node, text) {
      if (PASSED.test(text) && !FAILED.test(text) && core.nowMs() - armedAt <= ARM_WINDOW_MS) {
        onSuccess({ id: slug, title: readProblemTitle(doc, slug), meta: { category: '' } });
      }
      disarm();
    }

    function arm() {
      disarm();
      armedAt = core.nowMs();
      stopWatch = core.waitForText(OUTPUT_SELECTOR, {
        root,
        test: text => PASSED.test(text) || FAILED.test(text),
        onMatch: onOutput
      });
    }

    cleanup.add(core.listen(root, 'click', event => {
      const t = event.target;
      if (t && typeof t.closest === 'function' && t.closest(SUBMIT_SELECTOR)) arm();
    }));
    cleanup.add(core.listen(root, 'keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') arm();
    }));
    cleanup.add(disarm);
  }

  function initList(onSuccess, ctx, cleanup) {
    const doc = ctx.document;
    const root = doc.body || doc.documentElement;
    cleanup.add(core.listen(root, 'change', event => {
      const box = event.target;
      if (!box || typeof box.matches !== 'function' || !box.matches(CHECKBOX_SELECTOR)) return;
      if (!box.checked) return;
      const row = typeof box.closest === 'function' ? box.closest(ROW_SELECTOR) : null;
      const payload = payloadFromRow(row);
      if (payload) onSuccess(payload);
    }));
  }

  function init(onSuccess, ctx) {
    const cleanup = core.createCleanup();
    if (slugFrom(ctx.url)) initIde(onSuccess, ctx, cleanup);
    else initList(onSuccess, ctx, cleanup);
    return cleanup;
  }

  core.registerAdapter({
    id: 'neetcode',
    label: 'NeetCode',
    metricId: 'leetcode',
    dedupeScope: 'leetcode',
    matches: url => /(^|\.)neetcode\.io$/.test(url.hostname) && (!!slugFrom(url) || isListPage(url)),
    routeKey: url => 'neetcode:' + (slugFrom(url) || url.pathname.split('/')[1] || ''),
    init,
    _internals: { slugFrom, isListPage, payloadFromRow, readCategory, ARM_WINDOW_MS }
  });
})();
