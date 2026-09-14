// Lever: jobs.lever.co/<company>/<posting-id>. Submitting lands on /thanks.
(() => {
  if (typeof AutoTrackerATS === 'undefined' || !AutoTrackerATS) return;
  const ats = AutoTrackerATS;

  const company = (url, doc) => {
    const slug = url.pathname.split('/').filter(Boolean)[0];
    return (slug && AutoTrackerCore.humanizeSlug(slug)) || ats.parseTitle(doc.title, { companyFirst: true }).company;
  };

  const role = (url, doc) =>
    ats.firstText(doc, ['.posting-headline h2', '.posting-header h2', 'h2', 'h1']) || ats.parseTitle(doc.title, { companyFirst: true }).role;

  AutoTrackerCore.registerAdapter(ats.createConfirmationAdapter({
    id: 'lever',
    label: 'Lever',
    hosts: /^jobs(\.eu)?\.lever\.co$/,
    confirmation: { url: /\/thanks(\/|$|\?)/, selectors: '.application-confirmation, [class*="application-confirmation"]' },
    itemId: url => { const m = url.pathname.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})/i); return m ? 'posting-' + m[1] : ''; },
    company,
    role
  }));
})();
