// TEMPORARY, not part of the extension: a minimal chrome.* shim so popup.html
// can be smoke-tested over plain http outside a real extension context.
// Deleted after manual verification.
(function () {
  function backedArea(prefix) {
    const listeners = [];
    return {
      get(keys, cb) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        keyList.forEach(k => {
          const raw = localStorage.getItem(prefix + k);
          if (raw !== null) {
            try { result[k] = JSON.parse(raw); } catch (e) { /* ignore */ }
          }
        });
        setTimeout(() => cb(result), 0);
      },
      set(items, cb) {
        Object.entries(items).forEach(([k, v]) => localStorage.setItem(prefix + k, JSON.stringify(v)));
        setTimeout(() => { if (cb) cb(); }, 0);
      },
      remove(keys, cb) {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => localStorage.removeItem(prefix + k));
        setTimeout(() => { if (cb) cb(); }, 0);
      },
      QUOTA_BYTES_PER_ITEM: 8192,
      QUOTA_BYTES: 102400
    };
  }
  window.chrome = {
    storage: {
      local: backedArea('shim_local_'),
      sync: backedArea('shim_sync_'),
      onChanged: { addListener() {} }
    },
    runtime: { lastError: null, sendMessage() {}, onMessage: { addListener() {} } },
    tabs: { query(_, cb) { cb([]); }, sendMessage() { return Promise.resolve(); } },
    identity: {},
    alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
    notifications: { create() {} }
  };
})();
