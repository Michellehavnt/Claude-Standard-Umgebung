import React, { useState, useEffect } from 'react';

const API_BASE = '/api';

function CallDetailModal({ call, onClose }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [customerStatus, setCustomerStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const analysis = call.analysis || {};

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'customerStatus', label: 'Customer Status' },
    { id: 'painPoints', label: 'Pain Points' },
    { id: 'objections', label: 'Objections' },
    { id: 'excitement', label: 'Excitement' },
    { id: 'dfy', label: 'DFY Analysis' },
    { id: 'language', label: 'Language Assets' },
    { id: 'timeline', label: 'Key Moments' }
  ];

  // Fetch customer status when the tab is opened
  useEffect(() => {
    if (activeSection === 'customerStatus' && !customerStatus && !statusLoading) {
      fetchCustomerStatus();
    }
  }, [activeSection]);

  const fetchCustomerStatus = async () => {
    setStatusLoading(true);
    try {
      const response = await fetch(`${API_BASE}/customer-status/${call.id}`);
      if (response.ok) {
        const data = await response.json();
        setCustomerStatus(data.data);
      }
    } catch (err) {
      console.error('Error fetching customer status:', err);
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          {/* Header */}
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {analysis.prospectName || call.prospect_name || 'Unknown Prospect'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {call.title} | {call.date ? new Date(call.date).toLocaleDateString() : '-'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Quick Stats */}
            <div className="mt-4 flex gap-4">
              <QuickStat label="Rep" value={call.sales_rep || 'Unknown'} />
              <QuickStat label="Duration" value={`${call.duration || 0}m`} />
              <QuickStat label="Outcome" value={formatOutcome(call.outcome)} />
              <QuickStat
                label="Offer"
                value={call.offer_pitched === 'software_only' ? 'Software Only' : 'DFY Mentioned'}
                status={call.offer_pitched === 'software_only' ? 'success' : 'warning'}
              />
              <QuickStat label="Pain Level" value={`${call.pain_level || 0}/10`} />
              <QuickStat label="Score" value={`${call.overall_score || 0}/100`} />
            </div>

            {/* Section Tabs */}
            <div className="mt-4 flex gap-1 border-b border-gray-200 -mb-4 overflow-x-auto">
              {sections.map(section => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeSection === section.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
            {activeSection === 'overview' && <OverviewSection analysis={analysis} />}
            {activeSection === 'customerStatus' && (
              <CustomerStatusSection
                status={customerStatus}
                loading={statusLoading}
                onRefresh={fetchCustomerStatus}
              />
            )}
            {activeSection === 'painPoints' && <PainPointsSection painPoints={analysis.painPoints} />}
            {activeSection === 'objections' && <ObjectionsSection objections={analysis.objections} />}
            {activeSection === 'excitement' && <ExcitementSection triggers={analysis.excitementTriggers} />}
            {activeSection === 'dfy' && <DFYSection dfyAnalysis={analysis.dfyAnalysis} />}
            {activeSection === 'language' && <LanguageSection assets={analysis.languageAssets} />}
            {activeSection === 'timeline' && <TimelineSection moments={analysis.keyMoments} />}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickStat({ label, value, status }) {
  const statusColors = {
    success: 'text-green-600',
    warning: 'text-amber-600',
    danger: 'text-red-600'
  };

  return (
    <div className="text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${status ? statusColors[status] : 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}

function formatOutcome(outcome) {
  const labels = {
    trial_signup: 'Trial Signup',
    demo_scheduled: 'Demo Scheduled',
    no_close: 'No Close',
    unknown: 'Unknown'
  };
  return labels[outcome] || 'Unknown';
}

function OverviewSection({ analysis }) {
  const profile = analysis.prospectProfile || {};

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900 mb-3">Prospect Profile</h3>
        <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-4">
          <ProfileItem label="Company" value={profile.company} />
          <ProfileItem label="Role" value={profile.role} />
          <ProfileItem label="Industry" value={profile.industry} />
          <ProfileItem label="Team Size" value={profile.teamSize} />
          <ProfileItem label="Budget Authority" value={profile.budgetAuthority} />
          <ProfileItem
            label="Current Tools"
            value={profile.currentTools?.join(', ')}
          />
        </div>
      </div>

      {analysis.followUpActions && analysis.followUpActions.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Follow-up Actions</h3>
          <ul className="space-y-2">
            {analysis.followUpActions.map((action, i) => (
              <li key={i} className="flex items-start gap-2">
                <svg className="w-5 h-5 text-primary-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-sm text-gray-700">{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProfileItem({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value || '-'}</p>
    </div>
  );
}

function PainPointsSection({ painPoints }) {
  if (!painPoints) return <EmptyState message="No pain points recorded" />;

  const allPainPoints = [
    ...(painPoints.immediate || []).map(p => ({ ...p, urgency: 'Immediate' })),
    ...(painPoints.shortTerm || []).map(p => ({ ...p, urgency: 'Short-term' })),
    ...(painPoints.longTerm || []).map(p => ({ ...p, urgency: 'Long-term' }))
  ];

  if (allPainPoints.length === 0) return <EmptyState message="No pain points recorded" />;

  return (
    <div className="space-y-4">
      {allPainPoints.map((pp, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">{pp.category}</span>
            <div className="flex gap-2">
              <IntensityBadge intensity={pp.intensity} />
              <UrgencyBadge urgency={pp.urgency} />
            </div>
          </div>
          <blockquote className="text-sm text-gray-600 italic border-l-4 border-primary-300 pl-3">
            "{pp.quote}"
          </blockquote>
          {pp.context && (
            <p className="text-xs text-gray-500 mt-2">{pp.context}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function IntensityBadge({ intensity }) {
  const colors = {
    High: 'bg-red-100 text-red-800',
    Medium: 'bg-amber-100 text-amber-800',
    Low: 'bg-green-100 text-green-800'
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[intensity] || colors.Medium}`}>
      {intensity || 'Medium'}
    </span>
  );
}

function UrgencyBadge({ urgency }) {
  const colors = {
    'Immediate': 'bg-purple-100 text-purple-800',
    'Short-term': 'bg-blue-100 text-blue-800',
    'Long-term': 'bg-gray-100 text-gray-800'
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[urgency] || colors['Long-term']}`}>
      {urgency}
    </span>
  );
}

function ObjectionsSection({ objections }) {
  if (!objections || objections.length === 0) {
    return <EmptyState message="No objections recorded" />;
  }

  return (
    <div className="space-y-4">
      {objections.map((obj, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">{obj.type} Objection</span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
              obj.outcome === 'Accepted' ? 'bg-green-100 text-green-800' :
              obj.outcome === 'Rejected' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {obj.outcome || 'Unknown'}
            </span>
          </div>
          <blockquote className="text-sm text-gray-600 italic border-l-4 border-amber-300 pl-3">
            "{obj.quote}"
          </blockquote>
          {obj.emotionalUndertone && (
            <p className="text-xs text-gray-500 mt-2">
              Emotional undertone: {obj.emotionalUndertone}
            </p>
          )}
          {obj.resolutionAttempted && (
            <p className="text-xs text-gray-500 mt-1">
              Resolution attempted: {obj.resolutionAttempted}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ExcitementSection({ triggers }) {
  if (!triggers || triggers.length === 0) {
    return <EmptyState message="No excitement triggers recorded" />;
  }

  return (
    <div className="space-y-4">
      {triggers.map((trigger, i) => (
        <div key={i} className="border border-green-200 bg-green-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-green-800">{trigger.trigger}</span>
            {trigger.timestamp && (
              <span className="text-xs text-green-600">@ {trigger.timestamp}</span>
            )}
          </div>
          <blockquote className="text-sm text-green-700 italic border-l-4 border-green-400 pl-3">
            "{trigger.quote}"
          </blockquote>
        </div>
      ))}
    </div>
  );
}

function DFYSection({ dfyAnalysis }) {
  if (!dfyAnalysis) {
    return <EmptyState message="No DFY analysis available" />;
  }

  if (!dfyAnalysis.mentioned) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <svg className="w-12 h-12 text-green-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-green-700 font-medium">No DFY mentioned in this call</p>
        <p className="text-sm text-green-600 mt-1">Software-only pitch maintained</p>
      </div>
    );
  }

  const classificationColors = {
    justified: 'bg-green-100 text-green-800 border-green-200',
    avoidable: 'bg-red-100 text-red-800 border-red-200',
    premature: 'bg-amber-100 text-amber-800 border-amber-200'
  };

  return (
    <div className="space-y-4">
      <div className={`border rounded-lg p-4 ${classificationColors[dfyAnalysis.classification] || 'bg-gray-100'}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium">DFY Mention Detected</span>
          <span className="px-3 py-1 text-sm font-medium rounded-full bg-white">
            {dfyAnalysis.classification?.toUpperCase() || 'UNKNOWN'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Initiated by:</p>
            <p className="font-medium">{dfyAnalysis.whoInitiated === 'prospect' ? 'Prospect' : 'Sales Rep'}</p>
          </div>
          <div>
            <p className="text-gray-600">Timestamp:</p>
            <p className="font-medium">{dfyAnalysis.timestamp || '-'}</p>
          </div>
          <div className="col-span-2">
            <p className="text-gray-600">Reason/Context:</p>
            <p className="font-medium">{dfyAnalysis.reason || '-'}</p>
          </div>
        </div>
      </div>

      {dfyAnalysis.context && dfyAnalysis.context.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">Context</h4>
          <div className="space-y-2">
            {dfyAnalysis.context.map((ctx, i) => (
              <div key={i} className="text-sm bg-gray-50 rounded p-2">
                <span className="font-medium text-gray-700">{ctx.speaker}</span>
                <span className="text-gray-500 text-xs ml-2">@ {ctx.time}</span>
                <p className="text-gray-600 mt-1">"{ctx.text}"</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerStatusSection({ status, loading, onRefresh }) {
  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="loading-spinner mx-auto mb-4" />
        <p className="text-gray-500">Checking customer status...</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Unable to fetch customer status</p>
        <button
          onClick={onRefresh}
          className="mt-4 px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { stripeStatus, slackStatus, summary } = status;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Customer Summary</h3>
          <button
            onClick={onRefresh}
            className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Deal Status"
            value={summary?.dealClosed ? 'Closed' : 'Not Closed'}
            status={summary?.dealClosed ? 'success' : 'neutral'}
          />
          <SummaryCard
            label="Deal Type"
            value={summary?.dealType === 'software' ? 'Software' : summary?.dealType === 'dfy' ? 'DFY' : 'Unknown'}
            status={summary?.dealType === 'software' ? 'success' : summary?.dealType === 'dfy' ? 'warning' : 'neutral'}
          />
          <SummaryCard
            label="Customer Status"
            value={summary?.isActiveCustomer ? 'Active' : summary?.isChurned ? 'Churned' : summary?.isPastDue ? 'Past Due' : 'Unknown'}
            status={summary?.isActiveCustomer ? 'success' : summary?.isChurned ? 'danger' : summary?.isPastDue ? 'warning' : 'neutral'}
          />
          <SummaryCard
            label="MRR"
            value={summary?.mrr ? `$${summary.mrr}` : '-'}
            status={summary?.mrr > 0 ? 'success' : 'neutral'}
          />
        </div>
      </div>

      {/* Stripe Status */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-purple-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
          </svg>
          <span className="font-medium text-purple-900">Stripe Customer Data</span>
        </div>
        <div className="p-4">
          {stripeStatus?.error ? (
            <p className="text-sm text-red-600">{stripeStatus.error}</p>
          ) : stripeStatus?.found ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <DataItem label="Customer ID" value={stripeStatus.customerId} />
                <DataItem label="Email" value={stripeStatus.email || '-'} />
                <DataItem label="Name" value={stripeStatus.name || '-'} />
                <DataItem label="Status" value={stripeStatus.status} highlight={stripeStatus.isActive ? 'success' : stripeStatus.isChurned ? 'danger' : 'warning'} />
                <DataItem label="Plan" value={stripeStatus.plan || '-'} />
                <DataItem label="MRR" value={stripeStatus.mrr ? `$${stripeStatus.mrr}` : '-'} />
                <DataItem label="LTV" value={stripeStatus.ltv ? `$${stripeStatus.ltv.toFixed(2)}` : '-'} />
                <DataItem label="Last Payment" value={stripeStatus.lastPaymentDate ? new Date(stripeStatus.lastPaymentDate).toLocaleDateString() : '-'} />
                <DataItem label="Customer Since" value={stripeStatus.createdAt ? new Date(stripeStatus.createdAt).toLocaleDateString() : '-'} />
              </div>
              <div className="text-xs text-gray-500">
                Matched by: {stripeStatus.matchedBy} | {stripeStatus.subscriptionCount} subscription(s), {stripeStatus.chargeCount} charge(s)
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              <p className="text-sm text-gray-500">No customer found in Stripe</p>
            </div>
          )}
        </div>
      </div>

      {/* Slack Status */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-green-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
          </svg>
          <span className="font-medium text-green-900">Slack Deal Tracking</span>
        </div>
        <div className="p-4">
          {slackStatus?.error ? (
            <p className="text-sm text-amber-600">
              {slackStatus.error === 'Slack integration not configured'
                ? 'Slack integration not configured. Add SLACK_BOT_TOKEN to enable.'
                : slackStatus.error}
            </p>
          ) : slackStatus?.summary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <DataItem
                  label="Deal Closed"
                  value={slackStatus.summary.dealClosed ? 'Yes' : 'No'}
                  highlight={slackStatus.summary.dealClosed ? 'success' : 'neutral'}
                />
                <DataItem
                  label="Deal Type"
                  value={slackStatus.summary.dealType || '-'}
                  highlight={slackStatus.summary.dealType === 'software' ? 'success' : 'warning'}
                />
                <DataItem
                  label="Customer Active"
                  value={slackStatus.summary.isActive ? 'Yes' : slackStatus.summary.isChurned ? 'Churned' : 'Unknown'}
                  highlight={slackStatus.summary.isActive ? 'success' : slackStatus.summary.isChurned ? 'danger' : 'neutral'}
                />
              </div>

              {slackStatus.signupInfo && (
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs font-medium text-gray-500 mb-1">Signup Message:</p>
                  <p className="text-sm text-gray-700">{slackStatus.signupInfo.message}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {slackStatus.signupInfo.date} in {slackStatus.signupInfo.channel}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm text-gray-500">No deal found in Slack channels</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, status }) {
  const statusColors = {
    success: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    danger: 'bg-red-100 text-red-800 border-red-200',
    neutral: 'bg-gray-100 text-gray-800 border-gray-200'
  };

  return (
    <div className={`rounded-lg border p-3 ${statusColors[status] || statusColors.neutral}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-lg font-bold mt-1">{value}</p>
    </div>
  );
}

function DataItem({ label, value, highlight }) {
  const highlightColors = {
    success: 'text-green-600',
    warning: 'text-amber-600',
    danger: 'text-red-600'
  };

  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${highlight ? highlightColors[highlight] : 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}

function LanguageSection({ assets }) {
  if (!assets) return <EmptyState message="No language assets recorded" />;

  const hasAssets = (assets.industryTerms?.length > 0) ||
                   (assets.emotionalLanguage?.length > 0) ||
                   (assets.powerWords?.length > 0);

  if (!hasAssets) return <EmptyState message="No language assets recorded" />;

  return (
    <div className="space-y-6">
      {assets.industryTerms && assets.industryTerms.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">Industry Terms</h4>
          <div className="flex flex-wrap gap-2">
            {assets.industryTerms.map((term, i) => (
              <span key={i} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                {term.term}
              </span>
            ))}
          </div>
        </div>
      )}

      {assets.emotionalLanguage && assets.emotionalLanguage.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">Emotional Language</h4>
          <div className="space-y-2">
            {assets.emotionalLanguage.map((lang, i) => (
              <div key={i} className="text-sm bg-amber-50 rounded p-2">
                <p className="text-amber-800">"{lang.phrase}"</p>
                <p className="text-xs text-amber-600 mt-1">Emotion: {lang.emotion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {assets.powerWords && assets.powerWords.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">Power Words</h4>
          <div className="flex flex-wrap gap-2">
            {assets.powerWords.map((word, i) => (
              <span key={i} className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium">
                {word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineSection({ moments }) {
  if (!moments || moments.length === 0) {
    return <EmptyState message="No key moments recorded" />;
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
      <div className="space-y-4">
        {moments.map((moment, i) => (
          <div key={i} className="relative flex gap-4 ml-4">
            <div className={`absolute -left-4 w-3 h-3 rounded-full border-2 border-white ${
              moment.impact === 'High' ? 'bg-primary-500' : 'bg-gray-400'
            }`} style={{ top: '6px' }} />
            <div className="flex-1 bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{moment.event}</span>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-xs rounded ${
                    moment.impact === 'High' ? 'bg-primary-100 text-primary-800' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {moment.impact}
                  </span>
                  <span className="text-xs text-gray-500">{moment.timestamp}</span>
                </div>
              </div>
              {moment.quote && (
                <p className="text-sm text-gray-600 mt-1 italic">"{moment.quote}"</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="text-center py-8">
      <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-gray-500">{message}</p>
    </div>
  );
}

export default CallDetailModal;
