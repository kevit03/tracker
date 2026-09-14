// LeetCode adapter: logs a `leetcode` entry when a submission is Accepted.
//
// Detection is armed by a submit action, not by the page state. Clicking
// Submit (or Ctrl/Cmd+Enter) starts a scoped observer that looks only at
// nodes added afterwards for the result panel; the observer disconnects on
// the first verdict, or when the arm window lapses. Nothing is observed while
// the user is just editing, and opening an old Accepted submission from the
// Submissions tab never counts because no submit preceded it.
(() => {
  if (typeof AutoTrackerCore === 'undefined') return;
  const core = AutoTrackerCore;

  const RESULT_LOCATOR = '[data-e2e-locator="submission-result"]';
  // .text-green-s is the legacy verdict style. It is also used for Accepted
  // rows in the Submissions list, so a legacy hit inside a row is ignored.
  const RESULT_SELECTOR = RESULT_LOCATOR + ', .text-green-s';
  const LIST_CONTEXT_SELECTOR = 'tr, li, table, a';
  const SUBMIT_SELECTOR = '[data-e2e-locator="console-submit-button"], button[data-e2e-locator*="submit"]';
  const TITLE_SELECTOR = '[data-cy="question-title"], .text-title-large a[href*="/problems/"], a[href*="/problems/"].no-underline';
  const DIFFICULTY_SELECTOR = '[class*="text-difficulty-"], [diff]';
  const LANGUAGE_SELECTOR = '[data-e2e-locator="submission-language"], button[aria-haspopup="dialog"] .text-label-2, .text-label-2.text-sm';
  const RUNTIME_SELECTOR = '[data-e2e-locator="submission-runtime"]';

  // Time after a submit action in which a verdict is trusted. Long enough for
  // LeetCode's judge on a slow day; short enough that a stale panel from an
  // unrelated action cannot be attributed to this submit.
  const ARM_WINDOW_MS = 120 * 1000;

  const ACCEPTED = /\bAccepted\b/;
  const VERDICT = /\b(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compile Error|Output Limit Exceeded|Internal Error)\b/;

  function slugFrom(url) {
    const m = url.pathname.match(/^\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  function readTitle(doc, slug) {
    const el = doc.querySelector(TITLE_SELECTOR);
    let text = core.textOf(el);
    // Strip the leading "1. " numbering LeetCode prefixes titles with.
    text = text.replace(/^\d+\.\s*/, '');
    if (!text && doc.title) {
      text = String(doc.title).replace(/\s*-\s*LeetCode.*$/i, '').replace(/^\d+\.\s*/, '').trim();
    }
    return text || core.humanizeSlug(slug);
  }

  function readDifficulty(doc) {
    const el = doc.querySelector(DIFFICULTY_SELECTOR);
    const text = core.textOf(el);
    const m = text.match(/\b(Easy|Medium|Hard)\b/i);
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : '';
  }

  function readLanguage(doc) {
    return core.textOf(doc.querySelector(LANGUAGE_SELECTOR)).slice(0, 40);
  }

  function readRuntime(doc, resultNode) {
    const explicit = doc.querySelector(RUNTIME_SELECTOR);
    if (explicit) return core.textOf(explicit).slice(0, 40);
    // The new UI renders runtime as a sibling stat of the verdict: "Runtime 52 ms".
    const scope = resultNode && resultNode.closest ? resultNode.closest('[class*="result"], section, div') : null;
    const text = core.textOf(scope);
    const m = text.match(/Runtime\s*:?\s*(\d+(?:\.\d+)?\s*ms)/i);
    return m ? m[1].replace(/\s+/g, ' ') : '';
  }

  function isSubmitAction(event) {
    const target = event && event.target;
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest(SUBMIT_SELECTOR);
  }

  function isSubmitShortcut(event) {
    return !!event && (event.metaKey || event.ctrlKey) && (event.key === 'Enter' || event.keyCode === 13);
  }

  function init(onSuccess, ctx) {
    const doc = ctx.document;
    const root = doc.body || doc.documentElement;
    const slug = slugFrom(ctx.url);
    const cleanup = core.createCleanup();
    if (!slug) return cleanup;

    let stopWatch = null;
    let armedAt = 0;

    function disarm() {
      if (stopWatch) stopWatch();
      stopWatch = null;
      armedAt = 0;
    }

    function isVerdictNode(node) {
      if (typeof node.matches === 'function' && node.matches(RESULT_LOCATOR)) return true;
      return !(typeof node.closest === 'function' && node.closest(LIST_CONTEXT_SELECTOR));
    }

    function onVerdict(node, text) {
      if (ACCEPTED.test(text) && core.nowMs() - armedAt <= ARM_WINDOW_MS) {
        onSuccess({
          id: slug,
          title: readTitle(doc, slug),
          meta: {
            difficulty: readDifficulty(doc),
            language: readLanguage(doc),
            runtime: readRuntime(doc, node)
          }
        });
      }
      disarm();
    }

    function arm() {
      disarm();
      armedAt = core.nowMs();
      // Keeps watching through "Pending" renders until a real verdict lands.
      stopWatch = core.waitForText(RESULT_SELECTOR, {
        root,
        filter: isVerdictNode,
        test: text => VERDICT.test(text),
        onMatch: onVerdict
      });
    }

    cleanup.add(core.listen(root, 'click', event => {
      if (isSubmitAction(event)) arm();
    }));
    cleanup.add(core.listen(root, 'keydown', event => {
      if (isSubmitShortcut(event)) arm();
    }));
    cleanup.add(disarm);
    return cleanup;
  }

  core.registerAdapter({
    id: 'leetcode',
    label: 'LeetCode',
    metricId: 'leetcode',
    matches: url => /(^|\.)leetcode\.(com|cn)$/.test(url.hostname) && /^\/problems\/[^/]+/.test(url.pathname),
    routeKey: url => 'leetcode:' + (slugFrom(url) || url.pathname),
    init,
    // Exposed for tests.
    _internals: { slugFrom, readTitle, readDifficulty, isSubmitAction, isSubmitShortcut, ARM_WINDOW_MS, RESULT_SELECTOR }
  });
})();
