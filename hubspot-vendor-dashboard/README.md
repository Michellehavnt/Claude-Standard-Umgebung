# HubSpot Vendor Dashboard

Ein umfassendes Dashboard zur Überwachung von Vendor-Performance, Churn-Risiken und Onboarding-Metriken basierend auf HubSpot CRM-Daten.

## Features

- **Aktive Vendoren** - Übersicht aller Vendoren mit Umsatz im gewählten Zeitraum
- **Churn-Alerts** - Vendoren die letzten Monat aktiv waren, aber jetzt inaktiv sind
- **Umsatzeinbruch-Alerts** - Vendoren mit >30% Umsatzrückgang
- **Onboarding-Pipeline** - Wöchentliche Statistiken zu neuen Accounts und Zeit bis zum ersten Verkauf
- **UTM-Attribution** - Übersicht der Akquisitionsquellen (Meta Ads, Google Ads, Organic, etc.)
- **Flexible Zeitfilter** - Heute, Diese Woche, Diesen Monat, Letzter Monat, 3/6 Monate, Custom

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Charts**: Recharts
- **State Management**: TanStack Query (React Query)
- **API**: HubSpot API v3

## Voraussetzungen

- Node.js 18+
- npm oder yarn
- HubSpot Account mit API-Zugang

## Installation

### 1. Repository klonen

```bash
cd hubspot-vendor-dashboard
```

### 2. Backend einrichten

```bash
cd backend
npm install
cp .env.example .env
```

Bearbeite die `.env` Datei:

```env
HUBSPOT_API_KEY=your_hubspot_api_key_here
PORT=3001
FRONTEND_URL=http://localhost:5173
```

### 3. Frontend einrichten

```bash
cd ../frontend
npm install
```

## HubSpot API Key erstellen

1. Gehe zu [HubSpot Developer Portal](https://developers.hubspot.com/)
2. Wähle deinen Account → Settings → Integrations → Private Apps
3. Erstelle eine neue Private App mit folgenden Scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.deals.read`
4. Kopiere den generierten Access Token in die `.env` Datei

## Entwicklung starten

### Terminal 1: Backend

```bash
cd backend
npm run dev
```

Server läuft auf http://localhost:3001

### Terminal 2: Frontend

```bash
cd frontend
npm run dev
```

App läuft auf http://localhost:5173

## API Endpoints

| Endpoint | Beschreibung |
|----------|--------------|
| `GET /api/health` | Health Check |
| `GET /api/vendors/dashboard` | Komplette Dashboard-Daten |
| `GET /api/vendors/active` | Aktive Vendoren mit Umsatz |
| `GET /api/vendors/churned` | Gechurnte Vendoren |
| `GET /api/vendors/declining` | Vendoren mit Umsatzeinbruch |
| `GET /api/vendors/onboarding` | Wöchentliche Onboarding-Stats |
| `GET /api/vendors/utm` | UTM Attribution Statistiken |
| `GET /api/vendors/:id` | Details zu einem Vendor |

### Query Parameter

Alle Endpoints unterstützen folgende Parameter:

- `filter` - Zeitfilter: `today`, `this_week`, `this_month`, `last_month`, `3_months`, `6_months`, `custom`
- `startDate` - Start-Datum für custom Filter (YYYY-MM-DD)
- `endDate` - End-Datum für custom Filter (YYYY-MM-DD)

## Projektstruktur

```
hubspot-vendor-dashboard/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express Server
│   │   ├── routes/
│   │   │   └── vendors.ts        # API Endpoints
│   │   ├── services/
│   │   │   └── hubspot.ts        # HubSpot API Client
│   │   ├── utils/
│   │   │   ├── analytics.ts      # Berechnungslogik
│   │   │   └── dateFilters.ts    # Zeitraum-Utilities
│   │   └── types/
│   │       └── vendor.ts         # TypeScript Types
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx     # Haupt-Dashboard
│   │   │   ├── KPICards.tsx      # KPI-Übersichtskarten
│   │   │   ├── VendorList.tsx    # Vendor-Liste
│   │   │   ├── AlertPanel.tsx    # Churn/Decline Alerts
│   │   │   ├── OnboardingTable.tsx
│   │   │   ├── UTMChart.tsx
│   │   │   └── DateFilter.tsx
│   │   ├── hooks/
│   │   │   └── useVendorData.ts
│   │   ├── services/
│   │   │   └── api.ts
│   │   └── types/
│   │       └── index.ts
│   └── package.json
│
└── README.md
```

## Konfiguration

### Alert-Schwellwerte

In `backend/src/utils/analytics.ts`:

```typescript
const REVENUE_DECLINE_THRESHOLD = 0.30; // 30% für Umsatzeinbruch-Alert
```

### Definition "Aktiver Vendor"

Ein Vendor gilt als aktiv, wenn er im gewählten Zeitraum mindestens einen Deal mit Umsatz hat.

## Produktion

### Backend bauen

```bash
cd backend
npm run build
npm start
```

### Frontend bauen

```bash
cd frontend
npm run build
npm run preview
```

## Troubleshooting

### "HUBSPOT_API_KEY is not configured"

Stelle sicher, dass die `.env` Datei im backend-Ordner existiert und den API Key enthält.

### CORS-Fehler

Überprüfe, dass `FRONTEND_URL` in der Backend `.env` korrekt gesetzt ist.

### Keine Daten werden angezeigt

1. Prüfe die Browser-Konsole auf Fehler
2. Prüfe das Backend-Terminal auf API-Fehler
3. Stelle sicher, dass dein HubSpot Account Deals und Contacts hat

## Lizenz

MIT
