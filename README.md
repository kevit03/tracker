# Locked in Tracker 
Job & Activity Tracker for Google Calendar

## Tech Stack

A Google Chrome extension to track daily job applications, LeetCode problems, and custom goals in real time. It's pretty cool. 

---

## Tech Stack

### Platform & Core
- **Platform**: Google Chrome Extensions (Manifest V3)
- **Frontend Core**: Vanilla JavaScript (Modern ES6+), Semantic HTML5
- **Styling**: pure CSS3 following Google's Material / Google Sans design language
- **External Dependencies**: nada (0 runtime dependencies, no bundlers or node_modules required for execution)

### Browser & Chrome Extension APIs
- **chrome.storage.local**: local storage hardenedo prevent lost updates under concurrent operations
- **chrome.identity**: Google Account OAuth2 integration with Google UserInfo API
- **chrome.tabs & chrome.runtime**: better synchronization 
- **chrome.action**: logging entries from any active tab 

### Calendar Overlay Engine
- **DOM Reconciliation**:
- **Google Calendar Date Decoding**: 
  `(year - 1970) * 512 + (month - 1) * 32 + day + 32`
- **Multi-Format Date Extraction** 
- **Layer Stacking & Positioning**

### Auto-Tracking Engine
- **Plugin adapters**: one declarative `PlatformAdapter` per site (`content/adapters/`), registered with `shared/auto-tracker-core.js`. A new platform is a `matches(url)` plus an `init(onSuccess)` that returns its own teardown; ATS adapters are ~15 lines on top of `adapters/ats/confirmation.js`.
- **Supported today**: LeetCode (Accepted submission), NeetCode (IDE pass, roadmap/practice checkbox), Greenhouse, Lever, Ashby, Workday (application confirmation).
- **Zero polling**: no `setInterval`. Detection is armed by the user's own submit action, then a scoped `MutationObserver` watches only nodes added afterwards and disconnects on the first verdict. SPA navigation is tracked through the Navigation API, `popstate`, and `history` wrappers; adapters are remounted only when their route key changes.
- **Deduplication**: `<platform>:<slug>:<YYYY-MM-DD>` keys in a TTL/LRU cache mirrored to `chrome.storage.session` (local fallback), so refreshes, re-submits, and sibling tabs cannot double count. NeetCode shares LeetCode's namespace, so ticking a problem you already solved on LeetCode does not count twice.
- **Toast**: `PulseTracker: Logged Two Sum (+1)` rendered inside a closed Shadow DOM so host page CSS cannot touch it.

### Automated Testing & Verification
- **Test Runner**: Native Node.js test framework (`node test/run_all.js`)
- **In-Memory Harness**: Fully custom mock environment (`test/mock_chrome.js`) simulating Chrome Manifest V3 APIs without requiring heavy browser binaries
