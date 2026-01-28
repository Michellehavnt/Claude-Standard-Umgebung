# Sales Call Analyzer - Product Requirements Document (PRD)

**Version**: 2.1
**Last Updated**: 2025-01-25
**Status**: Final Draft
**Product**: AffiliateFinder.ai Sales Intelligence Dashboard

---

## Executive Summary

An internal web application for the AffiliateFinder.ai sales team (2-3 reps) to analyze Fireflies call transcripts, extract customer intelligence, and correlate sales conversations with Stripe subscription outcomes. The app runs locally and serves as a single source of truth for understanding prospect pain points, goals, objections, and buying signals—enriched with actual customer lifecycle data.

**Key Decisions from Requirements Gathering:**
- Local deployment only (localhost/LAN)
- Magic link authentication (no passwords)
- Manual sync and analysis triggers
- SQLite database with 6-month transcript retention
- Multi-LLM support (Claude + GPT-4)
- Phil is the primary rep tracked for DFY behavior
- AI auto-categorizes pain points with admin merge capability
- Tabbed dashboard layout with conversion rate as key metric
- CSV export, no scheduled reports
- No CRM features (contacts/companies)
- Full-text search within transcripts

---

## Table of Contents

1. [Authentication & Access](#feature-1-authentication--access)
2. [Fireflies Transcript Sync](#feature-2-fireflies-transcript-sync)
3. [AI-Powered Call Analysis](#feature-3-ai-powered-call-analysis)
4. [Dashboard & Insights](#feature-4-dashboard--insights)
5. [Pain Points Tab](#feature-5-pain-points-tab)
6. [Goals Tab](#feature-6-goals-tab)
7. [Questions Tab](#feature-7-questions-tab)
8. [Objections Tab](#feature-8-objections-tab)
9. [Excitement Tab](#feature-9-excitement-tab)
10. [DFY Tracking Tab](#feature-10-dfy-tracking-tab)
11. [Stripe Integration](#feature-11-stripe-integration)
12. [Call Detail View](#feature-12-call-detail-view)
13. [Search & Filtering](#feature-13-search--filtering)
14. [Export](#feature-14-export)
15. [Admin Settings](#feature-15-admin-settings)
16. [Changelog](#feature-16-changelog)
17. [Lead Quality](#lead-quality-feature)

---

## Technical Specifications

### Deployment
| Aspect | Decision |
|--------|----------|
| Environment | Local only (localhost or LAN IP) |
| Access | Browser-based, no internet required after setup |
| Users | 2-3 sales reps + 1 admin |

### Technology Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18, Tailwind CSS, React Query |
| Backend | Node.js 18+, Express |
| Database | SQLite (file-based, no setup) |
| AI/LLM | OpenAI GPT-5 Nano (default), GPT-5 Mini, GPT-4o, GPT-4o-mini, GPT-4 Turbo, GPT-3.5 Turbo (switchable) |
| Auth | Magic link via email (no passwords) |
| Search | SQLite FTS5 (full-text search) |
| Testing | Jest + React Testing Library + Playwright |

### Data Retention
- Raw transcripts: Archived/deleted after 6 months
- Analysis data: Retained indefinitely
- Stripe data: Synced and kept current

---

## Feature 1: Authentication & Access

### Description
Magic link authentication for internal team with access request workflow. Only @affiliatefinder.ai email addresses are allowed. New users must request access, which admins approve or deny. No passwords to manage—approved users receive login links via email.

### Access Request Workflow
1. User enters @affiliatefinder.ai email on login page
2. If not approved: Access request created, user sees "pending" status
3. Admins review and approve/deny requests via admin panel
4. On approval: User account created, notification email sent
5. Approved users can then request magic links to login
6. Denied users can re-request access (resets to pending)

### Domain Restriction
- Only @affiliatefinder.ai email addresses are accepted
- Non-affiliatefinder.ai emails are rejected with clear error message
- Admin emails configured via ADMIN_EMAILS environment variable

### User Roles
| Role | Permissions |
|------|-------------|
| **Admin** | Full access: manage users, approve access requests, configure integrations, delete data, change settings |
| **Rep** | View all calls and analytics, trigger sync/analysis, export data |

### UI Location
- **Login Page**: `/admin/login.html`
- **Access Requests**: `/admin/access-requests.html` (Admin only)
- **User Management**: `/admin/users.html` (Admin only)

### UI Components

#### Login Page (Combined Flow)
```
┌─────────────────────────────────────┐
│       Sales Call Analyzer           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Enter your email            │    │
│  │ @affiliatefinder.ai         │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ Your name (optional)        │    │
│  └─────────────────────────────┘    │
│                                     │
│  [ Continue ]                       │
│                                     │
│  Domain: @affiliatefinder.ai only   │
└─────────────────────────────────────┘
```

- States: approved (sends magic link), pending (shows status), denied (allows re-request)
- Email input with domain hint
- Name field (optional, for new access requests)
- Link expires after 60 minutes

#### Access Requests Page (Admin)
```
┌─────────────────────────────────────────────────────┐
│ Access Requests                                      │
│ [Pending] [Approved] [Denied] [All]                 │
├─────────────────────────────────────────────────────┤
│ Email              | Name    | Requested  | Actions │
│ user@affiliat...   | John    | Jan 26     | [✓] [✗] │
│ rep@affiliat...    | Sarah   | Jan 25     | [✓] [✗] │
└─────────────────────────────────────────────────────┘
```

- Tabs for filtering by status
- Approve modal with role selection and notes
- Deny modal with reason field
- Delete button for cleanup

### Rate Limiting
| Endpoint | Limit | Window |
|----------|-------|--------|
| Login/magic-link | 5 requests | 15 minutes (per email) |
| Token verification | 10 requests | 5 minutes (per IP) |
| Access requests | 3 requests | 1 hour (per IP) |
| General API | 100 requests | 1 minute (per IP) |

### Email Service
- Provider: Mailchimp Transactional (Mandrill)
- Emails: Magic link, access request notification, approval/denial notification
- Dev mode: Logs to console instead of sending

### Acceptance Criteria
- [x] Only @affiliatefinder.ai emails accepted
- [x] Non-approved users can request access
- [x] Admins can approve/deny access requests
- [x] Approved users receive magic link
- [x] Magic link works once and expires after 60 minutes
- [x] Session persists for 30 days (stored in httpOnly cookie)
- [x] Unauthorized users redirected to `/admin/login.html`
- [x] Rate limiting prevents abuse
- [x] Denied users can re-request access
- [x] Deactivated users see "Account deactivated" on login attempt

### Test Plan

#### Unit Tests
```javascript
// auth.service.test.js
- isAllowedDomain(): validates @affiliatefinder.ai emails
- authenticateOrRequestAccess(): handles approved, pending, denied states
- approveAccessRequest(): creates user, sends notification
- denyAccessRequest(): updates status, sends notification
- getAccessStatus(): returns correct status for email

// auth.middleware.test.js
- requireAuth(): returns 401 if no token
- requireAuth(): returns 401 if token expired
- requireAuth(): calls next() if valid token
- requireAdmin(): returns 403 if user is not admin
```

#### Integration Tests
```javascript
- POST /api/auth/login with valid approved email → magic link sent
- POST /api/auth/login with valid unapproved email → access request created
- POST /api/auth/login with non-affiliatefinder email → 400 invalid_domain
- GET /api/auth/status → returns access status for email
- POST /api/auth/access-requests/:id/approve → user created, notification sent
- POST /api/auth/access-requests/:id/deny → status updated, notification sent
- Rate limiting enforced on all auth endpoints
```

#### E2E Tests (Playwright)
```javascript
- User enters non-affiliatefinder email → sees error
- New user enters valid email → sees pending status
- Admin approves request → user can login
- User clicks magic link → lands on dashboard
- User refreshes page → stays logged in
- User clicks logout → returns to login page
```

---

## Feature 2: Fireflies Transcript Sync

### Description
Manual synchronization of call transcripts from Fireflies API. Pulls last 90 days initially, then incremental syncs for new calls.

### Fireflies Configuration
- **Plan**: Business ($19/mo) - Full API access
- **API**: GraphQL endpoint
- **Rate Limits**: Handled with exponential backoff

### Speaker Identification Logic
1. Check call title for rep name (e.g., "Phil - Acme Discovery")
2. Check Fireflies participant metadata for known rep emails
3. Match speaker email domain against known company domain
4. Default: First speaker is rep (fallback)

**Known Reps:**
- Phil (primary, tracked for DFY behavior)
- Other reps identified by email domain

### UI Location
- **Sync Button**: Dashboard header
- **Integration Settings**: `/admin/integrations`

### UI Components

#### Dashboard Header Sync Section
```
┌────────────────────────────────────────────────────┐
│ [Sync New Calls]  Last sync: Jan 25, 2025 2:30 PM  │
│                                                    │
│ ████████████░░░░░░ Syncing 23/47 calls...         │
└────────────────────────────────────────────────────┘
```

- "Sync New Calls" button (disabled during sync)
- Last sync timestamp
- Progress bar + count during sync
- Toast notification on completion/error

#### Integration Settings (Admin)
```
Fireflies Integration
─────────────────────
API Key: ••••••••••••••••ab3f  [Update]
Status: ✓ Connected

Initial Sync Range: Last 90 days
Last Successful Sync: Jan 25, 2025 2:30 PM
Calls Synced: 234

[Test Connection]
```

### Data Model
```sql
CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,           -- UUID
  fireflies_id TEXT UNIQUE,      -- Fireflies transcript ID
  title TEXT NOT NULL,
  call_date DATETIME NOT NULL,
  duration_seconds INTEGER,
  participants TEXT,             -- JSON array
  raw_transcript TEXT,           -- Full transcript text
  speaker_timeline TEXT,         -- JSON: [{speaker, text, start, end}]
  sales_rep TEXT,                -- 'Phil' or other rep name
  prospect_name TEXT,            -- Extracted from title/transcript
  prospect_company TEXT,
  prospect_email TEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  analysis_status TEXT DEFAULT 'pending', -- pending|analyzing|complete|failed
  archived_at DATETIME           -- Set when transcript > 6 months old
);

CREATE INDEX idx_transcripts_date ON transcripts(call_date DESC);
CREATE INDEX idx_transcripts_rep ON transcripts(sales_rep);
CREATE INDEX idx_transcripts_status ON transcripts(analysis_status);
```

### Sync Logic
```
1. On first sync:
   - Fetch all transcripts from last 90 days
   - Parse each transcript for speaker identification
   - Store in database with status='pending'

2. On subsequent syncs:
   - Fetch transcripts since last sync date
   - Skip any already in database (by fireflies_id)
   - Add new transcripts with status='pending'

3. Monthly cleanup job:
   - Find transcripts with call_date > 6 months ago
   - Set archived_at = now, clear raw_transcript to save space
   - Keep analysis data intact
```

### Acceptance Criteria
- [ ] First sync imports all calls from last 90 days
- [ ] Subsequent syncs only fetch new calls (incremental)
- [ ] Duplicate transcripts are not re-imported (check fireflies_id)
- [ ] Sales rep correctly identified from title/participants
- [ ] Phil identified by name match (case-insensitive)
- [ ] Sync progress shows real-time updates (WebSocket or polling)
- [ ] Sync completes within 5 minutes for 100 calls
- [ ] API rate limit errors trigger exponential backoff
- [ ] Failed syncs show user-friendly error message
- [ ] Admin can update Fireflies API key
- [ ] "Test Connection" validates API key before saving

### Test Plan

#### Unit Tests
```javascript
// fireflies.service.test.js
- fetchTranscripts(since): parses GraphQL response correctly
- fetchTranscripts(since): handles pagination (100+ results)
- parseParticipants(data): extracts speaker names and emails
- identifySalesRep(title, participants): returns 'Phil' for Phil's calls
- identifySalesRep(title, participants): returns rep name from title
- identifySalesRep(title, participants): returns null if not identifiable

// sync.service.test.js
- syncTranscripts(): skips existing fireflies_ids
- syncTranscripts(): creates pending analysis records
- syncTranscripts(): handles empty response (no new calls)
- getLastSyncDate(): returns null if never synced
- getLastSyncDate(): returns most recent synced_at
```

#### Integration Tests
```javascript
- POST /api/sync with valid API key → 200, returns sync stats
- POST /api/sync during active sync → 409 conflict
- GET /api/sync/status → returns current progress
- Mock Fireflies 429 response → retry with backoff
- Mock Fireflies 401 response → return auth error
```

#### E2E Tests
```javascript
- Click "Sync New Calls" → progress bar appears → completion toast
- Admin updates API key → test connection → success indicator
- Sync with no new calls → "No new calls found" message
```

---

## Feature 3: AI-Powered Call Analysis

### Description
Manual-triggered analysis of transcripts using LLM (Claude or GPT-4) to extract structured intelligence. Analysis includes product-specific context for AffiliateFinder.ai.

### LLM Configuration
| Provider | Model | Cost (per 1M tokens) | Notes |
|----------|-------|---------------------|-------|
| Anthropic | Claude 3.5 Sonnet | ~$3 input, $15 output | Best at structured extraction |
| OpenAI | GPT-5 Mini | ~$1.00 input, $4.00 output | Advanced reasoning with balanced speed and cost |
| OpenAI | GPT-5 Nano | ~$0.10 input, $0.40 output | Ultra-fast, lowest cost (default) |
| OpenAI | GPT-4o | ~$2.50 input, $10 output | Most capable, best for complex analysis |
| OpenAI | GPT-4o-mini | ~$0.15 input, $0.60 output | Fast and cost-effective |
| OpenAI | GPT-4 Turbo | ~$10 input, $30 output | High performance with large context |
| OpenAI | GPT-3.5 Turbo | ~$0.50 input, $1.50 output | Fastest, most economical |

**Estimated Costs:** 10-25 calls/week × 30-60 min calls ≈ $20-50/month

### Analysis Prompt Template
```
You are analyzing a sales call transcript for AffiliateFinder.ai, an affiliate discovery tool that helps businesses find affiliates promoting their competitors and reach out to them via automated email outreach.

The sales team offers two options:
1. Self-serve SaaS tool (AffiliateFinder.ai software)
2. DFY (Done-For-You) agency service where we find and contact affiliates for them

SALES REP in this call: {sales_rep_name}
PROSPECT: {prospect_name} from {prospect_company}

Analyze ONLY statements made by the PROSPECT (not the sales rep).

Extract the following in JSON format:
{schema}

TRANSCRIPT:
{transcript}
```

### Analysis Output Schema
```json
{
  "prospect_profile": {
    "name": "string",
    "company": "string",
    "role": "string (if mentioned)",
    "industry": "string (if determinable)",
    "company_size": "string (if mentioned)"
  },
  "pain_points": [
    {
      "pain": "string (AI-generated category label)",
      "quote": "string (verbatim from prospect)",
      "severity": "low|medium|high",
      "context": "string (what led to this)"
    }
  ],
  "goals": [
    {
      "goal": "string (what they want to achieve)",
      "quote": "string (verbatim)",
      "priority": "primary|secondary",
      "timeframe": "string or null (e.g., 'Q1', 'next month')"
    }
  ],
  "questions_asked": [
    {
      "question": "string (verbatim)",
      "topic": "string (one of: affiliate_growth, competitor_affiliates, email_outreach, affiliate_volume, pricing, implementation, support, integrations, results, other)",
      "answered": true|false,
      "buying_signal_strength": "weak|medium|strong"
    }
  ],
  "objections": [
    {
      "objection": "string (summary)",
      "quote": "string (verbatim)",
      "category": "price|time|trust|fit|timing|other",
      "resolved_in_call": true|false
    }
  ],
  "excitement_triggers": [
    {
      "trigger": "string (what feature/benefit excited them)",
      "quote": "string (verbatim showing excitement)",
      "intensity": "mild|moderate|strong"
    }
  ],
  "dfy_mentions": [
    {
      "timestamp_approx": "string (e.g., 'early', 'middle', 'late' or HH:MM:SS if available)",
      "initiated_by": "rep|prospect",
      "context": "string (what was being discussed)",
      "classification": "justified|avoidable|premature",
      "reasoning": "string (why this classification)"
    }
  ],
  "call_summary": "string (2-3 sentences)",
  "call_quality": "no_show|short|normal|extended",
  "deal_likelihood": "low|medium|high",
  "next_steps_mentioned": ["string"]
}
```

### Question Topics (Fixed List)
Based on common AffiliateFinder.ai prospect questions:
1. `affiliate_growth` - How to grow their affiliate program
2. `competitor_affiliates` - Finding affiliates promoting competitors
3. `email_outreach` - Email outreach capabilities and automation
4. `affiliate_volume` - How many affiliate emails we can find
5. `pricing` - Pricing, plans, costs
6. `implementation` - Setup, onboarding, time to value
7. `support` - Customer support, training
8. `integrations` - Connections to other tools
9. `results` - Case studies, expected outcomes
10. `other` - Anything else

### DFY Classification Criteria
```
JUSTIFIED (appropriate to mention DFY):
- Prospect explicitly asked about done-for-you or managed options
- Prospect stated they lack time to do outreach themselves
- Prospect stated they lack resources/team to handle it
- Prospect showed clear inability or unwillingness to self-serve

AVOIDABLE (shouldn't have mentioned DFY):
- Prospect demonstrated technical competence
- Prospect showed enthusiasm for doing it themselves
- Prospect mentioned having team/resources available
- No explicit need for DFY was established in conversation

PREMATURE (mentioned too early):
- DFY brought up before understanding prospect's situation
- DFY mentioned before discussing pain points
- Rep defaulted to DFY without exploring self-serve fit
- Context: LLM should judge based on conversation flow, not strict timing
```

### UI Location
- **Analyze Button**: Dashboard header (next to Sync)
- **Status Column**: Calls table
- **Results**: Call detail modal

### UI Components

#### Analysis Controls (Dashboard Header)
```
┌──────────────────────────────────────────────────────┐
│ [Sync New Calls]  [Analyze Pending (12)]             │
│                                                      │
│ Analyzing: 3/12 calls...  ████████░░░░░░             │
└──────────────────────────────────────────────────────┘
```

- "Analyze Pending (N)" button shows count of unanalyzed calls
- Progress bar during batch analysis
- Process max 3 calls concurrently to manage LLM costs

#### Call Table Status Column
| Status | Display |
|--------|---------|
| pending | ⏳ Pending |
| analyzing | 🔄 Analyzing |
| complete | ✅ Analyzed |
| failed | ❌ Failed [Retry] |

### Data Model
```sql
CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  transcript_id TEXT REFERENCES transcripts(id),
  llm_provider TEXT,              -- 'anthropic' or 'openai'
  llm_model TEXT,                 -- 'claude-3-5-sonnet' or 'gpt-4o'
  raw_response TEXT,              -- Full LLM response JSON
  prospect_profile TEXT,          -- JSON
  pain_points TEXT,               -- JSON array
  goals TEXT,                     -- JSON array
  questions_asked TEXT,           -- JSON array
  objections TEXT,                -- JSON array
  excitement_triggers TEXT,       -- JSON array
  dfy_mentions TEXT,              -- JSON array
  call_summary TEXT,
  call_quality TEXT,
  deal_likelihood TEXT,
  next_steps TEXT,                -- JSON array
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  tokens_used INTEGER,
  cost_cents INTEGER
);

CREATE INDEX idx_analyses_transcript ON analyses(transcript_id);
```

### Acceptance Criteria
- [ ] "Analyze Pending" button shows count of unanalyzed calls
- [ ] Analysis extracts ONLY prospect statements (not sales rep)
- [ ] All quotes are verbatim from transcript
- [ ] Pain points are AI-categorized (not fixed categories)
- [ ] Questions are categorized into the 10 fixed topics
- [ ] DFY mentions include who initiated and classification
- [ ] Failed analysis shows error message with retry button
- [ ] Retry button re-triggers analysis for single call
- [ ] Analysis runs in background (UI remains responsive)
- [ ] Max 3 concurrent analyses to manage API costs
- [ ] Admin can switch between Claude and GPT-4 in settings
- [ ] Token usage and cost tracked per analysis

### Test Plan

#### Unit Tests
```javascript
// analyzer.service.test.js
- buildPrompt(transcript, rep): includes product context
- buildPrompt(transcript, rep): includes correct schema
- parseResponse(llmOutput): extracts all fields correctly
- parseResponse(llmOutput): handles missing optional fields
- parseResponse(llmOutput): validates quote is in transcript

// dfy.classifier.test.js
- Test case: prospect asks "do you do it for us?" → justified
- Test case: rep mentions DFY, prospect said "I have a team" → avoidable
- Test case: DFY in first 2 minutes, no context → premature

// question.categorizer.test.js
- "How many affiliates can you find?" → affiliate_volume
- "What's the pricing?" → pricing
- "Can you integrate with HubSpot?" → integrations
```

#### Integration Tests
```javascript
- POST /api/analyze with transcript_id → 202 accepted
- GET /api/analyze/status/:id → returns progress
- Mock Claude error → analysis marked as failed
- Mock Claude timeout → retry with exponential backoff
- Analysis with empty transcript → call_quality = 'no_show'
```

#### E2E Tests
```javascript
- Click "Analyze Pending" → progress updates → calls show ✅
- Click retry on failed analysis → analysis restarts → completes
- Open call detail → all analysis sections populated
```

---

## Feature 3B: Call Classification Heuristics

### Description
Automatic classification of calls as SALES, NOT_SALES, or REVIEW_NEEDED based on title patterns and heuristics. This classification happens before AI analysis to filter out non-sales calls and prioritize sales calls.

### Classification Values
| Classification | Description | Next Step |
|---------------|-------------|-----------|
| `SALES` | High confidence this is a sales call | Proceed to AI analysis |
| `NOT_SALES` | High confidence this is NOT a sales call | Skip AI analysis |
| `REVIEW_NEEDED` | Uncertain, may require manual review | Flag for admin review |

### Priority Order (Highest to Lowest)
1. **NOT_SALES Denylist** - Hard denylist patterns always win (internal meetings, catchups, etc.)
2. **Name-and-Name Title Pattern** - Two-person meeting titles classify as SALES
3. **Other Sales Scoring Heuristics** - Keyword-based scoring
4. **REVIEW_NEEDED Fallback** - When no pattern matches with confidence

### NOT_SALES Denylist (Hard Rules)
These patterns ALWAYS classify as NOT_SALES, regardless of other signals:

```javascript
// Case-insensitive regex patterns
/catch\s*-?\s*up/i          // "catchup", "catch up", "catch-up"
/weekly\s*(call|meeting|sync)/i   // "weekly call", "weekly meeting"
/team\s*(meeting|call|sync)/i     // "team meeting", "team call"
/stand\s*-?\s*up/i          // "standup", "stand up", "stand-up"
/1\s*:\s*1/i                // "1:1"
/one\s*on\s*one/i           // "one on one"
/internal\s*(call|meeting)/i      // "internal call", "internal meeting"
/sync\s*(call|meeting)/i    // "sync call", "sync meeting"
/check\s*-?\s*in/i          // "checkin", "check in", "check-in"
/planning\s*(call|meeting|session)/i
/retrospective/i
/sprint\s*(review|planning)/i
/status\s*update/i
/debrief/i
/training\s*(session|call)/i
/onboarding\s*(call|session)/i
/^meeting$/i                // Just "Meeting"
/all\s*hands/i              // "all hands"
/dev\s*(call|meeting)?/i    // "dev call", "dev meeting", "dev"
/affiliatefinder/i          // Internal AffiliateFinder calls
```

### Name-and-Name Pattern (High Confidence SALES)
Two-person meeting titles follow the pattern "Name and Name" and are typically sales calls.

**Regex Pattern:**
```javascript
// Pattern: "FirstName LastName and FirstName LastName"
// Matches: "Ammara Sajjad and Phil Norris", "Zeel Jadia and Phil Norris"
// Does NOT match: "dev call", "Weekly Meeting", timestamps

const NAME_AND_NAME_PATTERN = /^([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)*)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)*)$/i;
```

**Pattern Rules:**
1. Title starts with a capitalized name (first name, optionally followed by last name)
2. Contains " and " (space-and-space)
3. Ends with another capitalized name
4. Each name can have multiple parts (e.g., "Jamie I.F.", "Phil Norris")
5. Case-insensitive matching

**Examples that MATCH:**
- "Ammara Sajjad and Phil Norris" → SALES
- "Zeel Jadia and Phil Norris" → SALES
- "John Smith and Jamie I.F." → SALES
- "Maria Garcia and Phil Norris" → SALES

**Examples that DO NOT MATCH:**
- "dev call" - No "and" with proper names
- "Weekly AffiliateFinder catchup" - Contains denylist keyword
- "Jan 23, 12:12 PM" - Timestamp format, not names
- "Meeting with John" - Missing second name after "and"

### Classification Logic
```javascript
function classifyCall(title) {
  // 1. NOT_SALES denylist (highest priority)
  if (matchesDenylist(title)) {
    return { classification: 'NOT_SALES', confidence: 95, reason: 'denylist_match' };
  }

  // 2. Name-and-Name pattern (high confidence SALES)
  if (matchesNameAndNamePattern(title)) {
    return { classification: 'SALES', confidence: 90, reason: 'name_and_name_pattern' };
  }

  // 3. Other sales heuristics
  const salesScore = calculateSalesScore(title);
  if (salesScore >= 70) {
    return { classification: 'SALES', confidence: salesScore, reason: 'sales_keywords' };
  }

  // 4. REVIEW_NEEDED fallback
  return { classification: 'REVIEW_NEEDED', confidence: 50, reason: 'no_confident_match' };
}
```

### Acceptance Criteria
- [ ] NOT_SALES denylist patterns are checked FIRST
- [ ] Denylist always overrides Name-and-Name pattern
- [ ] Name-and-Name pattern correctly identifies two-person meeting titles
- [ ] Name-and-Name returns SALES with confidence >= 90
- [ ] REVIEW_NEEDED returned when no pattern matches with confidence
- [ ] Classification result includes: classification, confidence (0-100), reason
- [ ] Timestamps like "Jan 23, 12:12 PM" return REVIEW_NEEDED
- [ ] Unit tests cover all acceptance test fixtures

### Test Fixtures

#### Required Test Cases
| Title | Expected | Reason |
|-------|----------|--------|
| "Ammara Sajjad and Phil Norris" | SALES | name_and_name_pattern |
| "Zeel Jadia and Phil Norris" | SALES | name_and_name_pattern |
| "dev call" | NOT_SALES | denylist_match |
| "Weekly AffiliateFinder catchup" | NOT_SALES | denylist_match |
| "Jan 23, 12:12 PM" | REVIEW_NEEDED | no_confident_match |

#### Additional Test Cases
| Title | Expected | Reason |
|-------|----------|--------|
| "John Smith and Jamie I.F." | SALES | name_and_name_pattern |
| "team meeting" | NOT_SALES | denylist_match |
| "1:1 with Phil" | NOT_SALES | denylist_match |
| "Discovery Call - Acme Corp" | SALES | sales_keywords |
| "Meeting" | NOT_SALES | denylist_match |
| "Phil Norris and John Doe" | SALES | name_and_name_pattern |

### Test Plan

#### Unit Tests
```javascript
// callClassifier.test.js
describe('classifyCall', () => {
  // NOT_SALES denylist tests
  test('dev call → NOT_SALES', () => {
    expect(classifyCall('dev call').classification).toBe('NOT_SALES');
  });
  test('Weekly AffiliateFinder catchup → NOT_SALES', () => {
    expect(classifyCall('Weekly AffiliateFinder catchup').classification).toBe('NOT_SALES');
  });
  test('team meeting → NOT_SALES', () => {
    expect(classifyCall('team meeting').classification).toBe('NOT_SALES');
  });

  // Name-and-Name pattern tests
  test('Ammara Sajjad and Phil Norris → SALES', () => {
    expect(classifyCall('Ammara Sajjad and Phil Norris').classification).toBe('SALES');
  });
  test('Zeel Jadia and Phil Norris → SALES', () => {
    expect(classifyCall('Zeel Jadia and Phil Norris').classification).toBe('SALES');
  });

  // REVIEW_NEEDED tests
  test('Jan 23, 12:12 PM → REVIEW_NEEDED', () => {
    expect(classifyCall('Jan 23, 12:12 PM').classification).toBe('REVIEW_NEEDED');
  });

  // Priority order tests (denylist overrides Name-and-Name)
  test('Denylist keyword in name-like title → NOT_SALES', () => {
    expect(classifyCall('Dev Team and Phil Norris').classification).toBe('NOT_SALES');
  });
});
```

---

## Feature 4: Dashboard & Insights

### Description
Single-page dashboard with tabbed sections for all insights. Conversion rate is the primary metric displayed prominently.

### UI Layout
```
┌─────────────────────────────────────────────────────────────────────┐
│  AffiliateFinder.ai Sales Analyzer        [Sync] [Analyze]  [Admin] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │ 47       │ │ 34%      │ │ 23 min   │ │ Phil: 8  │               │
│  │ Calls    │ │ Conv Rate│ │ Avg Dur  │ │ DFY/mo   │               │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘               │
│                                                                     │
│  Date: [7d ▼] [30d] [90d] [Custom]    Rep: [All ▼]    [Search 🔍]  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [Overview] [Pain Points] [Goals] [Questions] [Objections]   │   │
│  │ [Excitement] [DFY Tracking]                                 │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │                                                             │   │
│  │  Tab Content Area                                           │   │
│  │                                                             │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Navigation Structure
- **Top Nav**: Logo, Sync button, Analyze button, Admin link (if admin)
- **Stats Row**: 4 key metrics
- **Filter Bar**: Date range, Rep filter, Search
- **Tabs**: Overview, Pain Points, Goals, Questions, Objections, Excitement, DFY Tracking

### Stats Cards
| Card | Metric | Calculation |
|------|--------|-------------|
| Calls | Total analyzed calls in date range | COUNT(analyses) |
| Conversion Rate | % of calls that led to Stripe signup | calls_with_signup / total_calls |
| Avg Duration | Average call length | AVG(duration_seconds) / 60 |
| Phil DFY/month | Phil's DFY mentions this month | COUNT(dfy_mentions WHERE rep='Phil') |

### Conversion Funnel Definition
```
Call → Signed Up → Active

- Call: Had an analyzed sales call
- Signed Up: Stripe customer record created (any record = signed up)
- Active: Has active subscription in Stripe

Metrics:
- Call → Signed Up conversion rate
- Signed Up → Active conversion rate
- Call → Active conversion rate (end-to-end)
- Days from first call to signup
```

### Overview Tab Content
- Conversion funnel visualization (3 bars showing Call → Signed → Active)
- Recent calls table (last 10)
- Mini charts: Calls over time, Pain points distribution

### Acceptance Criteria
- [ ] Dashboard loads in under 2 seconds
- [ ] Conversion rate prominently displayed (largest/most visible stat)
- [ ] Date range filter updates all metrics and tabs
- [ ] Rep filter updates all metrics and tabs
- [ ] Tab state preserved when switching tabs
- [ ] Filter state preserved in URL (shareable links)
- [ ] Empty state shown when no calls match filters
- [ ] Stats show "vs last period" comparison

### Test Plan

#### Unit Tests
```javascript
// stats.calculator.test.js
- calculateConversionRate(calls, stripeData): handles 0 calls
- calculateConversionRate(calls, stripeData): correct percentage
- calculateAvgDuration(calls): returns minutes
- calculateDfyMentions(analyses, rep, period): filters correctly
```

#### Integration Tests
```javascript
- GET /api/stats?range=7d → returns correct counts
- GET /api/stats?range=30d&rep=Phil → filters by rep
- Performance test: stats endpoint < 500ms with 1000 calls
```

---

## Feature 5: Pain Points Tab

### Description
Aggregated view of AI-categorized pain points. Categories are dynamically created by the LLM, and admin can merge similar categories.

### Category Management
Since AI auto-categorizes, similar pain points may get different labels (e.g., "Time constraints" vs "Not enough time"). Admin can:
1. View all categories with their counts
2. Merge categories (select multiple → merge into one)
3. Rename categories

### UI Components

#### Pain Points Table
| Column | Description |
|--------|-------------|
| Category | AI-generated or admin-merged name |
| Count | Number of mentions |
| % of Calls | Percentage of calls mentioning this |
| Severity Avg | Average severity (low=1, med=2, high=3) |
| Sample Quote | Most recent quote (truncated) |
| Stripe Conv | Conversion rate for calls with this pain |

#### Category Detail (Expandable Row)
When clicking a category row:
```
┌─────────────────────────────────────────────────────────────┐
│ Manual affiliate outreach (23 mentions)                     │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ "I spend 4 hours a day just finding affiliate emails"  │ │
│ │ — John, Acme Corp (Jan 15) [🟢 Active]     [View Call] │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ "We're doing this all manually right now"              │ │
│ │ — Sarah, TechCo (Jan 12) [🟡 Signed Up]    [View Call] │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

#### Admin: Merge Categories Modal
```
Select categories to merge:
☑ Manual outreach
☑ Spending too much time
☐ Can't find affiliates

Merge into: [Manual affiliate outreach    ]
[Cancel] [Merge Selected]
```

### Data Model
```sql
CREATE TABLE pain_point_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,              -- Display name
  merged_from TEXT,                -- JSON array of original AI labels
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Pain points reference category (or raw AI label if not merged)
-- The pain_points JSON in analyses table stores the raw AI labels
-- We join/map to categories at query time
```

### Acceptance Criteria
- [ ] Pain points grouped by AI-generated category
- [ ] Similar categories can be merged by admin
- [ ] Merged categories show combined count
- [ ] All quotes are verbatim (verify against transcript)
- [ ] Stripe status badge shown for each quote
- [ ] Click "View Call" opens call detail modal
- [ ] Conversion rate calculated per category
- [ ] Sort by: Count (default), Conversion rate, Severity

### Test Plan

#### Unit Tests
```javascript
// painpoint.aggregator.test.js
- aggregateByCategory(analyses): groups correctly
- aggregateByCategory(analyses): handles merged categories
- calculateCategoryConversion(category, stripeData): correct %

// category.service.test.js
- mergeCategories([ids], newName): updates all references
- mergeCategories([ids], newName): preserves original labels
```

#### Integration Tests
```javascript
- GET /api/insights/pain-points → returns aggregated categories
- POST /api/admin/categories/merge → merges and recalculates
```

---

## Feature 6: Goals Tab

### Description
Aggregated view of prospect goals extracted from calls.

### UI Components

#### Goals Table
| Column | Description |
|--------|-------------|
| Goal | Summarized goal |
| Priority | Primary/Secondary |
| Count | Times mentioned |
| Timeframe | Common timeframes (if mentioned) |
| Sample Quote | Representative quote |
| Stripe Conv | Conversion rate |

#### Goal Detail (Expandable)
- All quotes for this goal
- Associated calls with Stripe status
- "X% of prospects with this goal signed up"
- "Avg time to signup: X days"

### Acceptance Criteria
- [ ] Goals extracted only from prospect statements
- [ ] Similar goals grouped by semantic similarity
- [ ] Primary vs secondary priority tracked
- [ ] Timeframes extracted when mentioned
- [ ] Stripe correlation calculated per goal
- [ ] Filter by date range, priority

---

## Feature 7: Questions Tab

### Description
All questions prospects asked, categorized by the 10 fixed topics.

### UI Components

#### Questions Summary
```
Most asked topic: Competitor Affiliates (34%)
Questions from prospects who signed up: 67%
```

#### Questions by Topic (Bar Chart)
Visual showing distribution across 10 topics

#### Questions Table
| Column | Description |
|--------|-------------|
| Question | Verbatim question text |
| Topic | One of 10 categories |
| Answered | Yes/No |
| Call | Call title (link) |
| Prospect | Name, Company |
| Stripe | Status badge |
| Signal | Buying signal strength |

### Topic Definitions
1. **affiliate_growth** - Growing affiliate program
2. **competitor_affiliates** - Finding competitor affiliates
3. **email_outreach** - Email automation questions
4. **affiliate_volume** - How many we can find
5. **pricing** - Cost questions
6. **implementation** - Setup/onboarding
7. **support** - Help/training
8. **integrations** - Other tool connections
9. **results** - Expected outcomes
10. **other** - Uncategorized

### Acceptance Criteria
- [ ] Questions extracted verbatim
- [ ] Only prospect questions (not rep)
- [ ] Categorized into 10 fixed topics
- [ ] "Answered" status from call context
- [ ] Buying signal strength indicated
- [ ] Filter by topic, answered status
- [ ] Sort by date, topic, signal strength

---

## Feature 8: Objections Tab

### Description
Track what prospects objected to or expressed concerns about.

### UI Components

#### Objection Categories Summary
Cards showing: Price, Time, Trust, Fit, Timing, Other
Each with: Count, % resolved, conversion rate

#### Objections Table
| Column | Description |
|--------|-------------|
| Objection | Summary |
| Category | One of 6 types |
| Quote | Verbatim |
| Resolved | In-call resolution status |
| Call | Link |
| Outcome | Stripe status |

### Acceptance Criteria
- [ ] Objections categorized (price/time/trust/fit/timing/other)
- [ ] Resolution status tracked
- [ ] Stripe outcome correlation shown
- [ ] Filter by category, resolution, outcome

---

## Feature 9: Excitement Tab

### Description
Track what got prospects excited during calls.

### UI Components

#### Intensity Distribution (Donut)
Mild / Moderate / Strong breakdown

#### Top Triggers
Ranked list with conversion rates:
- "Time savings" → 45 mentions → 82% signed up
- "Competitor analysis" → 32 mentions → 71% signed up

#### Excitement Table
| Column | Description |
|--------|-------------|
| Trigger | What excited them |
| Quote | Verbatim excited reaction |
| Intensity | Mild/Moderate/Strong |
| Call | Link |
| Outcome | Stripe status |

### Excitement Detection
Primary trigger (per user interview): **Time savings**
LLM should look for:
- Expressions of relief about time saved
- Positive reactions to automation
- "That would be amazing" type language
- Enthusiastic questions about specific features

### Acceptance Criteria
- [ ] Excitement detected from language/tone
- [ ] Intensity classified (mild/moderate/strong)
- [ ] Time savings highlighted as key trigger
- [ ] Conversion correlation calculated
- [ ] Filter by intensity, date range

---

## Feature 10: DFY Tracking Tab

### Description
Track when reps (especially Phil) pitched the DFY agency service.

### UI Components

#### DFY Summary Stats
```
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│ 47        │ │ 31        │ │ 18        │ │ 9         │ │ 4         │
│ Total DFY │ │ By Phil   │ │ Justified │ │ Avoidable │ │ Premature │
└───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘

DFY Pitch → Signup: 42%
```

#### DFY Mentions Table
| Column | Description |
|--------|-------------|
| Call | Call title link |
| Date | Call date |
| Rep | Who mentioned DFY |
| Initiated By | Rep or Prospect |
| When | Early/Middle/Late in call |
| Classification | Justified/Avoidable/Premature |
| Reasoning | LLM's reasoning |
| Outcome | Stripe status |

#### Phil-Specific Filter
Toggle to show only Phil's calls for DFY analysis

#### Classification Guide (Collapsible)
Show the criteria for justified/avoidable/premature

### Acceptance Criteria
- [ ] DFY mentions detected accurately
- [ ] Who initiated (rep vs prospect) tracked
- [ ] Classification matches defined criteria
- [ ] LLM provides reasoning for each classification
- [ ] Phil filter shows Phil-only data
- [ ] Trend over time visible (Phil's DFY rate)
- [ ] Click to see transcript context

---

## Feature 11: Stripe Integration

### Description
Connect to Stripe to enrich calls with subscription outcomes.

### Matching Logic (Current Implementation)
1. **Email Exact Match (primary)**: Prospect email from call = Stripe customer email (highest confidence)
2. **Domain Match (fallback)**: Company domain matches Stripe customer email domain (medium confidence)
   - Excludes common providers: gmail.com, yahoo.com, hotmail.com, etc.
   - Limited to most recent 100 Stripe customers
3. **Name Match (lowest priority)**: Prospect name fuzzy matches Stripe customer name
   - Limited to most recent 100 Stripe customers
   - Higher false positive rate
4. **Manual match**: Admin can manually link unmatched records (not yet implemented)

**Data Extracted from Stripe Customers:**
- `email` - Customer email address
- `name` - Customer name (from checkout)
- `id` - Stripe customer ID
- `created` - Signup date (customer creation)

**Data Extracted from Stripe Subscriptions:**
- `status` - active, trialing, past_due, canceled
- `start_date` - Subscription start
- `canceled_at` - Cancellation date
- `items.data[0].price` - Plan/pricing info
- MRR calculation

**Known Limitations:**
- Stripe `metadata`, `phone`, `address`, `description` fields not used
- Domain/name matching limited to 100 most recent customers
- No website or brand name matching

### Handling Multiple Contacts
- Group prospects by company/email domain
- Link all contacts from same company to same Stripe account
- "First call to signup" = first call from any contact at that company

### Status Definitions
| Status | Stripe Condition | Badge |
|--------|-----------------|-------|
| Active | Has active subscription | 🟢 |
| Signed Up | Customer exists, no active subscription | 🟡 |
| Churned | Subscription cancelled (use cancel request date) | 🔴 |
| Never Signed | No Stripe customer found | ⚪ |

### UI Location
- **Admin**: `/admin/integrations` - Stripe config
- **Throughout**: Status badges on calls/quotes

### UI Components

#### Stripe Configuration (Admin)
```
Stripe Integration
──────────────────
API Key: sk_live_••••••••••••ab3f [Update]
Mode: 🟢 Live
Status: ✓ Connected

Last Sync: Jan 25, 2025 2:30 PM
Customers Matched: 89/124 (72%)

[Sync Customers]  [View Unmatched]
```

#### Unmatched Customers Modal
```
┌─────────────────────────────────────────────────────────────┐
│ Unmatched Prospects (35)                                    │
├─────────────────────────────────────────────────────────────┤
│ Prospect              Stripe Customer (select)              │
│ ─────────────────────────────────────────────────────────── │
│ John @ acme.com       [Select Stripe customer... ▼]        │
│ Sarah @ tech.io       [cus_abc123 - sarah@tech.io  ▼]      │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

### Data Model
```sql
CREATE TABLE stripe_customers (
  id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  email TEXT,
  name TEXT,
  company_domain TEXT,            -- Extracted from email
  created_at DATETIME,            -- Stripe customer created
  subscription_status TEXT,       -- none|active|cancelled|past_due
  subscription_start DATETIME,
  cancel_requested_at DATETIME,   -- When they clicked cancel
  subscription_end DATETIME,      -- When subscription actually ends
  mrr_cents INTEGER,
  plan_name TEXT,
  lifetime_value_cents INTEGER,
  last_synced DATETIME
);

CREATE TABLE prospect_stripe_match (
  prospect_email TEXT,
  prospect_company TEXT,
  stripe_customer_id TEXT REFERENCES stripe_customers(stripe_customer_id),
  match_method TEXT,              -- email|domain|manual
  matched_at DATETIME
);

CREATE INDEX idx_stripe_email ON stripe_customers(email);
CREATE INDEX idx_stripe_domain ON stripe_customers(company_domain);
```

### Acceptance Criteria
- [ ] Stripe API key stored encrypted
- [ ] Email matching (exact)
- [ ] Domain matching (fallback)
- [ ] Manual matching UI for unmatched
- [ ] Status badges appear on all calls/quotes
- [ ] Churn date = cancel request date (not subscription end)
- [ ] "Days from call to signup" calculated from first call
- [ ] Conversion funnel: Call → Signed Up → Active
- [ ] Sync handles rate limits
- [ ] Admin can trigger manual sync

### Test Plan

#### Unit Tests
```javascript
// stripe.service.test.js
- fetchCustomers(): parses subscription status correctly
- extractDomain(email): returns domain portion
- matchByEmail(prospects, customers): exact match
- matchByDomain(prospects, customers): fallback match

// conversion.calculator.test.js
- calculateDaysToSignup(calls, signup): uses first call
- calculateConversionRate(calls, customers): correct funnel
- getChurnDate(subscription): returns cancel_requested_at
```

#### Integration Tests
```javascript
- POST /api/stripe/sync → imports customers
- GET /api/stripe/unmatched → returns unmatched prospects
- POST /api/stripe/match → manual match saved
```

---

## Feature 12: Call Detail View

### Description
Full analysis view for a single call, opened as a modal from anywhere.

### UI Components

#### Modal Layout
```
┌─────────────────────────────────────────────────────────────────────┐
│ [×]  Phil - Acme Corp Discovery                        Jan 15, 2025 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────┐  ┌────────────────────────────────────────┐ │
│  │ Prospect           │  │ 🟢 Active Customer                     │ │
│  │ John Smith         │  │ Signed up: Jan 18 (3 days after call)  │ │
│  │ CEO @ Acme Corp    │  │ Plan: Pro ($99/mo)                     │ │
│  │ E-commerce         │  │ MRR: $99                               │ │
│  └────────────────────┘  └────────────────────────────────────────┘ │
│                                                                     │
│  Duration: 34 min    Deal Likelihood: High    Quality: Normal       │
│                                                                     │
│  Summary:                                                           │
│  John is looking to scale his affiliate program. Currently doing    │
│  manual outreach and spending 4+ hours daily. Very interested in    │
│  automation features and competitor analysis.                       │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  [Pain Points] [Goals] [Questions] [Objections] [Excitement] [DFY]  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Pain Point: Manual outreach taking too long                     ││
│  │ "I spend 4 hours a day just finding and emailing affiliates"    ││
│  │ Severity: High                                                  ││
│  │                                                                 ││
│  │ Pain Point: Can't find competitor affiliates                    ││
│  │ "We have no idea who's promoting our competitors"               ││
│  │ Severity: Medium                                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  [View Full Transcript]  [Re-analyze]  [Export]                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Full Transcript View
- Searchable transcript text
- Speaker labels (Rep: / Prospect:)
- Search box with highlight matching
- Jump to DFY mentions

### Acceptance Criteria
- [ ] Opens as modal from any call link
- [ ] Shows all analysis data in tabs
- [ ] Stripe status and timeline visible
- [ ] Days from call to signup shown
- [ ] Full transcript searchable
- [ ] DFY mentions linkable in transcript
- [ ] Export single call as CSV
- [ ] Re-analyze button triggers new analysis

---

## Feature 13: Search & Filtering

### Description
Full-text search within transcripts and global filtering.

### Search Implementation
Using SQLite FTS5 for full-text search:

```sql
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  title,
  raw_transcript,
  prospect_name,
  prospect_company,
  content='transcripts',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER transcripts_ai AFTER INSERT ON transcripts BEGIN
  INSERT INTO transcripts_fts(rowid, title, raw_transcript, prospect_name, prospect_company)
  VALUES (new.rowid, new.title, new.raw_transcript, new.prospect_name, new.prospect_company);
END;
```

### UI Components

#### Search Bar (Header)
```
┌─────────────────────────────────────────┐
│ 🔍 Search calls, transcripts...         │
└─────────────────────────────────────────┘
```

#### Search Results Dropdown
```
┌─────────────────────────────────────────────┐
│ Results for "affiliate outreach"            │
├─────────────────────────────────────────────┤
│ 📞 Phil - Acme Corp Discovery               │
│    "...spend hours on affiliate outreach..."│
│    Jan 15, 2025                             │
├─────────────────────────────────────────────┤
│ 📞 Jamie - TechCo Demo                      │
│    "...automate our affiliate outreach..."  │
│    Jan 12, 2025                             │
└─────────────────────────────────────────────┘
```

### Filter Bar (All Pages)
- **Date Range**: 7d, 30d, 90d, Custom
- **Rep**: All, Phil, [Other reps]
- **Stripe Status**: All, Active, Signed Up, Churned, Never Signed

### Acceptance Criteria
- [ ] Full-text search in transcripts
- [ ] Search highlights matched terms
- [ ] Results show preview snippet
- [ ] Click result opens call detail
- [ ] Filters persist in URL
- [ ] Filter + search combine correctly
- [ ] Search debounced (300ms)
- [ ] Results in under 500ms

---

## Feature 14: Export

### Description
Export data as CSV for spreadsheet analysis.

### Export Options
1. **Calls Export**: One row per call
2. **Pain Points Export**: One row per pain point
3. **Questions Export**: One row per question
4. **DFY Export**: One row per DFY mention

### UI Components

#### Export Button (Header)
Opens modal with options:
```
┌─────────────────────────────────────────┐
│ Export Data                             │
├─────────────────────────────────────────┤
│ What to export:                         │
│ ○ Calls (summary per call)              │
│ ○ Pain Points (all quotes)              │
│ ○ Questions (all questions)             │
│ ○ DFY Mentions (all DFY data)           │
│                                         │
│ Date range: [Current filter: 30d    ▼]  │
│ Rep: [Current filter: All           ▼]  │
│                                         │
│ [Cancel]  [Download CSV]                │
└─────────────────────────────────────────┘
```

### CSV Schemas

#### Calls Export
```csv
call_id,date,rep,prospect_name,prospect_company,duration_min,pain_points_count,goals_count,questions_count,objections_count,dfy_mentions,deal_likelihood,stripe_status,days_to_signup
```

#### Pain Points Export
```csv
call_id,date,rep,prospect,company,category,quote,severity,stripe_status
```

#### Questions Export
```csv
call_id,date,rep,prospect,company,question,topic,answered,buying_signal,stripe_status
```

#### DFY Export
```csv
call_id,date,rep,prospect,company,initiated_by,classification,reasoning,stripe_status
```

### Acceptance Criteria
- [ ] CSV downloads correctly
- [ ] Respects current filters
- [ ] Includes all relevant columns
- [ ] Handles special characters (quotes, commas)
- [ ] Large exports (1000+ rows) work

---

## Feature 15: Admin Settings

### Description
Configuration for integrations, LLM provider, and system settings.

### UI Location
- **Page**: `/admin` (Admin role only)

### UI Sections

#### Integrations
- Fireflies API key + test
- Stripe API key + test
- Connection status indicators

#### LLM Settings
```
AI Analysis Provider
────────────────────
Provider: [OpenAI GPT-5 Nano ▼]
          - OpenAI GPT-5 Nano (default)
          - OpenAI GPT-5 Mini
          - OpenAI GPT-4o
          - OpenAI GPT-4o-mini
          - OpenAI GPT-4 Turbo
          - OpenAI GPT-3.5 Turbo
          - Anthropic Claude

API Key: ••••••••••••••ab3f  [Update]
Status: ✓ Connected

[Test with Selected Model]  ← Tests API key + model validity

Max Concurrent Analyses: [3 ▼]

Token Usage This Month: 1.2M tokens (~$18)
```

#### User Management
(Covered in Feature 1)

### Acceptance Criteria
- [ ] Only admin can access /admin
- [ ] API keys stored encrypted
- [ ] Can switch LLM provider
- [ ] Settings changes take effect immediately
- [ ] Token/cost tracking displayed

---

## Feature 16: Changelog

### Description
Admin-publishable changelog for product updates. Allows admins to create, edit, and publish changelog entries that all users can view.

### UI Location
- **Page**: `/admin/changelog.html`
- **Navigation**: User dropdown menu > Changelog (below Settings, visible to all users)

### UI Components

#### Changelog Page (All Users)
```
Changelog
Product updates and improvements
────────────────────────────────

[Search...]  [All] [New] [Improvement] [Fix]

┌─────────────────────────────────────────────────┐
│ New Dashboard Analytics    [NEW] [🔥 NEW]      │
│ January 27, 2026                               │
│                                                │
│ • Added new dashboard metrics                  │
│ • Improved chart performance                   │
│ • Fixed date range selector                    │
│                                                │
│ [Edit] [Publish/Unpublish] (admin only)       │
└─────────────────────────────────────────────────┘
```

#### Admin Create Form
```
Create New Entry
────────────────
Title*: [___________________________]
Tag:    [New ▼]  (New/Improvement/Fix)
Summary* (bullet points):
[- Feature 1                        ]
[- Feature 2                        ]

Details (optional):
[Additional context here...         ]

Show as "New" until: [2026-02-15]
Publish: [○ Draft  ● Published]

[Save Entry] [Clear]
```

### Data Model
```sql
CREATE TABLE changelog_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  tag TEXT CHECK (tag IN ('new', 'improvement', 'fix')),
  is_published INTEGER NOT NULL DEFAULT 0,
  show_as_new_until DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME
);
```

### API Endpoints
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | /api/changelog | Auth | Get published entries |
| GET | /api/changelog/all | Admin | Get all entries including drafts |
| GET | /api/changelog/:id | Auth | Get single entry |
| POST | /api/changelog | Admin | Create entry |
| PUT | /api/changelog/:id | Admin | Update entry |
| DELETE | /api/changelog/:id | Admin | Delete entry |
| POST | /api/changelog/:id/publish | Admin | Publish draft |
| POST | /api/changelog/:id/unpublish | Admin | Unpublish entry |

### Acceptance Criteria
- [x] Menu item appears below Settings in dropdown (all users)
- [x] Non-admin sees only Published entries
- [x] Admin can create draft, publish, then visible to non-admin
- [x] Entries persist across reload
- [x] XSS prevention on all inputs
- [x] Search filters by title/summary
- [x] Tag filters work correctly
- [x] "New" badge shows until show_as_new_until date

---

## Database Schema (Complete)

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rep',  -- admin|rep
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

-- Magic Links
CREATE TABLE magic_links (
  token TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  expires_at DATETIME NOT NULL,
  used_at DATETIME
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transcripts
CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  fireflies_id TEXT UNIQUE,
  title TEXT NOT NULL,
  call_date DATETIME NOT NULL,
  duration_seconds INTEGER,
  participants TEXT,
  raw_transcript TEXT,
  speaker_timeline TEXT,
  sales_rep TEXT,
  prospect_name TEXT,
  prospect_company TEXT,
  prospect_email TEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  analysis_status TEXT DEFAULT 'pending',
  archived_at DATETIME
);

-- Full-text search
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  title, raw_transcript, prospect_name, prospect_company,
  content='transcripts', content_rowid='rowid'
);

-- Analyses
CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  transcript_id TEXT REFERENCES transcripts(id),
  llm_provider TEXT,
  llm_model TEXT,
  raw_response TEXT,
  prospect_profile TEXT,
  pain_points TEXT,
  goals TEXT,
  questions_asked TEXT,
  objections TEXT,
  excitement_triggers TEXT,
  dfy_mentions TEXT,
  call_summary TEXT,
  call_quality TEXT,
  deal_likelihood TEXT,
  next_steps TEXT,
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  tokens_used INTEGER,
  cost_cents INTEGER
);

-- Pain Point Categories (for admin merging)
CREATE TABLE pain_point_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  merged_from TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Stripe Customers
CREATE TABLE stripe_customers (
  id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  email TEXT,
  name TEXT,
  company_domain TEXT,
  created_at DATETIME,
  subscription_status TEXT,
  subscription_start DATETIME,
  cancel_requested_at DATETIME,
  subscription_end DATETIME,
  mrr_cents INTEGER,
  plan_name TEXT,
  lifetime_value_cents INTEGER,
  last_synced DATETIME
);

-- Prospect-Stripe Matching
CREATE TABLE prospect_stripe_match (
  prospect_email TEXT,
  prospect_company TEXT,
  stripe_customer_id TEXT,
  match_method TEXT,
  matched_at DATETIME,
  PRIMARY KEY (prospect_email, stripe_customer_id)
);

-- Settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_transcripts_date ON transcripts(call_date DESC);
CREATE INDEX idx_transcripts_rep ON transcripts(sales_rep);
CREATE INDEX idx_transcripts_status ON transcripts(analysis_status);
CREATE INDEX idx_analyses_transcript ON analyses(transcript_id);
CREATE INDEX idx_stripe_email ON stripe_customers(email);
CREATE INDEX idx_stripe_domain ON stripe_customers(company_domain);
```

---

## API Structure

```
/api
├── /auth
│   ├── POST /magic-link          # Request magic link
│   ├── GET  /verify              # Verify magic link token
│   ├── POST /logout              # End session
│   └── GET  /me                  # Get current user
│
├── /sync
│   ├── POST /                    # Trigger Fireflies sync
│   └── GET  /status              # Get sync progress
│
├── /analyze
│   ├── POST /                    # Trigger analysis for pending calls
│   ├── POST /:id                 # Re-analyze single call
│   └── GET  /status              # Get analysis progress
│
├── /calls
│   ├── GET  /                    # List calls (with filters)
│   ├── GET  /:id                 # Get single call with analysis
│   └── GET  /stats               # Get aggregated stats
│
├── /insights
│   ├── GET  /pain-points         # Aggregated pain points
│   ├── GET  /goals               # Aggregated goals
│   ├── GET  /questions           # Aggregated questions
│   ├── GET  /objections          # Aggregated objections
│   ├── GET  /excitement          # Aggregated excitement
│   └── GET  /dfy                 # DFY tracking data
│
├── /stripe
│   ├── POST /sync                # Sync Stripe customers
│   ├── GET  /unmatched           # Get unmatched prospects
│   └── POST /match               # Manual match
│
├── /export
│   └── POST /                    # Export data as CSV
│
├── /search
│   └── GET  /                    # Full-text search
│
└── /admin
    ├── GET  /users               # List users
    ├── POST /users               # Invite user
    ├── PUT  /users/:id           # Update user
    ├── GET  /settings            # Get settings
    ├── PUT  /settings            # Update settings
    └── POST /categories/merge    # Merge pain point categories
```

---

## Implementation Phases

### Phase 1: Foundation
1. Authentication (magic link)
2. Fireflies sync (90 days history)
3. Basic dashboard UI
4. SQLite database setup

### Phase 2: Analysis
5. LLM integration (Claude + GPT-4)
6. Analysis service with product context
7. Call detail view
8. Overview tab with stats

### Phase 3: Insights
9. Pain Points tab with category merge
10. Goals tab
11. Questions tab
12. Objections tab
13. Excitement tab

### Phase 4: DFY & Stripe
14. DFY Tracking tab
15. Stripe integration
16. Customer matching
17. Conversion funnel

### Phase 5: Polish
18. Full-text search
19. CSV export
20. Admin settings
21. Comprehensive testing

---

## Testing Strategy

### Coverage Target: 85%

### Unit Tests (Jest)
- All service functions
- Data transformers
- Calculation utilities
- LLM prompt builders

### Integration Tests (Jest + Supertest)
- All API endpoints
- Database operations
- External API mocking (Fireflies, Stripe, LLM)

### E2E Tests (Playwright)
- Complete user flows
- Authentication
- Sync → Analyze → View → Export workflow
- Admin operations

### Test Files Structure
```
/tests
├── /unit
│   ├── auth.service.test.js
│   ├── fireflies.service.test.js
│   ├── analyzer.service.test.js
│   ├── stripe.service.test.js
│   ├── stats.calculator.test.js
│   └── ...
├── /integration
│   ├── auth.routes.test.js
│   ├── sync.routes.test.js
│   ├── calls.routes.test.js
│   └── ...
└── /e2e
    ├── auth.spec.js
    ├── dashboard.spec.js
    ├── analysis.spec.js
    └── export.spec.js
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from sync to insights | < 5 min (sync + analysis) |
| Analysis accuracy | > 90% relevant extraction |
| Page load time | < 2 seconds |
| Search response time | < 500ms |
| LLM cost per call | < $0.50 |
| Test coverage | > 85% |

---

## Appendix

### Glossary
- **DFY**: Done-For-You (agency service offering)
- **MRR**: Monthly Recurring Revenue
- **LTV**: Lifetime Value
- **FTS**: Full-Text Search

### Key Configuration Values
- Magic link expiry: 60 minutes
- Session duration: 30 days
- Transcript retention: 6 months
- Max concurrent analyses: 3
- Initial sync range: 90 days
- Search debounce: 300ms
- Allowed email domain: @affiliatefinder.ai only
- Rate limits: 5 login attempts per 15 min, 10 token verifications per 5 min, 3 access requests per hour

---

## Implementation Status (Audit: 2026-01-26)

### Feature Implementation Matrix

| PRD # | Feature | Status | Evidence | Notes |
|-------|---------|--------|----------|-------|
| 1 | Authentication & Access | Working | Routes: 17 endpoints, 89 tests | Magic link flow complete |
| 2 | Fireflies Transcript Sync | Working | Routes: 5 endpoints, 22+ tests | Includes rep filter |
| 3 | AI-Powered Call Analysis | Working | Routes: 16 endpoints, 32 tests | Claude + GPT-4 supported |
| 3B | Call Classification | Working | 47 tests | SALES/NOT_SALES/REVIEW_NEEDED |
| 4 | Dashboard & Insights | Working | Routes: 7 endpoints, 34 tests | Card grid (not tabs) |
| 5 | Pain Points Tab | Working | Endpoint + aggregation | Combined in dashboard |
| 6 | Goals Tab | Working | Endpoint + aggregation | Combined in dashboard |
| 7 | Questions Tab | Working | Endpoint + aggregation | Combined in dashboard |
| 8 | Objections Tab | Working | Endpoint + aggregation | Named "dislikes" in code |
| 9 | Excitement Tab | Working | Endpoint + aggregation | Combined in dashboard |
| 10 | DFY Tracking Tab | Working | 8 endpoints, 119 tests | Dedicated phil.html page with Quality view |
| 11 | Stripe Integration | Working | 6 endpoints, 53 tests | Email exact → Domain → Name fallback |
| 12 | Call Detail View | Working | call.html with analysis tabs | Full analysis display |
| 13 | Search & Filtering | Working | 3 endpoints, 49 tests | FTS4 with Porter stemmer |
| 14 | Export | Partial | Markdown + Closing Rate CSV | Dashboard CSV remaining |
| 15 | Admin Settings | Partial | 15+ endpoints, 66 tests | Missing token/cost display |
| 17 | Lead Quality | Working | lead-quality.html + services | Pre/post-call scoring, Perplexity research, transcript analysis |

### PRD Drift Notes

1. **Dashboard Layout**: PRD specifies tabbed layout; implementation uses card grid with ranked lists. Both approaches valid, actual is simpler.

2. **Insight Tabs**: PRD shows separate tab pages; implementation combines all into single dashboard.html with cards. This is a UX simplification.

3. **Export Format**: PRD specifies CSV; implementation has Markdown export only. CSV export is the main remaining gap.

4. **Additional Features Built** (not in original PRD):
   - Insight Snapshot Generator with Notion/Slack export
   - Founder Closing Rate page (founder.html) with multi-rep support (Phil, Jamie, All) and CSV export
   - Bulk Actions (delete/analyze multiple calls)
   - Rep Filter for Fireflies sync
   - Duration auto-format (MM:SS vs HH:MM:SS)
   - Slack Lifecycle Event Ingestion (slackIngestionService.js) - second data source for signup detection
   - Unified date preset dropdowns across all pages (Dashboard style)
   - Rep column in Closing Rate with color-coded badges (Phil=Yellow, Jamie=Pink)
   - **Lead Quality page** (lead-quality.html) with Calendly integration, Perplexity research, and transcript analysis

### Test Summary

- **Total Tests**: 850+ passing
- **Test Files**: 29+
- **Key Coverage**: authService 95%, dashboardAggregation 97%, dfyPitchService 98%, dfyQualificationService 98%, insightSnapshotService 98%

---

*Document Version: 2.5*
*Last Updated: 2026-01-28*
*Implementation Audit: 2026-01-28*
*Product: AffiliateFinder.ai Sales Call Analyzer*

### Latest Changes (2026-01-28)
- **Lead Quality Detail Panel Enhancements**:
  - Added lead name to transcript analysis modal title
  - Added LinkedIn profile link section (extracted from Perplexity research)
  - Added analysis metadata showing date/time and model used
  - Added link to full transcript in Calls tab
  - Improved research sources URL display (URL-decoded, truncated)
  - Added linkedin_url column to database schema with migration
  - Fixed dropdown menu in lead-quality.html (added Changelog and Admin sections)
  - **NEW: Perplexity Research Results display** - Shows company_info, person_info, affiliate_signals with expandable raw response

- **DFY Routes PostgreSQL Fix**:
  - Fixed `/api/dfy/phil`, `/api/dfy/summary`, `/api/dfy/quality` endpoints
  - Migrated from raw `db.exec()` (SQLite-only) to `dbAdapter.query()` (PostgreSQL compatible)
  - Routes now work correctly on Railway (PostgreSQL) environment

- **Closing Rate "Not Matched" Status**:
  - Root cause: `stripe_data` column is NULL - enrichment pipeline not yet executed
  - Fix: Click "Refresh" button on founder.html to run Stripe/Slack enrichment
  - Requires: Stripe API configured with customer data for matching
  - Matching cascade: Email exact → Domain fallback → Name fallback

- **Railway Deployment**:
  - Added `nixpacks.toml` to disable cache mounts (fixes EBUSY errors)
  - Added `.npmrc` to redirect npm cache to `/tmp/npm-cache`

### Previous Changes (2026-01-26)
- Added Slack lifecycle event ingestion as second data source for signup detection
- Combined Stripe + Slack data in Founder Snapshot (Stripe priority, Slack fallback)
- Added multi-rep support (Phil, Jamie, All) to Founder Closing Rate
- Added Rep column with color-coded badges to Closing Rate page
- Added CSV export to Closing Rate page (Export CSV button, respects filters, UTF-8 with BOM)
- Added Refresh button to Insights Dashboard (syncs new calls from Fireflies, analyzes pending, reloads data)
- Simplified Export to Markdown only (removed Snapshot modal and Slack export)
- Improved filter bar layout with buttons inline with filters
- Unified date preset dropdowns across all pages (Dashboard style)
- **Phil DFY Quality Tab Redesign**: Complete overhaul of Phil DFY tab into "Sales Quality" view:
  - New dfyQualificationService.js extracting 15+ fields per call
  - KPI strip with 6 metrics, DFY quality funnel, call list table
  - Call drilldown with evidence quotes and transcript highlighting
  - Score threshold 3+, proposal without discovery = risky, $1,000 budget minimum
  - 61 new tests (48 unit, 13 integration)
- **Copy - Customer Language Intelligence Page**: Complete redesign of Dashboard into "Copy" page:
  - Renamed from "Dashboard" to "Copy" with subheader "Customer Language Intelligence across analyzed calls"
  - New 8-section information architecture (see below for details)
  - Context drawer with transcript highlighting and fuzzy matching
  - Label normalization to reduce generic buckets
  - 14 new tests (all passing)

---

## Copy - Customer Language Intelligence

### Overview
The Copy page (formerly Dashboard) provides a premium, founder-ready view of customer language intelligence extracted from sales calls. It replaces the previous card grid with 8 clear analysis sections organized for copywriting and marketing use.

### Navigation
- **URL**: `/admin/copy.html`
- **Nav Label**: "Copy"
- **Old Dashboard**: Redirects to Copy page, navigation updated across all pages

### The 8 Analysis Sections

| # | Section | Description | Data Source |
|---|---------|-------------|-------------|
| 1 | **Pain Points** | Challenges & frustrations prospects mention | `insights.pains` |
| 2 | **Goals** | Desired outcomes & wins prospects want to achieve | `insights.goals` |
| 3 | **Wording** | Exact language used (Industry Terms, Colloquial Problem Language, Power Words) | Future enrichment |
| 4 | **Metaphors & Analogies** | Figurative language prospects use to describe their situation | Future enrichment |
| 5 | **Emotional Triggers** | Emotion map derived from dislikes | `insights.dislikes.emotions` |
| 6 | **Customer Questions** | Questions prospects ask during calls | `insights.questions` |
| 7 | **Positive Reactions** | All positive emotional responses from prospects | `insights.excitement_triggers` |
| 8 | **Objections & Criticism** | Skepticism, resistance, disappointment (grouped with type badges) | `insights.dislikes` |

### Item Structure
Each insight item displays:
- **Rank indicator**: Numbered badge (top 3 highlighted with primary color)
- **Label/Title**: Normalized, human-readable label
- **Quote snippet**: Exact customer words (truncated to 120 chars)
- **Source call reference**: Call title + date + rep name
- **Mentions count**: Number of times mentioned
- **Calls count**: Number of distinct calls

### Context Drawer
Clicking any item opens a right-side drawer showing:
- **Full quote**: Complete untruncated quote
- **Source call metadata**: Title, date, rep
- **Transcript context**: ~10 lines before and after the quote
- **Fuzzy match indicator**: "[~] closest match" when exact match fails
- **"Open in Transcript" button**: Opens call.html with quote highlighted

### Transcript Highlighting
The call detail page (`call.html`) now accepts a `highlight` URL parameter:
- Exact matching: Finds and highlights exact quote in transcript
- Fuzzy matching: 60% word match threshold with "[~]" indicator
- Smooth scroll to highlighted line

### Label Normalization
Client-side processing improves generic labels:
- **Known rewrites**: "Manual Time Sink" -> "Time Wasted on Manual Outreach"
- **Generic detection**: Labels like "Other", "General", "Miscellaneous"
- **Quote extraction**: Generates better labels from quote keywords when possible
- **"Needs review" badge**: Marks items that couldn't be improved

### Objection Type Badges
Objections display colored type badges:
- **Price**: Red badge (price/cost/expensive)
- **Trust**: Orange badge (trust/skeptic/doubt)
- **Complexity**: Blue badge (complex/difficult/confusing)
- **Time**: Purple badge (time/busy/later)

### KPI Strip
Compact row showing key metrics:
- Calls analyzed
- Pain Points count
- Goals count
- Questions count
- Objections count

### Export
The "Export MD" button remains unchanged - same label, placement, behavior, and styling as before.

---

## Lead Quality Feature

### Overview
The Lead Quality page (`/admin/lead-quality.html`) provides pre-call research and post-call transcript analysis for Calendly-scheduled leads. It helps sales reps prepare for calls with AI-powered research and evaluate lead quality after calls.

### Navigation
- **URL**: `/admin/lead-quality.html`
- **Nav Label**: "Lead Quality"

### Lead Quality Scoring System
Each lead is scored on four dimensions (0-100 scale):
| Dimension | Description |
|-----------|-------------|
| **Company Strength** | Business viability, market presence, team size |
| **Affiliate Readiness** | Existing affiliate program, experience level |
| **Buyer Authority** | Decision-making power, role/title |
| **Inbound Quality** | How they found us, intent signals |

### Pre-Call Research (Perplexity API)
Automated research runs for upcoming calls, extracting:
- **Company Info**: Name, website, industry, size, revenue signals
- **Affiliate Signals**: Existing program, competitor affiliates, readiness indicators
- **Person Info**: Role, LinkedIn URL, authority signals
- **Research Sources**: URLs used for research (displayed with clean formatting)

### Post-Call Transcript Analysis
After calls complete, transcripts can be analyzed using:
- **GPT-5-nano**: Fast, cost-effective analysis (default)
- **Perplexity Sonar**: Alternative model option

Analysis extracts:
- Pain points mentioned
- Goals discussed
- Buying signals
- Objections raised
- Overall lead quality assessment

### Detail Panel Features
The right-side detail panel shows:

1. **Lead Information**
   - Name, email, company
   - Calendly event details (scheduled time, duration)
   - Pre-call score breakdown

2. **LinkedIn Profile** (NEW)
   - Direct link to prospect's LinkedIn profile
   - Extracted from Perplexity research data
   - Styled with LinkedIn brand color (#0077b5)

3. **Research Sources**
   - URLs used for Perplexity research
   - Clean display (URL-decoded, truncated for readability)
   - Clickable links to sources

4. **Transcript Analysis** (for past calls)
   - Full analysis results with expandable sections
   - **Analysis Info section** showing:
     - Date/time when analysis was performed
     - Model used for analysis (GPT-5-nano or Perplexity Sonar)
   - **Transcript link**: Direct link to view full transcript in Calls tab

5. **Post-Call Score**
   - Updated quality assessment after transcript analysis
   - Comparison with pre-call score

### Transcript Analysis Modal
When analyzing a transcript:
- Modal title shows lead name: "Analyze Transcript: [Lead Name]"
- Model selection dropdown (GPT-5-nano, Perplexity Sonar)
- Custom prompt input for additional context
- Progress indicator during analysis

### Data Model Additions
```sql
-- Lead Quality Scores table additions
ALTER TABLE lead_quality_scores ADD COLUMN linkedin_url TEXT;
ALTER TABLE lead_quality_scores ADD COLUMN transcript_analysis_json TEXT;
ALTER TABLE lead_quality_scores ADD COLUMN transcript_analyzed_at DATETIME;
```

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/lead-quality | List all leads with scores |
| GET | /api/lead-quality/:id | Get single lead details |
| POST | /api/lead-quality/:id/research | Trigger Perplexity research |
| POST | /api/lead-quality/:id/analyze | Analyze transcript |
| PUT | /api/lead-quality/:id | Update lead scores |

### Acceptance Criteria
- [x] Lead name displayed in transcript analysis modal title
- [x] LinkedIn profile link in detail panel (when available)
- [x] Analysis metadata (date/time, model) in detail panel
- [x] Link to full transcript in Calls tab
- [x] Research sources display with clean URL formatting
- [x] Re-analysis updates all fields correctly
- [x] Database schema supports linkedin_url column
