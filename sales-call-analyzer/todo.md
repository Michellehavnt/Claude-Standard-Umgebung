# Sales Call Analyzer - TODO List

Last Updated: 2026-01-28

This file lists all remaining tasks planned in prd.md that are NOT yet fully built and tested.

---

## Priority Plan (Audit: 2026-01-26)

### P0 - Core App Functionality
All P0 items are COMPLETE. The app is fully functional end-to-end.

#### P0.1 - Per-call LLM Model Attribution in Call Detail UI - COMPLETE (2026-01-27)

Analysis Details panel added to call.html showing model, tokens, cost, and timestamp for each analysis.

### P1 - High Value Improvements

#### P1.1 - Add Token Usage / Cost Tracking Display - COMPLETE (2026-01-26)

Token tracking implemented in llmService.js with usage display in settings.html.

#### P1.2 - Implement CSV Export (PRD Feature 14) - DEPRIORITIZED (2026-01-27)

Closing Rate CSV export implemented. Copy/Calls list CSV export **deprioritized** per user decision.

**Completed:**
- csvExportService.js with escapeCSVValue(), generateCSV(), generateClosingRateCSV()
- Export CSV button in founder.html (Closing Rate page)
- Frontend-only export (no backend endpoint needed)
- UTF-8 with BOM for Excel compatibility
- 43 unit tests + 4 integration tests

**Deprioritized/Removed from Scope:**
- Copy page CSV export
- Calls list CSV export

#### P1.3 - URL Filter Persistence for All 4 Pages - COMPLETE (2026-01-27)

URL filter persistence implemented for all 4 pages using history.replaceState.

#### P1.4 - Implement Wording + Metaphors Sections Fully - COMPLETE (2026-01-27)

Wording and Metaphors sections fully implemented with heuristic extraction from existing quote data.

#### P1.5 - Fix Closing Rate Status Change Persistence - COMPLETE (2026-01-27)

Fixed status changes (Mark as Signed Up/Active/Churned/Team/No Close) not persisting after clicking.

**Root Cause:** Frontend accessed wrong property names in API responses (`overrides` instead of `data`, etc.)

**Fixed:**
- `founder.html` - Fixed 4 response property references to use `data` key
- Added 3 new persistence tests in `closingRateAdjustmentsRoutes.test.js`
- All 34 closing rate tests pass

#### P1.6 - Changelog Feature - COMPLETE (2026-01-27)

Admin-publishable changelog for product updates visible to all users.

**Implemented:**
- Database: `changelog_entries` table (id, title, summary, details, tag, is_published, show_as_new_until, dates)
- API: GET/POST/PUT/DELETE /api/changelog + publish/unpublish endpoints
- UI: `/admin/changelog.html` with card layout, search, tag filters, admin create/edit form
- Navigation: Added Changelog link in user dropdown (below Settings) across all 10 pages
- Security: XSS sanitization, role-based access control, input validation
- Tests: 20 tests in `changelogRoutes.test.js`

**Files:**
- Created: `routes/changelog.js`, `changelog.html`, `changelogRoutes.test.js`
- Modified: `transcriptDb.js`, `server.js`, all 10 admin HTML files

### P2 - Nice-to-have / Polish

| # | Task | Files | Notes |
|---|------|-------|-------|
| P2.1 | E2E tests with Playwright | `tests/e2e/` | Auth, Sync, Analysis, Export flows |
| P2.2 | "vs last period" stats comparison | `dashboardAggregationService.js`, `dashboard.html` | Show +/-% delta |
| P2.3 | Admin category merge for pain points | `routes/admin.js`, new modal | PRD Feature 5 enhancement |
| P2.4 | Improve Stripe matching - pagination | `stripeEnrichmentService.js` | Domain/name matching limited to 100 customers |
| P2.5 | Improve Stripe matching - metadata | `stripeEnrichmentService.js` | Use metadata fields (website, brand) if stored |
| P2.6 | Manual Stripe matching UI | `admin.html`, routes | Allow admin to manually link prospects to Stripe |
| P2.7 | Calendly enrichment | New service | Link calls to Calendly bookings |
| P2.8 | Slack notification on new signups | `slackIngestionService.js` | Alert when new lifecycle events detected |

---

## Completed Features

### PRD Feature 1: Authentication (Email + Password with Access Request Workflow) - COMPLETE
- Users table (with password_hash), Sessions table, Access requests table (with password_hash)
- Auth service with password-based authentication and access request workflow
- Password hashing with bcrypt (12 rounds), minimum 12 character requirement
- Auth middleware, Auth routes (20+ endpoints including password endpoints)
- Rate limiting middleware (login, access requests)
- Login page UI (tabbed Sign In / Request Access flow)
- Access requests admin page with approve/deny workflow
- User management page with admin password reset functionality
- Domain restriction: @affiliatefinder.ai only
- Session duration: 30 days
- All tests passing (178 tests - 84 unit, 76 integration, 18 middleware)
- **Updated 2026-01-26:** Migrated from Magic Link to Email+Password authentication
  - New endpoints: POST /api/auth/request-access, POST /api/auth/login-password, POST /api/auth/admin/reset-password
  - Password stored at access request time, copied to user on approval
  - Admin-only password reset (no forgot password feature)
  - Legacy magic link endpoints deprecated but retained for backward compatibility
- **Updated 2026-01-26:** Added User Menu and Role-Based Access Control
  - User menu dropdown on all admin pages (email, role badge, navigation)
  - Account page for self-service password change (POST /api/auth/change-password)
  - Settings page read-only for non-admins (view allowed, edit blocked)
  - Backend authorization: requireAuth, requireAdmin on all settings write endpoints
  - 18 new role-based permission tests in settingsRoutes.test.js
- **Updated 2026-01-26:** Internal Brain Premium Login UI
  - Rebranded login page with AffiliateFinder logo and "Internal Brain" title
  - Premium styling: #073b55 primary, #067280 accent, gradient background
  - Footer: "Powered by Michelle - Made for the best team in the word"
  - Seeded internal users: michelle@affiliatefinder.ai and jamie@affiliatefinder.ai
  - Password: secrettool12345 (bcrypt hashed, not stored in code)
  - 7 new tests for internal user authentication
- **Updated 2026-01-27:** User Management Page Fix
  - Fixed null reference error causing redirect to Calls page
  - Removed obsolete `currentUserName` element reference
  - Full CRUD operations verified: list, edit, role change, deactivate, reactivate
  - Self-protection: cannot deactivate/demote yourself
  - Non-admin access denied with redirect
  - 18 user management tests passing

### PRD Feature 2: Fireflies Sync - COMPLETE
- Sync service with incremental sync
- Rep filter (Phil only default)
- Date range sync
- Tests passing (22+ tests)

### PRD Feature 3: Per-Call Analysis - COMPLETE
- LLM integration (Claude + GPT-4)
- Analysis service with structured extraction
- Call detail page with insights tabs
- Tests passing (32 tests)

### PRD Feature 3B: Call Classification - COMPLETE
- SALES/NOT_SALES/REVIEW_NEEDED classification
- Denylist + Name-and-Name pattern
- Tests passing (47 tests)

### PRD Feature 4: Dashboard Aggregation - COMPLETE
- Pain points, goals, questions, dislikes, excitement
- Filters (date range, rep, keyword)
- Tests passing (34 tests)
- **Updated 2026-01-26:** Copy Dashboard - Rep Quote Filtering
  - Added isRepQuote() detection for rep pitching/selling language
  - Filters out rep quotes from all insight aggregations
  - Copy view now shows only customer/prospect language
  - 5 new tests for rep filtering + 26 total dashboard tests passing

### PRD Feature 10: DFY Pitch Detection - COMPLETE
- Trigger categories (PAIN, OBJECTION, TIME, BUDGET, RESOURCE, CAPABILITY)
- Confidence scoring
- Phil's dedicated page
- Tests passing (58 tests)

### PRD Feature 11: Stripe Enrichment - COMPLETE
- 3-tier matching: Email exact → Domain fallback → Name fallback
- Subscription status tracking (active, trialing, past_due, canceled, never_subscribed)
- Conversion metrics with MRR
- Tests passing (53 tests)
- Known limits: Domain/name matching fetches only 100 most recent customers

### PRD Feature 13: Full-text Search - COMPLETE
- FTS4 virtual table with Porter stemmer
- Search service with highlighting
- Search routes and UI
- Tests passing (49 tests)

### PRD Feature 15: Admin Settings (partial) - COMPLETE
- OpenAI Model Configuration
- Controlled Re-analysis Pipeline
- API key management (Fireflies, Stripe, OpenAI)
- Tests passing (66 tests)

### NEW: Insight Snapshot Generator - COMPLETE (2026-01-26)
- Service with conversion delta, DFY classification, churn signals
- Routes for JSON, Notion Markdown, Slack Block Kit
- Dashboard button and modal UI
- Tests passing (65 tests)

### NEW: Founder Closing Rate Page - COMPLETE
- Phil's closing metrics with deduplication
- Routes and dedicated UI page
- Tests passing (25+ tests)
- **Updated 2026-01-26:** Added Jamie support, "all" reps filter, Rep column with color badges

### NEW: Slack Lifecycle Event Ingestion - COMPLETE (2026-01-26)
- Slack lifecycle events table for signup detection
- Parses events: registered, trialing, active, canceled, etc.
- Integrated into Founder Snapshot as fallback to Stripe
- Combined status with Stripe priority, Slack fallback

### NEW: Unified Date Range Filters - COMPLETE (2026-01-26)
- Dashboard-style date preset dropdown across all pages
- Presets: All time, This week, Last week, Last month, Last 3 months, Last 6 months, Custom range
- Applied to: Phil DFY, Calls, Closing Rate pages

### NEW: Bulk Actions - COMPLETE (2026-01-26)
- Bulk delete (hard delete)
- Bulk analyze with throttling
- Progress tracking and cancel
- Tests passing (21 tests)

### NEW: Rep Filter for Sync - COMPLETE (2026-01-26)
- Filter by rep during Fireflies sync
- Default: Phil only
- Tests passing (22 tests)

### NEW: Duration Auto-Format - COMPLETE (2026-01-26)
- MM:SS for < 1 hour, HH:MM:SS for >= 1 hour
- Tests passing (23 tests)

### NEW: Phil DFY Quality Tab Redesign - COMPLETE (2026-01-26)
- Complete redesign of Phil DFY tab into "Sales Quality" view
- DFY Qualification Service with 15+ extracted fields per call:
  - dfy_pitched, dfy_offer_type, proposal_promised, discovery_booked_for_dfy
  - software_pitched, software_close_attempted, budget_asked, budget_provided
  - budget_fit_for_dfy, criteria_no_time, criteria_buyer_intent, criteria_budget_validated
  - dfy_qualification_score (0-4), dfy_quality_flag (clean/risky/unclear)
  - evidence with transcript line references
- KPI strip with 6 metrics (Calls, DFY Pitched %, Properly Qualified %, Software Close %, Clean Quality %, Avg Score)
- DFY Quality Funnel sidebar showing conversion through stages
- Call list table with score pips, budget status, next step indicators, quality flags
- Call drilldown with evidence quotes and "View in transcript" highlighting
- Configuration: Score threshold 3+, proposal without discovery = risky, budget min $1,000/mo
- Tests: 63 unit tests (dfyQualificationService.test.js), 22 integration tests (dfyQualityRoutes.test.js)
- All 85 tests passing

### NEW: Decision Rationale & Evidence Drilldown - COMPLETE (2026-01-26)
- Enhanced call drilldown for DFY qualification transparency
- **Decision Summary section** (top of panel):
  - Flag badge (Clean/Risky/Unclear) with color coding
  - Qualification Score (X/4)
  - One-line deterministic explanation
- **Rule Breakdown panel** (middle):
  - Scannable table with 10 rules
  - Result column: Yes (green)/No (red)/Unknown (gray)
  - Importance label: Primary signal, Qualification criteria, Risk signal, Software discipline
  - Evidence quote with expandable truncation
  - "View in transcript" action button
- **Flag Logic section** (bottom):
  - Clean: DFY not pitched OR (score >= 3 AND no risky patterns)
  - Risky: DFY pitched AND (proposal without discovery OR score < 2)
  - Unclear: DFY pitched AND score = 2 (insufficient qualification signals)
- **Transcript highlighting with fuzzy match**:
  - Exact match: highlights exact quote in transcript
  - Fuzzy match (60% word threshold): shows "[~]" indicator
  - Smooth scroll to highlighted line
- **Per-call re-analyze button**: "Re-analyze DFY Evidence"
- Backend: `generateDecisionRationale()`, `mapEvidenceToRules()` in dfyQualificationService.js
- Tests: 15 new unit tests, 9 new integration tests (24 total)

### NEW: DFY Detection Improvements - COMPLETE (2026-01-26)
- Fixed false positives in DFY pitch detection and budget_asked qualification
- **Stricter DFY Pitch Detection**:
  - Removed bare `'agency'` keyword from dfyKeywords (too generic)
  - Added offer-oriented phrases: `'agency service'`, `'our agency can'`, `'done for you'`, etc.
  - New `isCredibilityIntroOnly()` function excludes:
    - "I own an agency", "I have an agency", "I run an agency" (credibility intros)
    - UNLESS followed by offer transition: "we can do this for you", "we offer a package"
  - Files: `dfyDetector.js`, `dfyPitchService.js`
- **DFY-Contextual Budget Ask**:
  - `budget_asked` only TRUE when question is about DFY/managed service pricing
  - New `DFY_BUDGET_CONTEXT_KEYWORDS` array for DFY-specific budget patterns
  - New `isBudgetAskDFYContextual()` checks surrounding context
  - General business budget questions no longer count
  - File: `dfyQualificationService.js`
- **Evidence Validation**:
  - New `validateEvidence()` function checks if quote matches rule keywords
  - `mapEvidenceToRules()` now includes `evidenceValid` and `evidenceValidationReason`
  - File: `dfyQualificationService.js`
- Tests: 24 new tests in `dfyDetection.test.js`
- All 71 DFY-related tests passing

### NEW: Closing Rate CSV Export - COMPLETE (2026-01-26)
- CSV export service (csvExportService.js) with safe escaping
- Export CSV button in Closing Rate page (founder.html)
- Frontend-only CSV generation - exports exact table data shown
- Respects current filters (date range, rep, status)
- CSV columns: Rep, Call Title, Date, Prospect Email, Status
- UTF-8 encoded with BOM for Excel compatibility
- Deterministic filename: `closing-rate-calls-YYYY-MM-DD-to-YYYY-MM-DD.csv`
- Tests: 43 unit tests (csvExportService.test.js), 4 integration tests (founderRoutes.test.js)
- All 47 tests passing

### NEW: Enhanced Rep Detection & Color Badges - COMPLETE (2026-01-26)
- Improved rep identification with email-based detection (highest priority)
- Email patterns: Jamie = jamie@increasing.com, Phil = phil@affiliatefinder.ai
- Title pattern matching to avoid false positives (e.g., "Phil Alexander" is a prospect)
- "Both" detection when both reps are on the same call
- Color-coded rep badges across all pages:
  - Phil: Yellow background (#b45309)
  - Jamie: Pink background (#be185d)
  - Both: Blue background (#2563eb)
  - Unknown: Gray background
- Pages updated: index.html, founder.html, call.html, copy.html
- Closing Rate refresh button re-checks Stripe/Slack for new sign-ups
- Tests: 30 tests in syncService.test.js (all passing)

### NEW: Copy - Customer Language Intelligence Page - COMPLETE (2026-01-26)
- Renamed Dashboard to "Copy" with subheader "Customer Language Intelligence across analyzed calls"
- Updated navigation across all pages from "Dashboard" to "Copy"
- New 8-section layout:
  1. Pain Points (Challenges & Frustrations)
  2. Goals (Desired Outcomes & Wins)
  3. Wording (subtabs: Industry Terms, Colloquial Problem Language, Power Words) - placeholder
  4. Metaphors & Analogies - placeholder
  5. Emotional Triggers (Emotion Map) - derived from dislikes.emotions
  6. Customer Questions
  7. Positive Reactions (all positive emotional responses)
  8. Objections & Criticism (grouped with type badges)
- Each item shows: ranked label, quote snippet, source call reference (title + date + rep), mentions count
- Context Drawer: Right-side drawer with full quote, 10-line transcript context, fuzzy matching
- Transcript Highlighting: call.html reads `highlight` URL parameter, fuzzy matching fallback
- Label Normalization: Client-side improvement to reduce generic buckets with "Needs review" badge
- Export MD button unchanged
- Tests: 14 new tests in copyPage.test.js (all passing)

### NEW: Calls View Apply Filters Button - COMPLETE (2026-01-26)
- Added explicit "Apply Filters" button to Calls view for predictable filter behavior
- Implemented draft vs applied filter state separation:
  - Draft filters = UI state (what user is editing)
  - Applied filters = Active filters (used for data fetching)
- Filters only apply when user clicks "Apply Filters" button
- Refresh uses applied filters (not draft UI values)
- Sync Calls unchanged (uses draft values for sync operation)
- Backend API updated: /api/admin/calls accepts startDate, endDate, rep query params
- Database functions updated: getRecentTranscripts() and getTranscriptCount() support filtering
- Tests: 8 new filter tests in transcriptDb.test.js (all passing)

### NEW: Manual Closing Rate Adjustments - COMPLETE (2026-01-26)
- Three additive features for the Closing Rate page with toggle-based activation (default OFF):
- **Feature 1: Manual DFY Closes (Won Deals)**
  - "Include manual DFY closes" toggle in Manual Adjustments card
  - "Add DFY Close" button opens modal with form fields:
    - Email (required), Company, Website, Rep, Close Date (required), Amount, Notes, Linked Call ID
  - Manual closes added to numerator when toggle is ON
  - Visual "Manual" badge in table for manual entries
  - Deduplication by prospect email with override option
- **Feature 2: Manual Lifecycle Overrides**
  - "Include manual lifecycle overrides" toggle
  - Per-row action menu (3-dot button) with options:
    - Mark as Signed Up, Mark as Active, Mark as Churned, Clear Override
  - When override exists: shows "Manual: [Status]" pill with tooltip
  - Priority: Manual Override > Stripe > Slack
  - Auditable with created_at, created_by tracking
- **Feature 3: Call Exclusion from Metrics**
  - "Include excluded calls in rate" toggle
  - "Include" checkbox column in Analyzed Calls table (default ON for sales, OFF for non-sales)
  - Bulk actions: "Exclude Selected", "Include Selected"
  - Summary line: "X included / Y total calls in closing rate calculation"
  - Excluded calls removed from denominator when toggle is OFF
- **Metric Calculations:**
  - Closing Rate = (Stripe signups + manual DFY closes) / included sales calls
  - Churn Rate = churned / total signups
- **Database Tables:**
  - manual_closes (email, company, website, rep, close_date, amount, notes, linked_call_id)
  - lifecycle_overrides (call_id, prospect_email, status, notes)
  - call_inclusions (call_id, included)
- **API Endpoints:** `/api/closing-rate/`
  - GET/POST/PUT/DELETE manual-closes
  - GET/POST/DELETE lifecycle-overrides
  - GET/PUT inclusions, POST inclusions/bulk
- **CSV Export:** Updated to include "Included" and "Manual Override" columns
- Navigation renamed from "Phil DFY" to "DFY" across all admin pages
- Tests: 31 new tests in closingRateAdjustmentsRoutes.test.js
- All 177 closing rate related tests passing (closingRate|founder|transcriptDb)

### NEW: Persistent Deleted Calls + Restore - COMPLETE (2026-01-28)
- Soft delete pattern with automatic and manual deletion support
- **Auto-Delete Rules (applied on sync):**
  - Title contains "weekly" → auto-delete with reason "auto-filter:weekly"
  - Title contains "af ads jour fixe" → auto-delete with reason "auto-filter:jour-fixe"
  - Title is exactly "dev" (case-insensitive) → auto-delete with reason "auto-filter:dev"
  - Note: "dev call", "development weekly" etc. are NOT auto-deleted (only exact "dev")
- **Persistence:**
  - Deleted state survives page refresh, app restart, and re-sync
  - Re-syncing a deleted call does NOT restore it
  - Manual restore required to bring back deleted calls
- **Database Schema:**
  - Added `deleted_at TIMESTAMP` column to transcripts table
  - Added `deleted_reason TEXT` column (manual, auto-filter:weekly, auto-filter:jour-fixe, auto-filter:dev)
  - Migration with `addColumnSafely()` for existing databases
  - Index on `deleted_at` for query performance
- **API Endpoints:**
  - `GET /api/admin/deleted` - List deleted calls with pagination
  - `POST /api/admin/calls/:id/restore` - Restore single deleted call
  - `DELETE /api/admin/calls/:id` - Soft delete single call
  - `POST /api/bulk/delete` - Changed from hard to soft delete
  - `POST /api/bulk/restore` - Bulk restore deleted calls
- **UI Changes:**
  - View dropdown: "Active Calls" / "Deleted Calls"
  - Deleted view shows: Title, Deleted At, Deleted Reason, Rep
  - Reason badges: "Manual" (gray), "Weekly Filter" (amber), "Jour Fixe Filter" (purple), "Dev Filter" (blue)
  - Bulk action bar shows "Restore Selected" in deleted view
  - Single call restore via row action
- **Analysis Pipeline:**
  - `getTranscriptsNeedingAnalysis()` excludes deleted calls
  - `getRecentTranscripts()` excludes deleted by default
  - Restored calls become eligible for analysis again
- **Files Modified:**
  - `backend/services/dbAdapter.js` - Schema + migration
  - `backend/services/transcriptDb.js` - Soft delete functions + shouldAutoDelete()
  - `backend/routes/admin.js` - New endpoints
  - `backend/routes/bulkActions.js` - Changed to soft delete
  - `backend/public/admin/index.html` - UI for deleted view + restore
- **Tests:** 23 new tests in `softDelete.test.js`
  - Auto-delete rule tests
  - Soft delete and restore tests
  - Sync preservation tests
  - Analysis exclusion tests
- All 154 related tests passing (softDelete, bulkActions, transcriptDb, syncService)

---

## Test Summary

**Total: 1082+ tests (1082+ passing, 0 failing)**

| Category | Tests |
|----------|-------|
| Auth (service, middleware, routes) | 178 |
| Sync & Transcripts | 50+ |
| Analysis & Classification | 79+ |
| Dashboard & Aggregation | 34 |
| Copy Page | 14 |
| DFY Pitch | 58 |
| DFY Qualification & Rationale | 85 |
| Stripe Enrichment | 53 |
| Search | 49 |
| Settings & Reanalysis | 82 |
| Insight Snapshot | 65 |
| Founder | 26 |
| Bulk Actions | 21 |
| Duration Formatting | 23 |
| CSV Export | 43 |
| Closing Rate Adjustments | 31 |
| Soft Delete | 23 |

---

## Notes

- All tasks are from prd.md unless marked "NEW"
- User priority: Token/Cost Tracking (P1.1) - COMPLETED
- No deadline constraints
- CSV Export (P1.2) partially complete - Closing Rate export done, Copy export remaining
- Slack lifecycle integration adds second data source for signup detection
- Rep filtering now supports Phil, Jamie, or All reps
- UI consistency: All date filters use Dashboard-style presets
- Copy page replaces Dashboard as primary copywriting intelligence view
- Calls view uses explicit "Apply Filters" button for predictable filter behavior
- Closing Rate page supports manual adjustments via toggles (default OFF preserves existing behavior)
- Navigation renamed: "Phil DFY" → "DFY" across all pages
