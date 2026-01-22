/**
 * Parse call title to extract prospect and sales rep names
 *
 * @param {string} title - The call title (e.g., "Aaron Higgins and Jamie I.F.")
 * @returns {{ prospect: string, rep: string }}
 */
export function parseCallTitle(title) {
  if (!title) return { prospect: 'Unknown', rep: 'Unknown' };

  // Pattern: "Name and Jamie I.F." or "Name and Phil Norris"
  const jamiePattern = /(.+?)\s+and\s+Jamie\s*I\.?F\.?/i;
  const philPattern = /(.+?)\s+and\s+Phil\s+Norris/i;

  let match = title.match(jamiePattern);
  if (match) return { prospect: match[1].trim(), rep: 'Jamie' };

  match = title.match(philPattern);
  if (match) return { prospect: match[1].trim(), rep: 'Phil' };

  // Try reverse pattern "Jamie I.F. and Name"
  const jamieReversePattern = /Jamie\s*I\.?F\.?\s+and\s+(.+)/i;
  const philReversePattern = /Phil\s+Norris\s+and\s+(.+)/i;

  match = title.match(jamieReversePattern);
  if (match) return { prospect: match[1].trim(), rep: 'Jamie' };

  match = title.match(philReversePattern);
  if (match) return { prospect: match[1].trim(), rep: 'Phil' };

  return { prospect: title, rep: 'Unknown' };
}

/**
 * Check if a speaker is the prospect (not the sales rep)
 *
 * @param {string} speakerName - The speaker's name from the transcript
 * @param {string} prospectName - The expected prospect name
 * @returns {boolean}
 */
export function isProspectSpeaker(speakerName, prospectName) {
  if (!speakerName) return false;

  const speaker = speakerName.toLowerCase();

  // Exclude known sales rep names
  const salesRepNames = ['jamie', 'phil', 'phil norris', 'jamie i.f.', 'jamie if'];
  if (salesRepNames.some(rep => speaker.includes(rep))) {
    return false;
  }

  // Include if matches prospect name
  if (prospectName) {
    const prospectFirst = prospectName.toLowerCase().split(' ')[0];
    if (speaker.includes(prospectFirst)) return true;
  }

  return true;
}
