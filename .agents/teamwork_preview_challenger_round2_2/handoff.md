# Challenger 2 (Round 2) Handoff Report: Multi-Account Isolation, Custom Trackers & Storage Events

## 1. Observation

Adversarial stress-testing and empirical verification were conducted against `shared/auth.js`, `shared/storage.js`, `content/content.js`, `popup/popup.js`, and `manifest.json`.

### 1.1 Source Code Inspections
- **`shared/storage.js` Email Normalization (lines 40-44)**:
  ```javascript
  function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const trimmed = email.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }
  ```
- **`shared/storage.js` Account Scoping in `getMetrics` (lines 125-144)**:
  Default metrics (`jobs`, `leetcode`) are always included (`m.isDefault || m.id === 'jobs' || m.id === 'leetcode'`), whereas custom metrics require `owner === targetEmail` (or `!owner` when unauthenticated).
- **`shared/storage.js` Default Metrics Deletion Protection in `deleteMetric` (lines 191-193 & 205-208)**:
  ```javascript
  if (!id || id === 'jobs' || id === 'leetcode') {
    return false;
  }
  ```
  ```javascript
  if (target.isDefault || target.id === 'jobs' || target.id === 'leetcode') {
    resolve(false);
    return;
  }
  ```
- **`shared/storage.js` Authorization Check in `deleteLog` (lines 323-330)**:
  ```javascript
  const log = logs[targetIndex];
  const logEmail = normalizeEmail(log.userEmail);
  const isAuthorized = (!targetEmail && !logEmail) || (targetEmail && logEmail === targetEmail);
  if (!isAuthorized) {
    resolve(false);
    return;
  }
  ```
- **`shared/storage.js` Event Broadcasting Listener (lines 456-464)**:
  ```javascript
  onChanged(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.logs || changes.metrics || changes.pt_auth_user || changes.pt_visible_metrics)) {
          cb(changes);
        }
      });
    }
  }
  ```
- **`shared/auth.js` Sign-in / Set-user Email Normalization (lines 82-95)**:
  ```javascript
  const user = {
    email: email.toLowerCase(),
    name: email.split('@')[0],
    provider: 'google'
  };
  ```
  ```javascript
  async setUser(user) {
    if (user && user.email) {
      user.email = user.email.toLowerCase().trim();
    }
    // ...
  }
  ```

### 1.2 Test Execution Results
An adversarial test suite comprising 27 targeted test cases was executed via `node tests/adversarial_stress_test.js`:

```
===============================================================
CHALLENGER 2 — ADVERSARIAL EMPIRICAL VERIFICATION SUITE (ROUND 2)
===============================================================

--- Suite 1: Multi-User Isolation & Session Transitions ---
  [PASS] 1.1: Account A logs 5 jobs, logs out -> logged-out view sees 0 logs and 0 stats
  [PASS] 1.2: Account B logs in -> sees 0 logs from Account A
  [PASS] 1.3: Account B logs entries -> strictly isolated from Account A
  [PASS] 1.4: Custom tracker isolation between Account B and Account A
  [PASS] 1.5: Logged-out custom tracker is isolated from authenticated accounts

--- Suite 2: Cross-Account Mutation Attacks ---
  [PASS] 2.1: Cross-account deleteLog attack: Account B cannot delete Account A log
  [PASS] 2.2: Logged-out cross-account deleteLog attack
  [PASS] 2.3: Cross-account undoLastLog attack
  [PASS] 2.4: Cross-account deleteMetric attack: Account B cannot delete Account A custom metric
  [PASS] 2.5: Logged-out deleteMetric attack on authenticated custom metric

--- Suite 3: Default Metrics Protection Attacks ---
  [PASS] 3.1: Attempt to delete default metric "jobs" (logged-out and logged-in)
  [PASS] 3.2: Attempt to delete default metric "leetcode" (logged-out and logged-in)
  [PASS] 3.3: Attempt to delete with falsy/invalid/proto IDs

--- Suite 4: Email Casing & Normalization Invariance ---
  [PASS] 4.1: Normalization function handles all edge cases
  [PASS] 4.2: Auth signIn and setUser automatically lowercases email
  [PASS] 4.3: Logs added with uppercase email are queryable with lowercase and vice versa
  [PASS] 4.4: Custom metrics casing invariance

--- Suite 5: Storage Event Broadcasting & Real-Time Listeners ---
  [PASS] 5.1: TrackerStorage.onChanged triggers on log addition
  [PASS] 5.2: TrackerAuth.onAuthChanged triggers on signIn and signOut
  [PASS] 5.3: Multiple listeners simulate simultaneous popup and content script broadcast
  [PASS] 5.4: Live broadcast does not leak cross-account logs during re-fetch

--- Suite 6: Concurrency & Mutex Queue Stress-Testing ---
  [PASS] 6.1: 40 concurrent addLog operations across 2 users without race condition or lost writes
  [PASS] 6.2: Interleaved concurrent adds, undos, and metric creations

--- Suite 7: Custom Tracker Security, Collision & Isolation ---
  [PASS] 7.1: Custom metric ID collision prevention against default metric names
  [PASS] 7.2: Custom tracker with prototype pollution keys & malicious strings

--- Suite 8: Strict Zero-Emoji Compliance & Manifest Validation ---
  [PASS] 8.1: Zero-emoji scan across all application source files (content, popup, shared, manifest)
  [PASS] 8.2: Manifest V3 validation

===============================================================
TEST SUMMARY: 27 Total | 27 Passed | 0 Failed
===============================================================
```

Additionally, Challenger 1's adversarial storage test suite (`node tests/adversarial_storage_test.js`) was executed with all 26/26 tests passing (exit code 0).

---

## 2. Logic Chain

1. **Multi-User Isolation**:
   - Observations in Section 1.1 show that `getLogs()` and `getMetrics()` perform strict email scoping against normalized emails. When Account A logs 5 jobs and logs out, `getCurrentUserEmail()` resolves to `null`. Log filtering excludes any log where `logEmail` is non-null (`if (logEmail) return false;`). Account B (`userB@gmail.com`) sees only logs where `logEmail === 'userb@gmail.com'`. Tests 1.1–1.5 empirically verify complete zero-leakage isolation across login, logout, and user switching.
2. **Cross-Account Mutation Defense**:
   - In `deleteLog()` and `deleteMetric()`, `isAuthorized` evaluates whether the caller's normalized email matches the asset owner's normalized email. When Account B attempts to delete Account A's log (`deleteLog(logA_id, 'userB@gmail.com')`) or custom metric (`deleteMetric(metricA_id, 'userB@gmail.com')`), `isAuthorized` evaluates to `false`, the operation returns `false`, and storage is left untouched. Tests 2.1–2.5 empirically confirm that all unauthorized deletions (both logged-out and cross-account) are rejected.
3. **Default Metrics Immunity**:
   - `deleteMetric('jobs')` and `deleteMetric('leetcode')` are guarded by hardcoded early-return checks both at function entry (line 191) and during lookup (line 205). Tests 3.1–3.3 confirm that neither default tracker can be removed by any account or role.
4. **Email Casing Invariance**:
   - `normalizeEmail()` trims whitespace and lowercases strings across all read and write methods. Tests 4.1–4.4 confirm that mixed-case logins, log queries, deletions, and custom metric queries operate identically regardless of casing or whitespace padding (e.g. `User.Name@Gmail.com` vs `user.name@gmail.com`).
5. **Real-Time Storage Event Broadcasting**:
   - `TrackerStorage.onChanged` and `TrackerAuth.onAuthChanged` hook into `chrome.storage.onChanged` to broadcast mutations across multiple subscribers (popup, dock, cell overlays). Tests 5.1–5.4 demonstrate that storage events trigger appropriate UI re-queries without leaking data across sessions.
6. **Zero-Emoji & Manifest V3 Conformance**:
   - Test 8.1 performed an exhaustive unicode regex scan across all source files (`content/`, `popup/`, `shared/`, `manifest.json`), confirming 0 emojis. Test 8.2 verified Manifest V3 compliance with `storage` and `identity` permissions.

---

## 3. Caveats

- Tests were executed within a Node.js simulated Chrome Extension runtime mirroring `chrome.storage.local` and `chrome.identity`. Full native Google OAuth token exchange against live Google endpoints requires registered GCP Client IDs in production deployment, for which the fallback direct Google account email sign-in path is provided and verified.

---

## 4. Conclusion

All requirements regarding Multi-Account Isolation, Custom Trackers, Cross-Account Mutation Defense, Default Metric Protection, Email Casing Invariance, Live Storage Events, and Zero-Emoji Compliance are empirically validated and pass without errors.

**Verdict**: **APPROVE**

---

## 5. Verification Method

To independently verify all findings and test suites, run the following commands in `/Users/kevintang/Downloads/job-tracker`:

```bash
# Run Challenger 2 adversarial test suite (27 tests)
node tests/adversarial_stress_test.js

# Run Challenger 1 adversarial storage test suite (26 tests)
node tests/adversarial_storage_test.js
```

Both commands should complete with exit code 0.
