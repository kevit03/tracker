# Locked In Tracker

**Your job hunt and LeetCode grind, painted straight onto Google Calendar.**

A Chrome extension that counts applications sent and problems solved, shows every day's numbers on your calendar, and logs most of it for you automatically. Zero dependencies, zero polling, zero emojis.

```
  ┌───────────────────────────────────────────────────────────────────────┐
  │  leetcode.com   neetcode.io   greenhouse   lever   ashby   workday    │
  │       │              │            └────────┬─┴───────┴───────┘        │
  │   Accepted        Passed /            Application submitted           │
  │                   checkbox                                            │
  └───────┬──────────────┬─────────────────────┬──────────────────────────┘
          └──────────────┴──── adapters ───────┘
                                │
                     auto-tracker core: dedupe, toast
                                │
                        chrome.storage.local  ◄────  popup (+1 / -1, widgets)
                                │
                  Google Calendar overlay: badges, dock, timer
```

There is no build step.

1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick the folder.
3. Pin the extension. Open Google Calendar, LeetCode, or any supported job board and go.

Google sign-in needs an OAuth client in `manifest.json`; without one, the popup offers a direct email sign-in so you can still keep accounts separate.

## The popup

The counter card at the top is fixed: big number, `+1`, `-1`. Everything under it is a **widget layout** you control.

| Widget | What it shows |
| --- | --- |
| Daily Goal | Progress bar toward the tracker's goal; select the number to change it |
| Week / Month / Total | Rolling counts |
| Activity Chart | 7, 14, or 30 days of bars with total, average, active days, best day |
| Streak | Current and longest run of consecutive days |
| Solve Timer | Countdown for a problem (LeetCode tracker only) |
| Solve Time Stats | Today, all time, average, fastest |
| Add Details | Company, role, and notes for the next entry |

The centered **+** adds a widget. Hover one and a gear appears: pin it to a tracker or let it follow the selected tab, set chart length, move it up or down, remove it. Pin two Activity Charts to two trackers and compare. The layout persists in `chrome.storage.local['pt_widgets']`.

On the LeetCode tab, **Space** starts and pauses the timer when nothing else has focus.

## How it works

### Calendar overlay

`content/content.js` finds day cells on Google Calendar and reconciles badges into them, re-rendering only what changed. Dates come from Calendar's own `data-datekey` attribute, decoded with

```
dateKey = (year - 1970) * 512 + (month - 1) * 32 + day + 32
```

with fallbacks for the other formats Calendar uses across views.

### Auto-tracking

One declarative adapter per site in `content/adapters/`, registered with `shared/auto-tracker-core.js`:

```js
core.registerAdapter({
  id: 'leetcode',
  metricId: 'leetcode',
  matches: url => url.hostname.endsWith('leetcode.com') && /^\/problems\//.test(url.pathname),
  routeKey: url => slugFrom(url),          // remount only when the problem changes
  init(onSuccess, ctx) {                   // arm detection, return teardown
    /* ... */
  }
});
```

Detection is armed by the user's own action (the Submit click, `Ctrl/Cmd+Enter`, a form submit), then a scoped `MutationObserver` inspects only nodes added afterwards and disconnects on the first verdict. No `setInterval` anywhere; a test asserts it. SPA navigation is followed through the Navigation API, `popstate`, and `history` wrappers, and an adapter is remounted only when its route key changes, so LeetCode's post-submit `pushState` does not tear down the observer that is waiting for the verdict.

The four ATS adapters are each about fifteen lines on top of `content/adapters/ats/confirmation.js`, which knows the two ways an application ends: a confirmation URL (`/confirmation`, `/thanks`) or a "thank you for applying" block rendered in place after an interaction. Adding a new job board means writing `hosts`, a confirmation selector or text, and how to read the company and role.

Dedupe keys live in a TTL / LRU cache mirrored to `chrome.storage.session` (with a local fallback), and the toast renders inside a closed Shadow DOM so host page CSS cannot restyle it.

### Timers

Countdowns are stored as a **deadline**, never a ticking counter. Every surface derives remaining time from the clock, and `background/service-worker.js` mirrors a running deadline into `chrome.alarms`, so a countdown finishes and notifies even with every page closed. The popup timer and the calendar dock timer are independent records.

### Storage

`shared/storage.js` wraps `chrome.storage.local` with a write queue and read-back verification, because the popup and the content script each hold their own copy of the module against one shared store and `chrome.storage` has no compare-and-swap. Logs carry the signed-in account so two Google accounts never see each other's data.

## Tech

- Chrome Extensions **Manifest V3**
- Vanilla **ES6+** JavaScript, semantic HTML, hand-written CSS in the Google Sans / Material idiom, light and dark
- `chrome.storage`, `chrome.identity`, `chrome.alarms`, `chrome.notifications`, `chrome.tabs`
- **No runtime dependencies, no bundler, no `node_modules`**

## Tests

```bash
node test/run_all.js
```

Eleven suites run in plain Node against an in-memory Chrome (`test/mock_chrome.js`) and a small DOM with an instrumented `MutationObserver` (`test/mock_dom.js`), so a leaked observer fails a test instead of a user's tab. Coverage includes storage math and concurrency, multi-account isolation, auth, the timer state machine, adapter URL matching and detection flows, the dedupe cache, widget layout rules, Manifest V3 validation, and a repository-wide emoji scan that must find nothing. See `TEST_READY.md` for the breakdown.

## Layout

```
background/service-worker.js     alarms for countdowns, session-storage access for content scripts
content/content.js               Google Calendar overlay and dock
content/auto-tracker.js          mounts the adapter for the current URL, follows SPA navigation
content/adapters/                leetcode.js, neetcode.js, ats/{confirmation,greenhouse,lever,ashby,workday}.js
popup/                           popup UI and widget rendering
shared/storage.js                logs, metrics, stats, streaks
shared/auth.js                   Google sign-in and per-account scoping
shared/auto-tracker-core.js      adapter registry, dedupe cache, toast, DOM helpers
shared/widgets.js                widget registry and persisted layout
test/                            the suite, plus the Chrome and DOM mocks
```
