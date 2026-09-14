// Auto-tracker content script entry point.
//
// Runs on every site that has an adapter registered (see manifest.json; each
// site group loads only its own adapter files ahead of this script). All this
// file does is pick the adapter for the current URL, mount it, and remount on
// SPA navigation. Detection logic lives in the adapters; dedupe, toasts, and
// storage live in shared/auto-tracker-core.js.
//
// A mount is keyed by (adapter.id, adapter.routeKey(url)). A URL change that
// keeps the same key (LeetCode pushing /submissions/<id> after a submit, an
// ATS appending a query string) is ignored so an armed observer survives it.
(() => {
  if (typeof AutoTrackerCore === 'undefined') return;
  const core = AutoTrackerCore;

  // Guard against a double injection (extension reload while the tab is open).
  if (window.__ptAutoTrackerMounted) return;
  window.__ptAutoTrackerMounted = true;

  let active = null; // { adapter, key, teardown }

  function unmount() {
    if (!active) return;
    const current = active;
    active = null;
    try {
      current.teardown();
    } catch (e) {
      // A throwing teardown must not stop the next adapter from mounting.
    }
  }

  function mount(href) {
    const adapter = core.getActiveAdapter(href);
    const key = adapter ? core.routeKeyFor(adapter, href) : '';
    if (active && adapter && active.adapter === adapter && active.key === key) return;
    unmount();
    if (!adapter) return;

    let mountedTeardown = null;
    let done = false;
    const onSuccess = payload => {
      if (done) return;
      // Dispatch is serialized and idempotent per dedupe key; the adapter
      // may keep detecting, the core decides what actually gets logged.
      core.dispatch(adapter, payload).catch(() => {});
    };
    const ctx = {
      url: new URL(href),
      document,
      window,
      core
    };
    try {
      mountedTeardown = adapter.init(onSuccess, ctx);
    } catch (e) {
      mountedTeardown = null;
    }
    active = {
      adapter,
      key,
      teardown: () => {
        done = true;
        if (typeof mountedTeardown === 'function') mountedTeardown();
      }
    };
  }

  let stopUrlWatch = null;

  function start() {
    if (stopUrlWatch) return;
    mount(location.href);
    stopUrlWatch = core.watchUrl(href => mount(href));
  }

  function stop() {
    unmount();
    if (stopUrlWatch) stopUrlWatch();
    stopUrlWatch = null;
  }

  start();

  // Do not leave observers attached to a document that is going away, and
  // re-arm when the back/forward cache hands the same document back.
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => {
    if (event.persisted) start();
  });
})();
