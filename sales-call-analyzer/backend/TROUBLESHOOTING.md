# Troubleshooting Guide

This document contains solutions for known issues in the Sales Call Analyzer backend.

## PostgreSQL Date Object Issue

### Problem
Dates show as "-" in the Calls table even though data exists in the database.

### Root Cause
PostgreSQL's `pg` driver returns JavaScript `Date` objects for TIMESTAMP columns, not strings. The `normalizeDateTime()` function in `routes/admin.js` was only handling strings and numbers, causing Date objects to fall through to `return null`.

### Diagnosis
1. Visit `/api/admin/diagnose-dates` to see:
   - `nullDateCount`: How many records have NULL dates
   - `samplesWithValidDates`: Sample data from PostgreSQL (dates should appear)
   - `dashboardApiPreview`: What the API returns (if `normalized_datetime` is null, the function is broken)

2. If `raw_call_datetime` has data but `normalized_datetime` is null, the normalizeDateTime function needs fixing.

### Solution
The `normalizeDateTime()` function must handle Date objects:

```javascript
function normalizeDateTime(datetime) {
  if (!datetime) return null;
  if (typeof datetime === 'string') return datetime;
  if (datetime instanceof Date) {
    // PostgreSQL returns Date objects - convert to ISO string
    return datetime.toISOString();
  }
  if (typeof datetime === 'number') {
    const ms = datetime > 10000000000 ? datetime : datetime * 1000;
    return new Date(ms).toISOString();
  }
  // Last resort: try to convert whatever it is
  try {
    return new Date(datetime).toISOString();
  } catch (e) {
    return null;
  }
}
```

### Key Insight
- **SQLite** returns dates as strings (ISO format)
- **PostgreSQL** returns dates as JavaScript Date objects
- Always check for `instanceof Date` when handling dates from PostgreSQL

---

## NULL call_datetime Values

### Problem
Some transcripts have NULL `call_datetime` values, causing "-" to appear in the Date column.

### Diagnosis
Visit `/api/admin/diagnose-dates` to see how many records have NULL dates.

### Solution
Use the `/api/admin/fix-null-dates` endpoint (POST) to fix NULL dates:
1. It first tries to use `created_at` as a fallback
2. Then tries to parse dates from the call title (e.g., "Jan 23, 12:12 PM")
3. Falls back to a default date (2025-01-01) as last resort

### Prevention
Ensure the sync service always sets `call_datetime` when inserting new transcripts.

---

## Database Differences: SQLite vs PostgreSQL

### Overview
The app uses SQLite for local development and PostgreSQL for production (Railway).

### Key Differences
| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Date storage | String (ISO) | TIMESTAMP |
| Date return type | String | Date object |
| Boolean type | INTEGER (0/1) | BOOLEAN |
| Parameter syntax | `?` | `$1, $2, ...` |

### Best Practices
1. Always use `dbAdapter` for database operations - it handles syntax differences
2. When handling dates, check for both strings and Date objects
3. Test changes locally (SQLite) AND on Railway (PostgreSQL) before deploying

---

## Deployment Issues

### Railway Not Deploying
1. Check GitHub push was successful: `git log --oneline -3`
2. Check Railway dashboard for build status
3. Wait 1-2 minutes for deployment to complete
4. Hard refresh browser (Cmd+Shift+R) to clear cache

### Changes Not Appearing
1. Verify changes are committed: `git status`
2. Verify changes are pushed: `git log origin/main --oneline -3`
3. Check Railway build logs for errors
4. Hard refresh browser

---

*Last updated: 2026-01-28*
