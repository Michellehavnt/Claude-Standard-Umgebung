/**
 * CSV Export Service
 *
 * Provides utilities for generating CSV files from structured data.
 * Used for exporting tables (e.g., Closing Rate calls) to CSV format.
 *
 * Features:
 * - UTF-8 encoded output
 * - Proper escaping of special characters (commas, quotes, newlines)
 * - Consistent column ordering
 * - Header row included
 */

/**
 * Escape a value for CSV format
 * - If value contains comma, quote, or newline, wrap in quotes
 * - Double any existing quotes
 *
 * @param {any} value - The value to escape
 * @returns {string} - CSV-safe string
 */
function escapeCSVValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // Check if value needs quoting
  const needsQuoting = stringValue.includes(',') ||
                       stringValue.includes('"') ||
                       stringValue.includes('\n') ||
                       stringValue.includes('\r');

  if (needsQuoting) {
    // Double any existing quotes and wrap in quotes
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }

  return stringValue;
}

/**
 * Generate CSV content from an array of objects
 *
 * @param {Object[]} data - Array of objects to convert
 * @param {Object[]} columns - Column definitions [{key: 'fieldName', header: 'Display Name'}]
 * @returns {string} - CSV content as string
 */
function generateCSV(data, columns) {
  if (!Array.isArray(data)) {
    return '';
  }

  if (!Array.isArray(columns) || columns.length === 0) {
    return '';
  }

  const lines = [];

  // Header row
  const headerRow = columns.map(col => escapeCSVValue(col.header)).join(',');
  lines.push(headerRow);

  // Data rows
  for (const row of data) {
    const values = columns.map(col => {
      const value = row[col.key];
      return escapeCSVValue(value);
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Generate CSV for Closing Rate calls table
 *
 * @param {Object[]} calls - Array of call objects from founderSnapshotService
 * @returns {string} - CSV content
 */
function generateClosingRateCSV(calls) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return '';
  }

  const columns = [
    { key: 'repName', header: 'Rep' },
    { key: 'title', header: 'Call Title' },
    { key: 'date', header: 'Date' },
    { key: 'prospectEmail', header: 'Prospect Email' },
    { key: 'stripeStatus', header: 'Status' }
  ];

  // Transform data to match expected format
  const transformedCalls = calls.map(call => ({
    repName: getRepDisplayName(call.repName),
    title: call.title || '',
    date: formatDateForCSV(call.date),
    prospectEmail: call.prospectEmail || '',
    stripeStatus: call.stripeStatus || 'Not Matched'
  }));

  return generateCSV(transformedCalls, columns);
}

/**
 * Get display name for rep
 * @param {string} repName - Raw rep name
 * @returns {string} - Display name
 */
function getRepDisplayName(repName) {
  if (!repName) return 'Unknown';
  const name = repName.toLowerCase();
  if (name.includes('phil')) return 'Phil';
  if (name.includes('jamie')) return 'Jamie';
  return repName;
}

/**
 * Format date for CSV export
 * @param {string} dateStr - Date string
 * @returns {string} - Formatted date (YYYY-MM-DD)
 */
function formatDateForCSV(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return dateStr;
  }
}

/**
 * Generate filename for Closing Rate CSV export
 *
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {string} - Filename
 */
function generateClosingRateFilename(startDate, endDate) {
  const today = new Date().toISOString().split('T')[0];

  if (startDate && endDate) {
    return `closing-rate-calls-${startDate}-to-${endDate}.csv`;
  }

  return `closing-rate-calls-${today}.csv`;
}

module.exports = {
  escapeCSVValue,
  generateCSV,
  generateClosingRateCSV,
  generateClosingRateFilename,
  getRepDisplayName,
  formatDateForCSV
};
