# Automated Verification Suite & Test Readiness

This document describes the automated test suite for the Google Calendar Job & Activity Tracker Chrome extension.

## Test Architecture Overview

The test architecture provides 100% deterministic, in-memory testing for all Chrome Extension Manifest V3 APIs without relying on external browser drivers or mock facades.

### Test Directory Structure (`test/`)

- `test/mock_chrome.js`: In-memory implementation of Chrome extension APIs (`chrome.storage.local`, `chrome.storage.onChanged`, `chrome.identity`, `chrome.runtime`).
- `test/storage.test.js`: Storage CRUD operations, LIFO tie-breaking for same-timestamp logs, daily streak calculations, DST/noon leap year date math, and storage corruption resilience.
- `test/metrics.test.js`: Custom tracker creation, default metrics protection (`jobs`, `leetcode`), and historical log retention upon custom tracker deletion.
- `test/auth.test.js`: Google OAuth2 identity flow, direct email sign-in, email normalization, session management, token eviction, and auth change events.
- `test/isolation.test.js`: Multi-account data isolation (User A vs User B vs Anonymous), cross-account mutation prevention (delete/undo/tracker tampering rejection).
- `test/events.test.js`: Real-time storage change events, cross-tab and simultaneous popup/calendar overlay dock synchronization.
- `test/emoji.test.js`: Repository-wide Unicode and regex scanner asserting 0 emojis across all project files.
- `test/manifest.test.js`: Manifest V3 schema and permission validation (`storage`, `identity`, host permissions, content script paths).
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
