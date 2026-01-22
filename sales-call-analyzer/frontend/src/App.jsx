import React, { useState, useEffect, useCallback } from 'react';
import Dashboard from './components/Dashboard';
import ControlPanel from './components/ControlPanel';
import StatsCards from './components/StatsCards';
import CallsTable from './components/CallsTable';
import CallDetailModal from './components/CallDetailModal';
import AggregatedReports from './components/AggregatedReports';
import LanguageDatabase from './components/LanguageDatabase';

const API_BASE = '/api';

function App() {
  // State
  const [activeTab, setActiveTab] = useState('dashboard');
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCall, setSelectedCall] = useState(null);
  const [analysisProgress, setAnalysisProgress] = useState(null);

  // Filters
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    salesRep: 'all'
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.salesRep && filters.salesRep !== 'all') queryParams.append('salesRep', filters.salesRep);

      const [callsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/calls?${queryParams}`),
        fetch(`${API_BASE}/stats?${queryParams}`)
      ]);

      if (!callsRes.ok || !statsRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const callsData = await callsRes.json();
      const statsData = await statsRes.json();

      setCalls(callsData.data || []);
      setStats(statsData.data || null);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Date range quick buttons
  const setDateRange = (range) => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    let startDate = '';
    let endDate = todayStr;

    switch (range) {
      case 'today':
        startDate = todayStr;
        break;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        break;
      case 'last7':
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 7);
        startDate = last7.toISOString().split('T')[0];
        break;
      case 'last30':
        const last30 = new Date(today);
        last30.setDate(last30.getDate() - 30);
        startDate = last30.toISOString().split('T')[0];
        break;
      case 'all':
        startDate = '';
        endDate = '';
        break;
      default:
        break;
    }

    setFilters(f => ({ ...f, startDate, endDate }));
  };

  // Analyze new calls
  const analyzeNewCalls = async () => {
    try {
      setAnalysisProgress({ inProgress: true, current: 0, total: 0 });

      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!res.ok) throw new Error('Failed to start analysis');

      // Poll for progress
      pollAnalysisProgress();
    } catch (err) {
      setError(err.message);
      setAnalysisProgress(null);
    }
  };

  // Re-analyze selected period
  const reanalyzePeriod = async () => {
    if (!filters.startDate || !filters.endDate) {
      setError('Please select a date range first');
      return;
    }

    try {
      setAnalysisProgress({ inProgress: true, current: 0, total: 0 });

      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: filters.startDate,
          endDate: filters.endDate,
          reanalyze: true
        })
      });

      if (!res.ok) throw new Error('Failed to start re-analysis');

      // Poll for progress
      pollAnalysisProgress();
    } catch (err) {
      setError(err.message);
      setAnalysisProgress(null);
    }
  };

  // Poll analysis progress
  const pollAnalysisProgress = async () => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/analyze/progress`);
        const data = await res.json();

        setAnalysisProgress(data.data);

        if (data.data.inProgress) {
          setTimeout(poll, 1000);
        } else {
          // Analysis complete - refresh data
          fetchData();
          setTimeout(() => setAnalysisProgress(null), 3000);
        }
      } catch (err) {
        console.error('Error polling progress:', err);
      }
    };

    poll();
  };

  // Export report
  const exportReport = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.salesRep && filters.salesRep !== 'all') queryParams.append('salesRep', filters.salesRep);

      const res = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: filters.startDate,
          endDate: filters.endDate,
          salesRep: filters.salesRep,
          format: 'markdown'
        })
      });

      if (!res.ok) throw new Error('Failed to export');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-analysis-${filters.startDate || 'all'}-${filters.endDate || 'time'}.md`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-500 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Sales Call Analyzer</h1>
                <p className="text-sm text-gray-500">AffiliateFinder.ai</p>
              </div>
            </div>

            {/* Tabs */}
            <nav className="flex gap-1">
              {[
                { id: 'dashboard', label: 'Dashboard' },
                { id: 'reports', label: 'Aggregated Reports' },
                { id: 'language', label: 'Language Database' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Analysis Progress Banner */}
        {analysisProgress && (
          <div className={`mb-6 p-4 rounded-lg ${
            analysisProgress.inProgress
              ? 'bg-blue-50 border border-blue-200'
              : 'bg-green-50 border border-green-200'
          }`}>
            <div className="flex items-center gap-3">
              {analysisProgress.inProgress && <div className="loading-spinner" />}
              <div>
                <p className={`font-medium ${analysisProgress.inProgress ? 'text-blue-700' : 'text-green-700'}`}>
                  {analysisProgress.inProgress
                    ? `Analyzing calls... ${analysisProgress.current}/${analysisProgress.total}`
                    : 'Analysis complete!'}
                </p>
                {analysisProgress.currentCall && (
                  <p className="text-sm text-blue-600">
                    Current: {analysisProgress.currentCall}
                  </p>
                )}
                {analysisProgress.errors && analysisProgress.errors.length > 0 && (
                  <p className="text-sm text-red-600 mt-1">
                    Errors: {analysisProgress.errors.length}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="text-red-700">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-700 hover:text-red-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'dashboard' && (
          <>
            <ControlPanel
              filters={filters}
              setFilters={setFilters}
              setDateRange={setDateRange}
              onAnalyzeNew={analyzeNewCalls}
              onReanalyze={reanalyzePeriod}
              onExport={exportReport}
              loading={loading || (analysisProgress?.inProgress)}
            />

            <StatsCards stats={stats} loading={loading} />

            <CallsTable
              calls={calls}
              loading={loading}
              onViewDetails={setSelectedCall}
            />
          </>
        )}

        {activeTab === 'reports' && (
          <AggregatedReports filters={filters} />
        )}

        {activeTab === 'language' && (
          <LanguageDatabase filters={filters} />
        )}
      </main>

      {/* Call Detail Modal */}
      {selectedCall && (
        <CallDetailModal
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
        />
      )}
    </div>
  );
}

export default App;
