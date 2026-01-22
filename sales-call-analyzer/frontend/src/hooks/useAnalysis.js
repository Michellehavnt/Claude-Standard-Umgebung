import { useState, useCallback } from 'react';

const API_BASE = '/api';

/**
 * Hook for analysis operations
 */
export function useAnalysis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);

  /**
   * Fetch analyzed calls
   */
  const fetchCalls = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.salesRep && filters.salesRep !== 'all') queryParams.append('salesRep', filters.salesRep);
      if (filters.limit) queryParams.append('limit', filters.limit);
      if (filters.offset) queryParams.append('offset', filters.offset);

      const res = await fetch(`${API_BASE}/calls?${queryParams}`);

      if (!res.ok) {
        throw new Error('Failed to fetch calls');
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
   * Fetch a single call's analysis
   */
  const fetchCall = useCallback(async (id) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/calls/${id}`);

      if (!res.ok) {
        throw new Error('Failed to fetch call');
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
   * Start analysis of new calls
   */
  const analyzeNewCalls = useCallback(async () => {
    setError(null);
    setProgress({ inProgress: true, current: 0, total: 0 });

    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!res.ok) {
        throw new Error('Failed to start analysis');
      }

      // Start polling
      pollProgress();

      return true;
    } catch (err) {
      setError(err.message);
      setProgress(null);
      return false;
    }
  }, []);

  /**
   * Re-analyze calls in a date range
   */
  const reanalyzePeriod = useCallback(async (startDate, endDate) => {
    setError(null);
    setProgress({ inProgress: true, current: 0, total: 0 });

    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          reanalyze: true
        })
      });

      if (!res.ok) {
        throw new Error('Failed to start re-analysis');
      }

      // Start polling
      pollProgress();

      return true;
    } catch (err) {
      setError(err.message);
      setProgress(null);
      return false;
    }
  }, []);

  /**
   * Poll analysis progress
   */
  const pollProgress = useCallback(async () => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/analyze/progress`);
        const data = await res.json();

        setProgress(data.data);

        if (data.data?.inProgress) {
          setTimeout(poll, 1000);
        } else {
          // Analysis complete
          setTimeout(() => setProgress(null), 3000);
        }
      } catch (err) {
        console.error('Error polling progress:', err);
      }
    };

    poll();
  }, []);

  /**
   * Fetch aggregated stats
   */
  const fetchStats = useCallback(async (filters = {}) => {
    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.salesRep && filters.salesRep !== 'all') queryParams.append('salesRep', filters.salesRep);

      const res = await fetch(`${API_BASE}/stats?${queryParams}`);

      if (!res.ok) {
        throw new Error('Failed to fetch stats');
      }

      const data = await res.json();
      return data.data || null;
    } catch (err) {
      console.error('Error fetching stats:', err);
      return null;
    }
  }, []);

  /**
   * Export report
   */
  const exportReport = useCallback(async (filters = {}, format = 'markdown') => {
    try {
      const res = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: filters.startDate,
          endDate: filters.endDate,
          salesRep: filters.salesRep,
          format
        })
      });

      if (!res.ok) {
        throw new Error('Failed to export');
      }

      if (format === 'json') {
        return await res.json();
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-analysis-${filters.startDate || 'all'}-${filters.endDate || 'time'}.md`;
      a.click();
      window.URL.revokeObjectURL(url);

      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  return {
    loading,
    error,
    progress,
    fetchCalls,
    fetchCall,
    analyzeNewCalls,
    reanalyzePeriod,
    fetchStats,
    exportReport
  };
}

export default useAnalysis;
