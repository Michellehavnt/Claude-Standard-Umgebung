/**
 * Format a date string to a localized date
 *
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
export function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString();
}

/**
 * Format a date string to a localized datetime
 *
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
export function formatDateTime(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString();
}

/**
 * Format milliseconds to MM:SS timestamp
 *
 * @param {number} ms - Milliseconds
 * @returns {string}
 */
export function formatTimestamp(ms) {
  if (!ms) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format duration in minutes to a readable string
 *
 * @param {number} minutes - Duration in minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (!minutes) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format outcome to a human-readable string
 *
 * @param {string} outcome - Outcome code
 * @returns {string}
 */
export function formatOutcome(outcome) {
  const labels = {
    trial_signup: 'Trial Signup',
    demo_scheduled: 'Demo Scheduled',
    no_close: 'No Close',
    unknown: 'Unknown'
  };
  return labels[outcome] || 'Unknown';
}

/**
 * Format offer type to a human-readable string
 *
 * @param {string} offerType - Offer type code
 * @returns {string}
 */
export function formatOfferType(offerType) {
  return offerType === 'software_only' ? 'Software Only' : 'DFY Mentioned';
}

/**
 * Truncate text to a maximum length
 *
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string}
 */
export function truncate(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Format a percentage
 *
 * @param {number} value - Value (0-100)
 * @returns {string}
 */
export function formatPercent(value) {
  return `${Math.round(value || 0)}%`;
}
