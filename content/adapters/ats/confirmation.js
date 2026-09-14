// Shared factory for ATS "application submitted" adapters.
//
// Every applicant tracking system ends an application the same way: a
// confirmation URL, a confirmation element, or a "thank you for applying"
// heading rendered in place. A concrete adapter only declares which of those
// it uses and how to read the company and role; this file owns detection.
//
// Two detection paths, with different trust:
//   URL        The page loaded at a confirmation URL (Greenhouse /confirmation,
//              Lever /thanks). Logged on mount; the dedupe cache absorbs a
//              refresh.
//   In place   A confirmation element or heading appears after the user
//              interacted (a form submit or a button click armed the
//              adapter). An element that is already present on mount without
//              a confirmation URL is ignored, so reloading a tab that still
//              shows an old confirmation screen cannot log twice.
const AutoTrackerATS = (() => {
  if (typeof AutoTrackerCore === 'undefined') return null;
  const core = AutoTrackerCore;

  const ARM_WINDOW_MS = 5 * 60 * 1000;
  const CANDIDATE_SELECTOR = 'h1, h2, h3, [role="alert"], [role="status"], [class*="confirm"], [class*="success"], [class*="thank"], [class*="submitted"], [data-automation-id]';
  const INTERACTION_SELECTOR = 'button, [role="button"], input[type="submit"], a[class*="submit"]';
  const DEFAULT_TEXT = /thank you for (applying|your application|submitting)|application (has been |was )?(submitted|received|complete)|successfully (submitted|applied)/i;
  const GENERIC_HEADING = /^(thank you|thanks|application (submitted|received|complete)|success|congratulations)/i;

  // "Role at Company", "Role @ Company", "Company - Role", "Role | Company".
  // Returns whatever it can; callers fall back per field.
  function parseTitle(title, options = {}) {
    const raw = String(title || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { role: '', company: '' };
    const cleaned = raw.replace(/^job application for\s+/i, '').replace(/\s*[-|]\s*(careers?|jobs?|job board|apply)\s*$/i, '');
    const company = v => v.trim().replace(/\s+(careers?|jobs?|job board)$/i, '');
    let m = cleaned.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (m) return { role: m[1].trim(), company: company(m[2]) };
    m = cleaned.match(/^(.+?)\s+[-|]\s+(.+)$/);
    if (m) {
      return options.companyFirst
        ? { company: company(m[1]), role: m[2].trim() }
        : { role: m[1].trim(), company: company(m[2]) };
    }
    return { role: cleaned, company: '' };
  }

  function firstText(doc, selectors) {
    for (const sel of [].concat(selectors || [])) {
      const el = doc.querySelector(sel);
      const text = core.textOf(el);
      if (text && !GENERIC_HEADING.test(text)) return text.slice(0, 160);
    }
    return '';
  }

  function isInteraction(event) {
    const t = event && event.target;
    if (!t) return false;
    if (event.type === 'submit') return true;
    return typeof t.closest === 'function' && !!t.closest(INTERACTION_SELECTOR);
  }

  function createConfirmationAdapter(spec) {
    const confirmation = spec.confirmation || {};
    const urlRe = confirmation.url || null;
    const selectors = confirmation.selectors || '';
    const textRe = confirmation.text || DEFAULT_TEXT;
    const watchSelector = [selectors, CANDIDATE_SELECTOR].filter(Boolean).join(', ');

    function matchesSelectors(node) {
      return !!selectors && typeof node.matches === 'function' && node.matches(selectors);
    }

    function isConfirmed(text, node) {
      if (matchesSelectors(node)) return true;
      return textRe.test(text);
    }

    function buildPayload(url, doc) {
      const company = String(spec.company(url, doc) || '').trim();
      const role = String(spec.role(url, doc) || '').trim();
      const id = spec.itemId ? spec.itemId(url, doc) : '';
      return {
        id: id || core.slugify(`${company} ${role}`) || url.pathname,
        title: [role, company].filter(Boolean).join(' at ') || core.humanizeSlug(spec.id),
        company,
        role
      };
    }

    function init(onSuccess, ctx) {
      const doc = ctx.document;
      const root = doc.body || doc.documentElement;
      const cleanup = core.createCleanup();
      let armedAt = 0;
      let fired = false;

      const fire = () => {
        if (fired) return;
        fired = true;
        cleanup();
        onSuccess(buildPayload(ctx.url, doc));
      };

      if (urlRe && urlRe.test(ctx.url.pathname + ctx.url.search)) {
        fire();
        return cleanup;
      }

      cleanup.add(core.listen(root, 'submit', event => { if (isInteraction(event)) armedAt = core.nowMs(); }));
      cleanup.add(core.listen(root, 'click', event => { if (isInteraction(event)) armedAt = core.nowMs(); }));
      const isArmed = () => armedAt > 0 && core.nowMs() - armedAt <= ARM_WINDOW_MS;
      // maxTracked 0: confirmations arrive as new nodes, and Workday stamps
      // data-automation-id on nearly everything, so per-node observers would
      // be pure overhead here.
      cleanup.add(core.waitForText(watchSelector, {
        root,
        maxTracked: 0,
        test: (text, node) => isArmed() && isConfirmed(text, node),
        onMatch: fire
      }));
      return cleanup;
    }

    return {
      id: spec.id,
      label: spec.label || spec.id,
      metricId: 'jobs',
      matches: url => spec.hosts.test(url.hostname) && (!spec.paths || spec.paths.test(url.pathname)),
      // Pathname is the route key on purpose: an SPA that pushes /confirmation
      // remounts and takes the definitive URL path instead of relying on text.
      routeKey: spec.routeKey || (url => url.pathname),
      init,
      _internals: { buildPayload, isConfirmed, ARM_WINDOW_MS }
    };
  }

  return {
    createConfirmationAdapter,
    parseTitle,
    firstText,
    isInteraction,
    ARM_WINDOW_MS,
    DEFAULT_TEXT
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutoTrackerATS;
}
