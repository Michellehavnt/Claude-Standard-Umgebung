import React from 'react';

function ControlPanel({
  filters,
  setFilters,
  setDateRange,
  onAnalyzeNew,
  onReanalyze,
  onExport,
  loading
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex flex-wrap gap-4 items-center">
        {/* Date Range Quick Buttons */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'last7', label: 'Last 7 Days' },
            { id: 'last30', label: 'Last 30 Days' },
            { id: 'all', label: 'All Time' }
          ].map(btn => (
            <button
              key={btn.id}
              onClick={() => setDateRange(btn.id)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                (btn.id === 'all' && !filters.startDate && !filters.endDate) ||
                (btn.id !== 'all' && filters.startDate)
                  ? 'bg-gray-100 border-gray-300 text-gray-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Custom Date Range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Sales Rep Filter */}
        <select
          value={filters.salesRep}
          onChange={(e) => setFilters(f => ({ ...f, salesRep: e.target.value }))}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="all">All Reps</option>
          <option value="jamie">Jamie</option>
          <option value="phil">Phil</option>
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onAnalyzeNew}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <div className="loading-spinner w-4 h-4" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Analyze New Calls
          </button>

          <button
            onClick={onReanalyze}
            disabled={loading || (!filters.startDate && !filters.endDate)}
            className="px-4 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Re-analyze Period
          </button>

          <button
            onClick={onExport}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Report
          </button>
        </div>
      </div>
    </div>
  );
}

export default ControlPanel;
