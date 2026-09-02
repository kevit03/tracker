# Original User Request

## 2026-09-02T19:54:20Z

Test and validate the Google Calendar Job & Activity Tracker extension to ensure all core workflows make sense, function seamlessly in real time with Google Account authentication, and adhere to strict user constraints. Automatically fix any issues found.

Working directory: /Users/kevintang/Downloads/job-tracker
Integrity mode: development

## Requirements

### R1. Comprehensive Add and Delete Functionality
Verify and ensure complete add and delete capabilities for all trackers (Job Applications, LeetCode, and custom trackers):
- Instant +1 increment and -1 undo for both Jobs and LeetCode from popup and floating dock.
- Detailed date-specific entry logging and entry deletion from within the calendar day modal.
- Ability to delete custom user-created trackers directly from the calendar interface without breaking default trackers or corrupting historical logs.
- Clean handling of edge cases (e.g., undoing when count is 0, deleting non-existent entries, handling multiple entries on the same day).

### R2. Real-Time Google Calendar Synchronization
Ensure that logging or deleting an entry (whether initiated from the extension popup, in-calendar dock, or day modal) updates the visual overlay badge on the corresponding day cell in Google Calendar immediately without requiring a page refresh or losing user state.

### R3. Strict Zero-Emoji Compliance
Enforce an absolute zero-emoji policy across the entire project:
- No emojis in any HTML, CSS, JS source code, or JSON configuration.
- No emojis in storage defaults, badge labels, dock buttons, or modal dialogues.
- Badges and UI elements should use clean text, SVG/CSS indicators, or colored pill tags only.

### R4. Google Account Authentication & Data Isolation
Verify the Google Account authentication integration:
- Sign In with Google and Sign Out flows available in both the popup and in-calendar dock.
- User email and initials badge displayed cleanly when authenticated.
- Logs and metrics are scoped to the authenticated user account so multiple Google accounts on the same browser maintain isolated application counts.

### R5. Automated Verification Suite
Construct and run an automated test suite verifying:
- `TrackerStorage` CRUD operations, streak calculations, date math, and storage change listeners.
- `TrackerAuth` session management and user-scoped data filtering.
- Real-time event propagation between popup and content scripts.
- Absence of emojis across all project files.
- Manifest V3 validity and required permissions (`storage`, `identity`).

## Acceptance Criteria

### Verification & Automated Testing
- [ ] An automated test script exists and executes with all tests passing (exit code 0).
- [ ] Tests thoroughly exercise: adding logs, deleting logs, undo operations, daily/weekly stats calculation, streak counting across dates, custom tracker creation/deletion, and Google auth scoping.
- [ ] Tests verify that zero emojis exist anywhere in the codebase.

### User Workflows
- [ ] Adding and deleting job applications and LeetCodes updates counts accurately.
- [ ] In Google Calendar, badges on day cells reflect real-time counts for that specific date.
- [ ] Day modal correctly opens, displays date-specific entries, allows deleting individual entries, and allows logging new entries for that date.
- [ ] Sign In with Google links the user account, displays their email, and isolates their entries.
- [ ] Any discovered edge-case bugs or UI inconsistencies are resolved.
