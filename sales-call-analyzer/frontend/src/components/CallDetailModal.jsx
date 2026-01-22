import React, { useState } from 'react';

function CallDetailModal({ call, onClose }) {
  const [activeSection, setActiveSection] = useState('overview');
  const analysis = call.analysis || {};

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'painPoints', label: 'Pain Points' },
    { id: 'objections', label: 'Objections' },
    { id: 'excitement', label: 'Excitement' },
    { id: 'dfy', label: 'DFY Analysis' },
    { id: 'language', label: 'Language Assets' },
    { id: 'timeline', label: 'Key Moments' }
  ];

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
