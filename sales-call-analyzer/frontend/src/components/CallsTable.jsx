import React, { useState } from 'react';

function CallsTable({ calls, loading, onViewDetails }) {
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedCalls = [...calls].sort((a, b) => {
    let aVal = a[sortField] || a.analysis?.[sortField] || '';
    let bVal = b[sortField] || b.analysis?.[sortField] || '';

    if (sortField === 'date') {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
    }

    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const SortHeader = ({ field, children }) => (
    <th
      onClick={() => handleSort(field)}
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <svg className={`w-4 h-4 ${sortDir === 'desc' ? 'transform rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        )}
      </div>
    </th>
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-8 text-center">
          <div className="loading-spinner mx-auto mb-4" />
          <p className="text-gray-500">Loading calls...</p>
        </div>
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-gray-500">No analyzed calls found</p>
        <p className="text-sm text-gray-400 mt-1">Click "Analyze New Calls" to get started</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortHeader field="date">Date</SortHeader>
              <SortHeader field="prospect_name">Prospect</SortHeader>
              <SortHeader field="sales_rep">Rep</SortHeader>
              <SortHeader field="duration">Duration</SortHeader>
              <SortHeader field="outcome">Outcome</SortHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Offer Type
              </th>
              <SortHeader field="pain_level">Pain</SortHeader>
              <SortHeader field="overall_score">Score</SortHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedCalls.map((call) => {
              const analysis = call.analysis || {};

              return (
                <tr key={call.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {call.date ? new Date(call.date).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {call.prospect_name || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500 truncate max-w-[200px]">
                      {call.title}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      call.sales_rep === 'Jamie'
                        ? 'bg-blue-100 text-blue-800'
                        : call.sales_rep === 'Phil'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {call.sales_rep || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {call.duration || 0}m
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <OutcomeBadge outcome={call.outcome} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <OfferBadge offer={call.offer_pitched} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <PainIndicator level={call.pain_level} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ScoreBadge score={call.overall_score} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => onViewDetails(call)}
                      className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }) {
  const config = {
    trial_signup: { label: 'Trial Signup', color: 'bg-green-100 text-green-800' },
    demo_scheduled: { label: 'Demo Scheduled', color: 'bg-blue-100 text-blue-800' },
    no_close: { label: 'No Close', color: 'bg-gray-100 text-gray-800' },
    unknown: { label: 'Unknown', color: 'bg-gray-100 text-gray-500' }
  };

  const cfg = config[outcome] || config.unknown;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function OfferBadge({ offer }) {
  const isSoftware = offer === 'software_only';

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
      isSoftware
        ? 'bg-green-100 text-green-800'
        : 'bg-amber-100 text-amber-800'
    }`}>
      {isSoftware ? (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )}
      {isSoftware ? 'Software' : 'DFY Mentioned'}
    </span>
  );
}

function PainIndicator({ level }) {
  const color = level >= 7 ? 'text-green-600' : level >= 4 ? 'text-amber-600' : 'text-red-600';
  const bgColor = level >= 7 ? 'bg-green-100' : level >= 4 ? 'bg-amber-100' : 'bg-red-100';

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${bgColor.replace('100', '500')}`} />
      <span className={`text-sm font-medium ${color}`}>{level || 0}/10</span>
    </div>
  );
}

function ScoreBadge({ score }) {
  let color = 'bg-gray-100 text-gray-800';
  if (score >= 80) color = 'bg-green-100 text-green-800';
  else if (score >= 60) color = 'bg-blue-100 text-blue-800';
  else if (score >= 40) color = 'bg-amber-100 text-amber-800';
  else if (score > 0) color = 'bg-red-100 text-red-800';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {score || 0}
    </span>
  );
}

export default CallsTable;
