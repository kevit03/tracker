<p align="center"><img src="icons/icon128.png" width="96" alt="Locked In padlock mark"></p>

# Locked In Tracker

A Chrome extension that counts applications sent and problems solved, shows every day's numbers on your calendar, and logs most of it for you automatically. 

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
                  Google Calendar overlay: day badges, quick add
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
| Streak | Current and longest run of days the daily goal was met |
| Solve Timer | Countdown for a problem (LeetCode tracker only) |
| Solve Time Stats | Today, all time, average, fastest |
| Add Details | Company, role, and notes for the next entry |

The centered **+** adds a widget. Hover one and a grip and a gear appear: drag the grip to reorder, or open the gear to pin the widget to a tracker or let it follow the selected tab, set chart length, nudge its position, or remove it. Pin two Activity Charts to two trackers and compare. The layout persists in `chrome.storage.local['pt_widgets']`.

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

### Storage

`shared/storage.js` wraps `chrome.storage.local` with a write queue and read-back verification, because the popup and the content script each hold their own copy of the module against one shared store and `chrome.storage` has no compare-and-swap. Logs carry the signed-in account so two Google accounts never see each other's data.
