// Greenhouse: boards.greenhouse.io and job-boards.greenhouse.io (plus the .eu
// variants), including the embedded job_app iframe companies host on their own
// careers pages, which carries the company in ?for=.
(() => {
  if (typeof AutoTrackerATS === 'undefined' || !AutoTrackerATS) return;
  const ats = AutoTrackerATS;

  const company = (url, doc) => {
    const embed = url.searchParams.get('for');
    if (embed) return AutoTrackerCore.humanizeSlug(embed);
    const fromDom = ats.firstText(doc, ['.company-name', '[class*="company-name"]']).replace(/^at\s+/i, '');
    if (fromDom) return fromDom;
    const fromTitle = ats.parseTitle(doc.title).company;
    if (fromTitle) return fromTitle;
    const slug = url.pathname.split('/').filter(Boolean)[0];
    return slug && slug !== 'embed' ? AutoTrackerCore.humanizeSlug(slug) : '';
  };

  const role = (url, doc) =>
    ats.firstText(doc, ['h1.app-title', '.app-title', '.job__title h1', 'h1.section-header', 'h1']) || ats.parseTitle(doc.title).role;

  AutoTrackerCore.registerAdapter(ats.createConfirmationAdapter({
    id: 'greenhouse',
    label: 'Greenhouse',
    hosts: /^(job-)?boards(\.eu)?\.greenhouse\.io$/,
    confirmation: { url: /\/confirmation(\/|$|\?)/, selectors: '#application_confirmation, .application-confirmation' },
    itemId: url => { const m = url.pathname.match(/\/jobs\/(\d+)/); return m ? 'job-' + m[1] : ''; },
    company,
    role
  }));
})();
