# Automated Verification Suite & Test Readiness

This document describes the automated test suite for the Google Calendar Job & Activity Tracker Chrome extension.

## Test Architecture Overview

The test architecture provides 100% deterministic, in-memory testing for all Chrome Extension Manifest V3 APIs without relying on external browser drivers or mock facades.

### Test Directory Structure (`test/`)

- `test/mock_chrome.js`: In-memory implementation of Chrome extension APIs (`chrome.storage.local`, `chrome.storage.sync` with real 8KB-per-item/100KB-total quota enforcement, `chrome.storage.onChanged`, `chrome.identity`, `chrome.runtime`).
- `test/storage.test.js`: Storage CRUD operations, LIFO tie-breaking for same-timestamp logs, daily streak calculations, DST/noon leap year date math, storage corruption resilience, and cross-device sync overflow (logs past the `chrome.storage.sync` quota falling back to local without loss, then self-healing once trimmed).
- `test/metrics.test.js`: Custom tracker creation, default metrics protection (`jobs`, `leetcode`), and historical log retention upon custom tracker deletion.
- `test/auth.test.js`: Google OAuth2 identity flow, direct email sign-in, email normalization, session management, token eviction, and auth change events.
- `test/isolation.test.js`: Multi-account data isolation (User A vs User B vs Anonymous), cross-account mutation prevention (delete/undo/tracker tampering rejection).
- `test/events.test.js`: Real-time storage change events, cross-tab and simultaneous popup/calendar overlay synchronization.
- `test/mock_dom.js`: In-memory DOM (selector engine subset, bubbling events, shadow roots) with an instrumented `MutationObserver` so leaked observers are countable.
- `test/autotracker.test.js`: Auto-tracker registry and URL matching for all six adapters, dedupe TTL/LRU cache with session-storage persistence and local fallback, dispatch into `TrackerStorage.addLog`, closed-shadow toast, LeetCode/NeetCode/ATS detection flows (submit-armed observers, arm windows, in-place text updates), entry-point SPA remounting, and zero-leak teardown.
- `test/widgets.test.js`: Popup widget layout (`shared/widgets.js`): registry and defaults, defensive normalization of stored layouts, add / move / drag-reorder / update / remove with persistence and serialized bursts, fixed default ids that survive a fresh install, singleton enforcement, tracker-binding resolution, and LeetCode-only visibility.
- `test/timer.test.js`: Google Calendar date-key decoding across 1990 through 2100, day-modal HTML escaping, and the popup countdown's hydrate-on-open guard.
- `test/calendar.test.js`: Google Calendar overlay: badges live in a body-level layer and never enter Calendar's cells, one node per date anchored to the column header (Week and Day) or the day cell (Month), positioned from the anchor's rectangle, stale in-cell nodes from older versions swept, data-datekey preferred over child chip labels, empty days keep their quick-add.
- `test/emoji.test.js`: Repository-wide Unicode and regex scanner asserting 0 emojis across all project files.
- `test/manifest.test.js`: Manifest V3 schema and permission validation (`storage`, `identity`, host permissions, content script paths, auto-tracker load order and match patterns).
- `test/run_all.js`: Unified CLI test runner executing all suites, summarizing pass/fail counts, and exiting with code 0 on complete success.

### Additional Adversarial Test Suites (`tests/`)

- `tests/adversarial_storage_test.js`: Comprehensive adversarial stress suite covering mutex write concurrency, LIFO tie-breakers, boundary conditions, and corrupt data recovery.
- `tests/adversarial_stress_test.js`: Multi-user session transition attacks, cross-account mutation attacks, default metric protection, and live broadcasting verification.

---

## How to Run Tests

Execute the following commands from the project root:

```bash
# Run the main automated test suite
node test/run_all.js

# Run the individual test suites
node test/storage.test.js
node test/metrics.test.js
node test/auth.test.js
node test/isolation.test.js
node test/events.test.js
node test/emoji.test.js
node test/manifest.test.js

# Run the adversarial stress suites
node tests/adversarial_storage_test.js
node tests/adversarial_stress_test.js
```

---

## Compliance Guarantees

1. **Zero Emojis**: Absolute zero-emoji policy enforced across all source files, markup, stylesheets, test suites, and documentation.
2. **Authentic Business Logic**: All tests execute real, non-mocked business logic in `shared/storage.js` and `shared/auth.js`.
3. **Data Isolation**: Multi-account scoping strictly enforces that users only access and modify their own entries.
4. **Resilience**: Promise mutex write serialization prevents race conditions under high-concurrency loads.
