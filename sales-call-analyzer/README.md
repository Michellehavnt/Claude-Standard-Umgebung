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

## Key Features Explained

### Speaker Identification

The system automatically identifies the sales rep (Jamie or Phil) from call titles and only extracts quotes and pain points from the prospect (customer), not the sales rep.

### DFY Detection

The system detects when Done-For-You (agency) services are mentioned and classifies them:
- **Justified**: Prospect initiated or showed clear need
- **Avoidable**: Mentioned when prospect showed self-serve capability
- **Premature**: Mentioned before assessing prospect needs

### Pain Point Categories

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

## Usage

1. **Analyze New Calls**: Click "Analyze New Calls" to fetch and analyze any calls not yet in the database
2. **Filter by Date**: Use quick buttons or custom date range to filter calls
3. **Filter by Rep**: Select a specific sales rep to view their calls
4. **View Details**: Click on any call to see the full analysis
5. **Re-analyze**: Use "Re-analyze Period" to re-process calls in the selected date range
6. **Export**: Download a markdown report of the analyzed data

## Database Schema

The SQLite database stores:
- `analyzed_calls` - Main call data and full JSON analysis
- `pain_points` - Extracted pain points for aggregation
- `customer_language` - Language assets for the database
- `dfy_mentions` - DFY tracking data
- `objections` - Prospect objections
