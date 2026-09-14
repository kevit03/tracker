// Ashby: jobs.ashbyhq.com/<company>/<job-id>/application. The confirmation is
// rendered in place after submit, so detection is the armed in-place path.
(() => {
  if (typeof AutoTrackerATS === 'undefined' || !AutoTrackerATS) return;
  const ats = AutoTrackerATS;

  const company = (url, doc) => {
    const slug = url.pathname.split('/').filter(Boolean)[0];
    return ats.parseTitle(doc.title).company || (slug ? AutoTrackerCore.humanizeSlug(slug) : '');
  };

  const role = (url, doc) =>
    ats.firstText(doc, ['h1[class*="title"]', 'h1', 'h2[class*="title"]']) || ats.parseTitle(doc.title).role;

  AutoTrackerCore.registerAdapter(ats.createConfirmationAdapter({
    id: 'ashby',
    label: 'Ashby',
    hosts: /^jobs\.ashbyhq\.com$/,
    confirmation: { selectors: '[class*="application-form-success"], [class*="ashby-application-form-success"], [class*="_success_"]' },
    itemId: url => { const m = url.pathname.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})/i); return m ? 'job-' + m[1] : ''; },
    company,
    role
  }));
})();
