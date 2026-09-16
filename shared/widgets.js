// Popup widget layout for Job & Activity Tracker.
//
// The popup below the counter is a list of widgets the user can add, remove,
// reorder, and bind to a tracker. This module owns the registry of widget
// types and the persisted layout; popup/popup.js owns rendering. Nothing here
// touches the DOM, so the layout rules are testable headlessly.
//
// Layout record, chrome.storage.local['pt_widgets']:
//   { version: 1, items: [{ id, type, options }] }
//
// options.metricId is 'active' (follow the selected tab) or a tracker id.
// Singleton types (timer, timeStats, details) wrap markup that exists once in
// popup.html, so the layout holds at most one of each.
const WidgetLayout = (() => {
  const STORAGE_KEY = 'pt_widgets';
  const VERSION = 1;
  const ACTIVE = 'active';
  const ACTIVITY_DAYS = [7, 14, 30];

  const TYPES = {
    goal: {
      name: 'Daily Goal',
      description: 'Progress toward a tracker\'s daily goal.',
      singleton: false,
      defaults: { metricId: ACTIVE }
    },
    summary: {
      name: 'Week / Month / Total',
      description: 'Counts for this week, this month, and all time.',
      singleton: false,
      defaults: { metricId: ACTIVE }
    },
    activity: {
      name: 'Activity Chart',
      description: 'Daily bars for the last 7, 14, or 30 days, with totals.',
      singleton: false,
      defaults: { metricId: ACTIVE, days: 30, showStats: true, collapsed: false }
    },
    streak: {
      name: 'Streak',
      description: 'Current and longest run of days that hit the daily goal.',
      singleton: false,
      defaults: { metricId: ACTIVE }
    },
    timer: {
      name: 'Solve Timer',
      description: 'Countdown for timing a problem. Shows on the LeetCode tracker.',
      singleton: true,
      leetcodeOnly: true,
      defaults: {}
    },
    timeStats: {
      name: 'Solve Time Stats',
      description: 'Today, all-time, average, and fastest solve times.',
      singleton: true,
      leetcodeOnly: true,
      defaults: {}
    },
    details: {
      name: 'Add Details',
      description: 'Company, role, and notes form for the next entry.',
      singleton: true,
      defaults: {}
    }
  };

  // Fixed ids: a fresh install renders these before anything is stored, and
  // an edit made then must still find its widget on the next read.
  const DEFAULT_ITEMS = [
    { id: 'timer-default', type: 'timer' },
    { id: 'timeStats-default', type: 'timeStats' },
    { id: 'goal-default', type: 'goal' },
    { id: 'details-default', type: 'details' },
    { id: 'summary-default', type: 'summary' },
    { id: 'activity-default', type: 'activity' }
  ];

  function newId(type) {
    return type + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return {
      get: (keys, cb) => {
        const result = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (typeof localStorage !== 'undefined') {
            const val = localStorage.getItem(k);
            if (val !== null) {
              try { result[k] = JSON.parse(val); } catch (e) { /* ignore */ }
            }
          }
        });
        cb(result);
      },
      set: (items, cb) => {
        if (typeof localStorage !== 'undefined') {
          Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
        }
        if (cb) cb();
      }
    };
  }

  function normalizeOptions(type, raw) {
    const spec = TYPES[type];
    const out = Object.assign({}, spec.defaults);
    const input = raw && typeof raw === 'object' ? raw : {};
    if ('metricId' in spec.defaults) {
      out.metricId = typeof input.metricId === 'string' && input.metricId ? input.metricId : ACTIVE;
    }
    if (type === 'activity') {
      const days = parseInt(input.days, 10);
      out.days = ACTIVITY_DAYS.includes(days) ? days : spec.defaults.days;
      out.showStats = input.showStats === undefined ? spec.defaults.showStats : !!input.showStats;
      out.collapsed = !!input.collapsed;
    }
    return out;
  }

  // Accepts anything that might be in storage and returns a clean item list:
  // unknown types dropped, duplicate singletons collapsed to the first,
  // missing ids minted, options merged over the type defaults.
  function normalize(raw) {
    const source = raw && Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : null);
    const list = source === null ? DEFAULT_ITEMS : source;
    const seenSingletons = new Set();
    const seenIds = new Set();
    const items = [];
    list.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const type = entry.type;
      const spec = TYPES[type];
      if (!spec) return;
      if (spec.singleton) {
        if (seenSingletons.has(type)) return;
        seenSingletons.add(type);
      }
      let id = typeof entry.id === 'string' && entry.id ? entry.id : newId(type);
      while (seenIds.has(id)) id = newId(type);
      seenIds.add(id);
      items.push({ id, type, options: normalizeOptions(type, entry.options) });
    });
    return items;
  }

  function defaultItems() {
    return normalize(null);
  }

  function readRaw() {
    return new Promise(resolve => {
      getStorageArea().get([STORAGE_KEY], result => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result && result[STORAGE_KEY] !== undefined ? result[STORAGE_KEY] : null);
      });
    });
  }

  function writeRaw(items) {
    return new Promise(resolve => {
      getStorageArea().set({ [STORAGE_KEY]: { version: VERSION, items } }, () => resolve(items));
    });
  }

  // Layout edits are read-modify-write; serialize them so two quick clicks
  // cannot clobber each other.
  let chain = Promise.resolve();
  function mutate(fn) {
    const run = async () => {
      const items = normalize(await readRaw());
      const next = fn(items.map(i => ({ id: i.id, type: i.type, options: Object.assign({}, i.options) })));
      if (!next) return items;
      return writeRaw(normalize(next));
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  function resolveMetricId(item, activeMetricId, metrics) {
    const wanted = item && item.options ? item.options.metricId : ACTIVE;
    if (!wanted || wanted === ACTIVE) return activeMetricId;
    if (Array.isArray(metrics) && !metrics.some(m => m && m.id === wanted)) return activeMetricId;
    return wanted;
  }

  // Timer widgets only make sense for LeetCode solves; hide them elsewhere
  // rather than showing a countdown next to job applications.
  function isVisible(item, resolvedMetricId) {
    const spec = TYPES[item.type];
    if (!spec) return false;
    if (spec.leetcodeOnly) return resolvedMetricId === 'leetcode';
    return true;
  }

  function availableTypes(items) {
    const present = new Set((items || []).map(i => i.type));
    return Object.keys(TYPES).map(type => ({
      type,
      name: TYPES[type].name,
      description: TYPES[type].description,
      singleton: TYPES[type].singleton,
      added: TYPES[type].singleton && present.has(type)
    }));
  }

  return {
    STORAGE_KEY,
    ACTIVE,
    ACTIVITY_DAYS,
    TYPES,
    normalize,
    normalizeOptions,
    defaultItems,
    resolveMetricId,
    isVisible,
    availableTypes,

    // Nothing stored yet means the default layout; persist it so later edits
    // and other contexts all see the same ids.
    async load() {
      const raw = await readRaw();
      if (raw === null) return writeRaw(normalize(null));
      return normalize(raw);
    },

    async reset() {
      return mutate(() => DEFAULT_ITEMS.map(i => ({ id: i.id, type: i.type })));
    },

    async add(type, options) {
      if (!TYPES[type]) throw new Error('Unknown widget type: ' + type);
      return mutate(items => {
        if (TYPES[type].singleton && items.some(i => i.type === type)) return null;
        return items.concat([{ id: newId(type), type, options: normalizeOptions(type, options) }]);
      });
    },

    async remove(id) {
      return mutate(items => items.filter(i => i.id !== id));
    },

    async update(id, patch) {
      return mutate(items => items.map(i => {
        if (i.id !== id) return i;
        const merged = Object.assign({}, i.options, patch && patch.options ? patch.options : patch);
        return { id: i.id, type: i.type, options: normalizeOptions(i.type, merged) };
      }));
    },

    // Drop `id` immediately before `beforeId`, or at the end when beforeId is
    // null. Drag and drop works on the visible widgets only, so callers name
    // a neighbour instead of an index; hidden widgets keep their place.
    async reorder(id, beforeId) {
      return mutate(items => {
        const from = items.findIndex(i => i.id === id);
        if (from < 0 || beforeId === id) return null;
        const rest = items.filter(i => i.id !== id);
        let to = beforeId ? rest.findIndex(i => i.id === beforeId) : rest.length;
        if (to < 0) to = rest.length;
        rest.splice(to, 0, items[from]);
        if (rest.every((i, idx) => i.id === items[idx].id)) return null;
        return rest;
      });
    },

    // delta -1 moves toward the top, +1 toward the bottom; clamped.
    async move(id, delta) {
      return mutate(items => {
        const from = items.findIndex(i => i.id === id);
        if (from < 0) return null;
        const to = Math.max(0, Math.min(items.length - 1, from + (delta < 0 ? -1 : 1)));
        if (to === from) return null;
        const copy = items.slice();
        const [it] = copy.splice(from, 1);
        copy.splice(to, 0, it);
        return copy;
      });
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WidgetLayout;
}
