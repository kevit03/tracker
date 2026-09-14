// Workday: <tenant>.myworkdayjobs.com and <tenant>.myworkdaysite.com. The
// submitted banner is rendered in place at the end of the multi-step form.
(() => {
  if (typeof AutoTrackerATS === 'undefined' || !AutoTrackerATS) return;
  const ats = AutoTrackerATS;

  const company = (url, doc) => {
    const fromDom = ats.firstText(doc, ['[data-automation-id="companyName"]', '[data-automation-id="header"] img[alt]']);
    if (fromDom) return fromDom;
    const fromTitle = ats.parseTitle(doc.title).company;
    if (fromTitle) return fromTitle;
    return AutoTrackerCore.humanizeSlug(url.hostname.split('.')[0]);
  };

  const role = (url, doc) =>
    ats.firstText(doc, ['[data-automation-id="jobPostingHeader"]', 'h1', 'h2']) || ats.parseTitle(doc.title).role;

  AutoTrackerCore.registerAdapter(ats.createConfirmationAdapter({
    id: 'workday',
    label: 'Workday',
    hosts: /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/,
    confirmation: {
      selectors: '[data-automation-id*="applicationSubmitted"], [data-automation-id*="successMessage"], [data-automation-id="applyFlowCompleted"]',
      text: /application (has been |was )?(submitted|received)|thank you for applying|successfully (submitted|applied)/i
    },
    itemId: url => { const m = url.pathname.match(/\/job\/[^/]+\/([^/?#]+)/i); return m ? 'job-' + m[1] : ''; },
    company,
    role
  }));
})();
