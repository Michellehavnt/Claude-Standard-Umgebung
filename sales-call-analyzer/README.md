# AffiliateFinder.ai Sales Call Analysis System

A complete sales call analysis system that connects to the Fireflies API, analyzes sales call transcripts, and generates actionable intelligence reports.

## Features

- **Dashboard**: View analyzed calls with key metrics and statistics
- **Call Analysis**: Detailed breakdown of each sales call including:
  - Prospect profile extraction
  - Pain point identification (from prospect statements only)
  - Objection tracking
  - Excitement triggers
  - DFY (Done-For-You) mention detection and classification
  - Customer language asset extraction
- **Aggregated Reports**: Track patterns over time
- **Language Database**: Build a database of customer language for marketing
- **Export**: Generate markdown reports

## Tech Stack

- **Frontend**: React with Tailwind CSS
- **Backend**: Node.js/Express
- **Database**: SQLite
- **API**: Fireflies GraphQL API

## Project Structure

```
sales-call-analyzer/
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ControlPanel.jsx
│   │   │   ├── StatsCards.jsx
│   │   │   ├── CallsTable.jsx
│   │   │   ├── CallDetailModal.jsx
│   │   │   ├── AggregatedReports.jsx
│   │   │   └── LanguageDatabase.jsx
│   │   ├── hooks/
│   │   │   ├── useFireflies.js
│   │   │   └── useAnalysis.js
│   │   ├── utils/
│   │   │   ├── parseTitle.js
│   │   │   └── formatters.js
│   │   ├── App.jsx
│   │   └── index.jsx
│   └── package.json
├── backend/
│   ├── routes/
│   │   ├── transcripts.js
│   │   └── analysis.js
│   ├── services/
│   │   ├── fireflies.js
│   │   ├── analyzer.js
│   │   └── database.js
│   ├── utils/
│   │   ├── dfyDetector.js
│   │   └── painPointExtractor.js
│   ├── server.js
│   ├── .env
│   └── package.json
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn

### Backend Setup

```bash
cd backend
npm install
npm start
```

The backend will run on `http://localhost:3001`

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

The frontend will run on `http://localhost:3000` and proxy API requests to the backend.

## Configuration

The Fireflies API credentials are configured in `backend/.env`:

```
FIREFLIES_API_KEY=your-api-key
FIREFLIES_API_ENDPOINT=https://api.fireflies.ai/graphql
PORT=3001
```

## API Endpoints

### Transcripts
- `GET /api/transcripts` - Fetch transcripts from Fireflies
- `GET /api/transcripts/:id` - Get a single transcript with details
- `GET /api/transcripts/date-range/:start/:end` - Get transcripts in date range

### Sync
- `POST /api/sync` - Sync new transcripts from Fireflies
- `POST /api/sync/date-range` - Sync transcripts in a specific date range
- `GET /api/sync/status` - Get current sync status and progress
- `POST /api/sync/cancel` - Cancel an in-progress sync operation
- `GET /api/sync/history` - Get sync history
- `GET /api/sync/reps` - Get available rep filter options

### Analysis
- `GET /api/calls` - Get analyzed calls with filters
- `GET /api/calls/:id` - Get single call analysis
- `POST /api/analyze` - Trigger analysis for calls
- `GET /api/analyze/progress` - Get analysis progress
- `GET /api/stats` - Get aggregated statistics
- `GET /api/pain-points` - Get aggregated pain points
- `GET /api/language` - Get customer language database
- `GET /api/dfy-report` - Get DFY tracking report
- `POST /api/export` - Export report

### Bulk Operations
- `POST /api/bulk/delete` - Soft delete multiple calls
- `POST /api/bulk/restore` - Restore multiple deleted calls
- `POST /api/bulk/analyze` - Start bulk analysis (async)
- `GET /api/bulk/analyze/status` - Get bulk analysis progress
- `POST /api/bulk/analyze/cancel` - Cancel bulk analysis

### Admin
- `GET /api/admin/dashboard` - Get dashboard stats and recent calls
- `GET /api/admin/calls` - Get paginated calls list
- `GET /api/admin/calls/:id` - Get single call with full transcript
- `PUT /api/admin/calls/:id/classification` - Update classification override
- `DELETE /api/admin/calls/:id` - Soft delete a single call
- `POST /api/admin/calls/:id/restore` - Restore a deleted call
- `GET /api/admin/deleted` - Get deleted calls list
- `POST /api/admin/apply-auto-delete` - Apply auto-delete rules retroactively
- `POST /api/admin/redetect-reps` - Re-run rep detection on all calls

## Key Features Explained

### Speaker Identification

The system automatically identifies the sales rep (Jamie or Phil) using a priority-based detection system:

**Detection Priority (highest to lowest):**
1. **Email patterns** (most reliable): jamie@increasing.com, phil@affiliatefinder.ai
2. **Title patterns**: "Jamie I.F.", "Phil Norris", "Phil -", "Jamie -"
3. **Participant names**: Match against known rep names/patterns

**Features:**
- **False positive prevention**: "Phil Alexander" (prospect name) won't match as Phil the sales rep
- **"Both" detection**: When both reps are on the same call, displays "Both" label
- **Color-coded badges**: Phil (yellow), Jamie (pink), Both (blue), Unknown (gray)
- Badges appear consistently across all pages (Calls, Closing Rate, Call Detail, Copy)

Only extracts quotes and pain points from the prospect (customer), not the sales rep.

### Call Classification

Calls are automatically classified before analysis:
- **SALES**: High confidence sales calls (e.g., "Name and Name" patterns)
- **NOT_SALES**: Internal meetings, catchups, dev calls (denylist patterns)
- **REVIEW_NEEDED**: Uncertain classification requiring manual review

Manual classification overrides are supported via the admin dashboard.

### Auto-Delete Rules

Internal/non-sales calls are automatically soft-deleted during sync based on these rules:

| Pattern | Match Type | Reason |
|---------|-----------|--------|
| Contains "weekly" | Title | auto-filter:weekly |
| Contains "af ads jour fixe" | Title | auto-filter:jour-fixe |
| Contains "catchup", "catch up", or "catch-up" | Title | auto-filter:catchup |
| Exactly "dev" | Title | auto-filter:dev |
| Exactly "dev call" | Title | auto-filter:dev-call |
| Exactly "week summary meeting" | Title | auto-filter:week-summary |
| Exactly "phil norris and jamie i.f." | Title | auto-filter:internal |
| Starts with "michelle@" | Host Email | auto-filter:host-michelle |

Auto-deleted calls:
- Are hidden from all analysis and metrics
- Can be viewed in the "Deleted Calls" view
- Can be restored manually if needed
- Will not be re-deleted if restored

### DFY Detection

The system detects when Done-For-You (agency) services are mentioned and classifies them:
- **Justified**: Prospect initiated or showed clear need
- **Avoidable**: Mentioned when prospect showed self-serve capability
- **Premature**: Mentioned before assessing prospect needs

### OpenAI Model Selection

The system supports multiple OpenAI models, configurable via the Admin Settings page:

| Model | Description | Best For |
|-------|-------------|----------|
| GPT-5 Nano (default) | Ultra-fast, lowest cost | Simple analysis tasks, high-volume processing |
| GPT-5 Mini | Advanced reasoning, balanced cost | Most analysis scenarios |
| GPT-4o | Most capable | Complex analysis, nuanced extraction |
| GPT-4o-mini | Fast, cost-effective | Balanced performance and cost |
| GPT-4 Turbo | Large context window | Long transcripts |
| GPT-3.5 Turbo | Fastest, most economical | Budget-constrained scenarios |

**Model Testing**: Use the "Test with Selected Model" button in Admin Settings to verify API key validity and model availability before saving configuration changes.

**Model Validation**: The backend validates model selections and rejects invalid models with clear error messages. Retry logic with exponential backoff handles transient failures (429 rate limits, 5xx server errors).

### Pain Point Categories

AI-powered categorization extracts pain points dynamically. Common categories include:
- Manual Time Sink
- CAPTCHA Frustration
- Platform Failures
- Affiliates Disappearing
- Scaling Difficulties
- Niche Market Challenge
- Poor Quality Results
- Competitive Pressure
- Resource Constraints
- Lack of Data Visibility

### Stripe Integration

The system enriches calls with Stripe customer/subscription data to track conversion outcomes.

**Matching Logic (Priority Order):**
1. **Email Exact Match** (highest confidence): Participant email → Stripe customer email
2. **Domain Fallback** (medium confidence): Email domain matching (excludes gmail.com, yahoo.com, etc.)
3. **Name Fallback** (lowest confidence): Participant name → Stripe customer name

**Data Extracted from Stripe:**
- Customer: `email`, `name`, `id`, `created` (signup date)
- Subscriptions: `status` (active/trialing/past_due/canceled), `start_date`, `canceled_at`, plan info, MRR

**Subscription Status Values:**
- `active`: Has active subscription
- `trialing`: Currently on trial
- `past_due`: Payment failed
- `canceled`: Subscription was canceled
- `never_subscribed`: Customer exists but never subscribed
- `unmatched`: No matching Stripe customer found

**Known Limitations:**
- Domain/name matching only fetches the most recent 100 Stripe customers
- No website or company/brand name matching (Stripe metadata not currently used)
- Email must match exactly; different emails for call vs signup won't match

### Founder Metrics (Closing Rate)

Dedicated page for tracking Phil's (or any rep's) closing rate with:
- Deduplication by prospect email (only first call counted)
- Signup rate, active rate, churn rate calculations
- Average days from call to signup

### Sync Operations

**Sync Calls Button:**
- Click "Sync Calls" to import new calls from Fireflies
- During sync, button turns red and shows "Cancel"
- Click "Cancel" to stop the sync operation mid-process
- Existing transcripts are never overwritten or duplicated

**Sync Cancellation:**
- Cancellation is graceful - already-processed calls are kept
- Cancel button becomes "Cancelling..." while waiting for current call to finish
- Button resets to "Sync Calls" after cancellation completes

### Bulk Analysis

**Analyze Calls:**
- Select calls and click "Analyze Selected" to start bulk analysis
- Progress bar shows real-time status (processed/total, analyzed, skipped, errors)
- Analysis runs with 5-second throttling between calls to avoid rate limits

**Progress Persistence:**
- Progress bar persists across page refresh and tab switches
- If you return after analysis completes, final results are shown for 5 minutes
- Auto-hides after 10 seconds when viewing completed results

## Usage

1. **Sync Calls**: Click "Sync Calls" to import new calls from Fireflies (can be cancelled mid-sync)
2. **Filter by Date**: Use the date range dropdown (This week, Last week, Last month, etc.) to filter calls
3. **Filter by Rep**: Select a specific sales rep to view their calls
4. **Keyword Search**: Search within transcripts for specific terms
5. **View Details**: Click on any insight item to see the full call transcript context
6. **Export MD**: Click "Export MD" to copy a markdown report of the current dashboard data to clipboard

## Database Schema

The SQLite database stores:
- `transcripts` - Main call data, transcript text, and analysis JSON
- `sync_log` - Sync operation history
- `users` - User accounts (magic link auth)
- `sessions` - Active user sessions
- `magic_links` - Authentication tokens

Key columns in `transcripts`:
- `fireflies_id` - Unique ID from Fireflies API
- `call_title`, `call_datetime`, `duration_seconds`
- `rep_name`, `rep_email`, `participants` (JSON)
- `transcript_text` - Full transcript
- `analysis_json` - LLM analysis results
- `analysis_version` - Version tracking for re-analysis
- `stripe_data` - Stripe enrichment results (JSON)
- `classification_override` - Manual SALES/NOT_SALES override
- `deleted_at` - Soft delete timestamp (NULL = active)
- `deleted_reason` - Why call was deleted (manual, auto-filter:weekly, etc.)
