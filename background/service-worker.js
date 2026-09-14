// Background service worker for Job & Activity Tracker.
//
// The solve timers are persisted as a DEADLINE, never as a decrementing
// counter. A counter driven by setInterval dies with its page and is throttled
// to roughly one tick per minute in an unfocused tab; a deadline survives both,
// because every surface derives its remaining time from Date.now() at render.
//
// Timer state contract. One record per surface, written only by that surface:
//
//   chrome.storage.local['pt_timer_popup']   owned by popup/popup.js
//   chrome.storage.local['pt_timer_dock']    owned by content/content.js
//
//   {
//     status: 'idle' | 'running' | 'paused' | 'finished',
//     targetSeconds: integer,      the armed countdown length
//     endsAt: epoch ms | null,     authoritative while status is 'running'
//     remainingSeconds: integer,   authoritative while status is not 'running'
//     finishedAt: epoch ms | null,
//     updatedAt: epoch ms
//   }
//
// The two timers are deliberately independent: they never share a record and
// never sync to each other. This worker does not drive them. It mirrors any
// 'running' record into chrome.alarms so the countdown can still complete with
// every page closed, and writes a record exactly once per countdown, to close
// it out at zero.

const TIMER_SURFACES = {
  pt_timer_popup: { alarm: 'pt-timer-popup', label: 'Popup timer' },
  pt_timer_dock: { alarm: 'pt-timer-dock', label: 'Calendar dock timer' }
};

// Matches MAX_TIMER_SECONDS in shared/storage.js. A free-text field must never
// be able to arm an alarm further out than a day.
const MAX_TIMER_SECONDS = 86400;

function alarmNameFor(key) {
  return TIMER_SURFACES[key] ? TIMER_SURFACES[key].alarm : null;
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) return hrs + 'h ' + mins + 'm';
  if (mins > 0 && secs > 0) return mins + 'm ' + secs + 's';
  if (mins > 0) return mins + 'm';
  return secs + 's';
}

// Tolerates a missing, malformed, or partially written record rather than
// throwing inside an event handler the browser will not retry.
function normalizeTimer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = raw.status;
  if (status !== 'idle' && status !== 'running' && status !== 'paused' && status !== 'finished') {
    return null;
  }
  const target = Math.min(MAX_TIMER_SECONDS, Math.max(0, parseInt(raw.targetSeconds, 10) || 0));
  const remaining = Math.min(MAX_TIMER_SECONDS, Math.max(0, parseInt(raw.remainingSeconds, 10) || 0));
  const endsAt = Number.isFinite(raw.endsAt) ? raw.endsAt : null;
  if (status === 'running' && endsAt === null) return null;
  return {
    status,
    targetSeconds: target,
    endsAt,
    remainingSeconds: remaining,
    finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : null,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  };
}

function readTimer(key) {
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(normalizeTimer(result && result[key]));
    });
  });
}

function writeTimer(key, state) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: state }, () => resolve(!chrome.runtime.lastError));
  });
}

// Mirrors one record into chrome.alarms. Chrome clamps alarm delays, so a
// deadline under the clamp floor is settled immediately instead of scheduled.
async function syncAlarm(key, state) {
  const alarm = alarmNameFor(key);
  if (!alarm) return;

  if (!state || state.status !== 'running') {
    await chrome.alarms.clear(alarm);
    return;
  }

  if (state.endsAt <= Date.now()) {
    await chrome.alarms.clear(alarm);
    await settleTimer(key);
    return;
  }

  // create() replaces an alarm of the same name, so a restart or an edit of a
  // running countdown cannot leave two alarms racing for one surface.
  await chrome.alarms.create(alarm, { when: state.endsAt });
}

function notifyFinished(key, state) {
  if (!chrome.notifications) return;
  const surface = TIMER_SURFACES[key];
  const label = surface ? surface.label : 'Timer';
  const lengthText = state && state.targetSeconds > 0
    ? ' Countdown length was ' + formatDuration(state.targetSeconds) + '.'
    : '';
  chrome.notifications.create(surface ? surface.alarm : key, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: label + ' finished',
    message: 'Your LeetCode countdown reached zero.' + lengthText,
    priority: 2,
    requireInteraction: true
  });
}

// Closes out a countdown whose deadline has passed. Writing 'finished' is
// idempotent: a record already finished is left alone, so a duplicate alarm or
// a startup reconcile cannot fire two notifications for one countdown.
async function settleTimer(key) {
  const state = await readTimer(key);
  if (!state || state.status !== 'running') return;
  if (state.endsAt === null || state.endsAt > Date.now()) return;

  const finished = {
    status: 'finished',
    targetSeconds: state.targetSeconds,
    endsAt: null,
    remainingSeconds: 0,
    finishedAt: state.endsAt,
    updatedAt: Date.now()
  };
  await writeTimer(key, finished);
  notifyFinished(key, state);
}

// Rebuilds alarm state from storage. Alarms do not survive a browser restart,
// so without this a countdown armed before a restart would sit 'running'
// forever and never resolve.
async function reconcileAll() {
  for (const key of Object.keys(TIMER_SURFACES)) {
    const state = await readTimer(key);
    await syncAlarm(key, state);
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  const key = Object.keys(TIMER_SURFACES).find(k => TIMER_SURFACES[k].alarm === alarm.name);
  if (!key) return;
  settleTimer(key);
});

// Surfaces communicate only by writing storage, so this is the single point
// where a start, pause, reset, or edit becomes an alarm.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  Object.keys(TIMER_SURFACES).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
    syncAlarm(key, normalizeTimer(changes[key].newValue));
  });
});

// The auto-tracker's dedupe cache lives in chrome.storage.session so it
// survives page reloads but not a browser restart. Content scripts cannot read
// the session area until the worker opts them in; the cache falls back to
// chrome.storage.local if this has not run yet.
function exposeSessionStorage() {
  if (!chrome.storage || !chrome.storage.session || typeof chrome.storage.session.setAccessLevel !== 'function') return;
  try {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  } catch (e) {
    // Older Chrome without setAccessLevel; the local fallback covers it.
  }
}

chrome.runtime.onStartup.addListener(reconcileAll);
chrome.runtime.onInstalled.addListener(reconcileAll);

// A service worker is torn down when idle and revived by an event. Reconciling
// on every revival keeps alarms correct even if a storage change arrived while
// the worker was asleep.
exposeSessionStorage();
reconcileAll();
