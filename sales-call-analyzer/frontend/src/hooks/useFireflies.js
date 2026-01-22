import { useState, useCallback } from 'react';

const API_BASE = '/api';

/**
 * Hook for interacting with the Fireflies API through our backend
 */
export function useFireflies() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch transcripts from Fireflies
   */
  const fetchTranscripts = useCallback(async (limit = 50, skip = 0) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/transcripts?limit=${limit}&skip=${skip}`);

      if (!res.ok) {
        throw new Error('Failed to fetch transcripts');
      }

      const data = await res.json();
      return data.data || [];
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Fetch a single transcript with full details
   */
  const fetchTranscript = useCallback(async (id) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/transcripts/${id}`);

      if (!res.ok) {
        throw new Error('Failed to fetch transcript');
      }

      const data = await res.json();
      return data.data || null;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Fetch transcripts in a date range
   */
  const fetchTranscriptsInRange = useCallback(async (startDate, endDate) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/transcripts/date-range/${startDate}/${endDate}`);

      if (!res.ok) {
        throw new Error('Failed to fetch transcripts');
      }

      const data = await res.json();
      return data.data || [];
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    fetchTranscripts,
    fetchTranscript,
    fetchTranscriptsInRange
  };
}

export default useFireflies;
