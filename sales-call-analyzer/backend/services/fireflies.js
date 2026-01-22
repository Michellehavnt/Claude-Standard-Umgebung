const fetch = require('node-fetch');

const API_ENDPOINT = process.env.FIREFLIES_API_ENDPOINT || 'https://api.fireflies.ai/graphql';
const API_KEY = process.env.FIREFLIES_API_KEY;

async function makeGraphQLRequest(query, variables = {}) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Fireflies API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

async function getTranscripts(limit = 50, skip = 0) {
  const query = `
    query Transcripts($limit: Int, $skip: Int) {
      transcripts(limit: $limit, skip: $skip) {
        id
        title
        date
        duration
        organizer_email
        participants
        transcript_url
      }
    }
  `;

  const data = await makeGraphQLRequest(query, { limit, skip });
  return data.transcripts || [];
}

async function getTranscript(transcriptId) {
  const query = `
    query Transcript($transcriptId: String!) {
      transcript(id: $transcriptId) {
        id
        title
        date
        duration
        organizer_email
        participants
        sentences {
          speaker_name
          speaker_id
          text
          raw_text
          start_time
          end_time
        }
        summary {
          overview
          shorthand_bullet
          action_items
          outline
          keywords
        }
      }
    }
  `;

  const data = await makeGraphQLRequest(query, { transcriptId });
  return data.transcript;
}

async function getTranscriptsInDateRange(startDate, endDate) {
  // Fetch all transcripts and filter by date
  // Note: Fireflies API may not support date filtering directly,
  // so we fetch in batches and filter client-side
  const allTranscripts = [];
  let skip = 0;
  const batchSize = 50;
  let hasMore = true;

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // Include the entire end date

  while (hasMore) {
    const batch = await getTranscripts(batchSize, skip);

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    for (const transcript of batch) {
      const transcriptDate = new Date(transcript.date);

      // If transcript is older than our range, we can stop
      if (transcriptDate < start) {
        hasMore = false;
        break;
      }

      // If transcript is within range, include it
      if (transcriptDate >= start && transcriptDate <= end) {
        allTranscripts.push(transcript);
      }
    }

    skip += batchSize;

    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return allTranscripts;
}

async function getNewTranscripts(existingIds) {
  // Fetch recent transcripts and filter out ones we've already analyzed
  const existingSet = new Set(existingIds);
  const newTranscripts = [];
  let skip = 0;
  const batchSize = 50;
  let consecutiveExisting = 0;

  while (consecutiveExisting < 2) { // Stop after 2 batches of all existing
    const batch = await getTranscripts(batchSize, skip);

    if (batch.length === 0) break;

    let batchHasNew = false;
    for (const transcript of batch) {
      if (!existingSet.has(transcript.id)) {
        newTranscripts.push(transcript);
        batchHasNew = true;
      }
    }

    if (!batchHasNew) {
      consecutiveExisting++;
    } else {
      consecutiveExisting = 0;
    }

    skip += batchSize;

    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return newTranscripts;
}

module.exports = {
  getTranscripts,
  getTranscript,
  getTranscriptsInDateRange,
  getNewTranscripts
};
