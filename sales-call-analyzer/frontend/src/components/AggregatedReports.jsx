import React, { useState, useEffect } from 'react';

const API_BASE = '/api';

function AggregatedReports({ filters }) {
  const [painPoints, setPainPoints] = useState([]);
  const [dfyReport, setDfyReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('painPoints');

  useEffect(() => {
    fetchReports();
  }, [filters]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.salesRep && filters.salesRep !== 'all') queryParams.append('salesRep', filters.salesRep);

      const [painRes, dfyRes] = await Promise.all([
        fetch(`${API_BASE}/pain-points?${queryParams}`),
        fetch(`${API_BASE}/dfy-report?${queryParams}`)
      ]);

      if (painRes.ok) {
        const data = await painRes.json();
        setPainPoints(data.data || []);
      }

      if (dfyRes.ok) {
        const data = await dfyRes.json();
        setDfyReport(data.data || null);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="loading-spinner mx-auto mb-4" />
        <p className="text-gray-500">Loading reports...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex gap-1 px-4">
            {[
              { id: 'painPoints', label: 'Pain Points Analysis' },
              { id: 'dfy', label: 'DFY Tracking Report' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'painPoints' && <PainPointsReport painPoints={painPoints} />}
          {activeTab === 'dfy' && <DFYTrackingReport report={dfyReport} />}
        </div>
      </div>
    </div>
  );
}

function PainPointsReport({ painPoints }) {
  const [expandedCategory, setExpandedCategory] = useState(null);

  if (!painPoints || painPoints.length === 0) {
    return (
      <div className="text-center py-8">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-gray-500">No pain points data available</p>
      </div>
    );
  }

  const maxCount = Math.max(...painPoints.map(p => p.count));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Top Pain Points by Frequency</h3>
        <div className="space-y-4">
          {painPoints.map((pp, i) => {
            const isExpanded = expandedCategory === pp.category;
            const displayedQuotes = isExpanded ? pp.quotes : pp.quotes.slice(0, 3);
            const hasMore = pp.quotes.length > 3;

            return (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{pp.category}</span>
                  <span className="px-2 py-1 bg-primary-100 text-primary-700 rounded text-sm font-medium">
                    {pp.count} mentions
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
                  <div
                    className="bg-primary-500 h-2 rounded-full transition-all"
                    style={{ width: `${(pp.count / maxCount) * 100}%` }}
                  />
                </div>

                {/* Quotes with full context */}
                {pp.quotes && pp.quotes.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Sample Quotes ({pp.quotes.length} total):
                    </p>
                    {displayedQuotes.map((q, j) => (
                      <QuoteCard key={j} quote={q} />
                    ))}

                    {/* See More / See Less Button */}
                    {hasMore && (
                      <button
                        onClick={() => setExpandedCategory(isExpanded ? null : pp.category)}
                        className="w-full py-2 px-4 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg border border-primary-200 transition-colors flex items-center justify-center gap-2"
                      >
                        {isExpanded ? (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                            Show Less
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            See All {pp.quotes.length} Mentions
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function QuoteCard({ quote }) {
  const intensityColors = {
    High: 'border-l-red-500 bg-red-50',
    Medium: 'border-l-amber-500 bg-amber-50',
    Low: 'border-l-blue-500 bg-blue-50'
  };

  const intensityBadge = {
    High: 'bg-red-100 text-red-700',
    Medium: 'bg-amber-100 text-amber-700',
    Low: 'bg-blue-100 text-blue-700'
  };

  return (
    <div className={`border-l-4 rounded-r-lg p-3 ${intensityColors[quote.intensity] || 'border-l-gray-300 bg-gray-50'}`}>
      {/* Context (what the sales rep asked) */}
      {quote.context && (
        <p className="text-xs text-gray-500 mb-2 italic">
          {quote.context}
        </p>
      )}

      {/* Main Quote */}
      <p className="text-gray-800 leading-relaxed">
        "{quote.quote}"
      </p>

      {/* Footer: prospect, date, intensity */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            {quote.prospect || 'Unknown'}
          </span>
          <span className="text-xs text-gray-400">
            {quote.date ? new Date(quote.date).toLocaleDateString() : ''}
          </span>
          {quote.timestamp && (
            <span className="text-xs text-gray-400">
              @ {quote.timestamp}
            </span>
          )}
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${intensityBadge[quote.intensity] || 'bg-gray-100 text-gray-600'}`}>
          {quote.intensity || 'Medium'}
        </span>
      </div>
    </div>
  );
}

function DFYTrackingReport({ report }) {
  if (!report) {
    return (
      <div className="text-center py-8">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-gray-500">No DFY tracking data available</p>
      </div>
    );
  }

  const totalMentions = report.mentions?.length || 0;
  const prospectInitiated = report.byInitiator?.find(i => i.who_initiated === 'prospect')?.count || 0;
  const salesInitiated = report.byInitiator?.find(i => i.who_initiated === 'sales')?.count || 0;

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total DFY Mentions"
          value={totalMentions}
          status={totalMentions > 10 ? 'warning' : 'normal'}
        />
        <StatCard
          title="Prospect-Initiated"
          value={prospectInitiated}
          subtitle="Usually justified"
          status="success"
        />
        <StatCard
          title="Sales-Initiated"
          value={salesInitiated}
          subtitle="Review needed"
          status={salesInitiated > prospectInitiated ? 'warning' : 'normal'}
        />
        <StatCard
          title="Avoidable Rate"
          value={`${calculateAvoidableRate(report)}%`}
          subtitle="Should be low"
          status={calculateAvoidableRate(report) > 30 ? 'danger' : 'success'}
        />
      </div>

      {/* Classification Breakdown */}
      {report.byClassification && report.byClassification.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Classification Breakdown</h3>
          <div className="grid grid-cols-3 gap-4">
            {report.byClassification.map((c, i) => {
              const config = {
                justified: { color: 'bg-green-100 text-green-800 border-green-200', icon: '✓' },
                avoidable: { color: 'bg-red-100 text-red-800 border-red-200', icon: '✗' },
                premature: { color: 'bg-amber-100 text-amber-800 border-amber-200', icon: '?' }
              };
              const cfg = config[c.classification] || config.premature;

              return (
                <div key={i} className={`border rounded-lg p-4 ${cfg.color}`}>
                  <div className="text-3xl mb-2">{cfg.icon}</div>
                  <p className="text-2xl font-bold">{c.count}</p>
                  <p className="text-sm font-medium capitalize">{c.classification}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Mentions */}
      {report.mentions && report.mentions.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">DFY Mention Details</h3>
          <div className="space-y-3">
            {report.mentions.map((m, i) => (
              <div key={i} className={`border rounded-lg p-4 ${
                m.classification === 'avoidable' ? 'border-red-200 bg-red-50' :
                m.classification === 'justified' ? 'border-green-200 bg-green-50' :
                'border-amber-200 bg-amber-50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-gray-900">{m.prospect_name}</span>
                    <span className="text-gray-500 text-sm ml-2">({m.sales_rep})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {m.date ? new Date(m.date).toLocaleDateString() : '-'}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded capitalize ${
                      m.classification === 'avoidable' ? 'bg-red-200 text-red-800' :
                      m.classification === 'justified' ? 'bg-green-200 text-green-800' :
                      'bg-amber-200 text-amber-800'
                    }`}>
                      {m.classification}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Initiated by:</span> {m.who_initiated === 'prospect' ? 'Prospect' : 'Sales Rep'}
                  {m.timestamp && <span className="ml-2">@ {m.timestamp}</span>}
                </p>
                {m.reason && (
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">Reason:</span> {m.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle, status }) {
  const statusColors = {
    success: 'bg-green-50 border-green-200',
    warning: 'bg-amber-50 border-amber-200',
    danger: 'bg-red-50 border-red-200',
    normal: 'bg-white border-gray-200'
  };

  return (
    <div className={`rounded-lg border p-4 ${statusColors[status] || statusColors.normal}`}>
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function calculateAvoidableRate(report) {
  const totalMentions = report.mentions?.length || 0;
  if (totalMentions === 0) return 0;

  const avoidable = report.byClassification?.find(c => c.classification === 'avoidable')?.count || 0;
  return Math.round((avoidable / totalMentions) * 100);
}

export default AggregatedReports;
