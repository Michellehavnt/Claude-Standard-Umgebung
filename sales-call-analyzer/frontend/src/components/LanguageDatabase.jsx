import React, { useState, useEffect } from 'react';

const API_BASE = '/api';

function LanguageDatabase({ filters }) {
  const [language, setLanguage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    fetchLanguage();
  }, [filters]);

  const fetchLanguage = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);

      const res = await fetch(`${API_BASE}/language?${queryParams}`);

      if (res.ok) {
        const data = await res.json();
        setLanguage(data.data || null);
      }
    } catch (err) {
      console.error('Error fetching language:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="loading-spinner mx-auto mb-4" />
        <p className="text-gray-500">Loading language database...</p>
      </div>
    );
  }

  if (!language) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-gray-500">No language data available</p>
      </div>
    );
  }

  const categories = [
    { id: 'all', label: 'All', color: 'gray' },
    { id: 'industry_term', label: 'Industry Terms', color: 'blue' },
    { id: 'emotional', label: 'Emotional Language', color: 'amber' },
    { id: 'metaphor', label: 'Metaphors', color: 'purple' },
    { id: 'power_word', label: 'Power Words', color: 'red' }
  ];

  const getFilteredData = () => {
    if (activeCategory === 'all') {
      return {
        industry_term: language.industry_term || [],
        emotional: language.emotional || [],
        metaphor: language.metaphor || [],
        power_word: language.power_word || []
      };
    }
    return {
      [activeCategory]: language[activeCategory] || []
    };
  };

  const filteredData = getFilteredData();

  const totalCount = Object.values(language).reduce((sum, arr) => sum + (arr?.length || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Customer Language Database</h2>
            <p className="text-sm text-gray-500 mt-1">
              Language patterns extracted from prospect statements during sales calls
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-primary-600">{totalCount}</p>
            <p className="text-xs text-gray-500">Total phrases</p>
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => {
            const count = cat.id === 'all'
              ? totalCount
              : (language[cat.id]?.length || 0);

            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  activeCategory === cat.id
                    ? `bg-${cat.color}-100 text-${cat.color}-800 border border-${cat.color}-300`
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={activeCategory === cat.id ? {
                  backgroundColor: cat.color === 'gray' ? '#f3f4f6' :
                                  cat.color === 'blue' ? '#dbeafe' :
                                  cat.color === 'amber' ? '#fef3c7' :
                                  cat.color === 'purple' ? '#f3e8ff' :
                                  '#fee2e2',
                  color: cat.color === 'gray' ? '#374151' :
                        cat.color === 'blue' ? '#1e40af' :
                        cat.color === 'amber' ? '#92400e' :
                        cat.color === 'purple' ? '#6b21a8' :
                        '#991b1b'
                } : {}}
              >
                {cat.label}
                <span className="text-xs opacity-75">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(filteredData).map(([type, items]) => {
          if (!items || items.length === 0) return null;

          const config = {
            industry_term: {
              title: 'Industry Terms',
              description: 'Tools, platforms, and industry-specific vocabulary',
              bgColor: 'bg-blue-50',
              borderColor: 'border-blue-200',
              tagColor: 'bg-blue-100 text-blue-800'
            },
            emotional: {
              title: 'Emotional Language',
              description: 'Phrases expressing feelings and frustrations',
              bgColor: 'bg-amber-50',
              borderColor: 'border-amber-200',
              tagColor: 'bg-amber-100 text-amber-800'
            },
            metaphor: {
              title: 'Metaphors & Analogies',
              description: 'Descriptive comparisons used by prospects',
              bgColor: 'bg-purple-50',
              borderColor: 'border-purple-200',
              tagColor: 'bg-purple-100 text-purple-800'
            },
            power_word: {
              title: 'Power Words',
              description: 'High-impact words indicating urgency or intensity',
              bgColor: 'bg-red-50',
              borderColor: 'border-red-200',
              tagColor: 'bg-red-100 text-red-800'
            }
          };

          const cfg = config[type];

          return (
            <div key={type} className={`rounded-lg border p-6 ${cfg.bgColor} ${cfg.borderColor}`}>
              <h3 className="text-lg font-medium text-gray-900 mb-1">{cfg.title}</h3>
              <p className="text-sm text-gray-500 mb-4">{cfg.description}</p>

              {type === 'power_word' ? (
                <div className="flex flex-wrap gap-2">
                  {items.map((item, i) => (
                    <span key={i} className={`px-3 py-1.5 rounded-full text-sm font-medium ${cfg.tagColor}`}>
                      {item.phrase}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {items.map((item, i) => (
                    <div key={i} className="bg-white rounded-lg p-3 shadow-sm">
                      <p className="font-medium text-gray-900">{item.phrase}</p>
                      {item.context && (
                        <p className="text-sm text-gray-500 mt-1">{item.context}</p>
                      )}
                      {item.prospect && (
                        <p className="text-xs text-gray-400 mt-2">
                          — {item.prospect} ({item.date ? new Date(item.date).toLocaleDateString() : '-'})
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Usage Tips */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">How to Use This Data</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TipCard
            title="Marketing Copy"
            description="Use emotional language and power words in ad copy and landing pages to resonate with prospects."
            icon="📝"
          />
          <TipCard
            title="Sales Scripts"
            description="Mirror industry terms and metaphors to build rapport and demonstrate understanding."
            icon="🎯"
          />
          <TipCard
            title="Content Creation"
            description="Address pain points using the exact language your prospects use."
            icon="✍️"
          />
          <TipCard
            title="Product Messaging"
            description="Highlight features that solve the most frequently mentioned frustrations."
            icon="💡"
          />
        </div>
      </div>
    </div>
  );
}

function TipCard({ title, description, icon }) {
  return (
    <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
      <span className="text-2xl">{icon}</span>
      <div>
        <h4 className="font-medium text-gray-900">{title}</h4>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>
    </div>
  );
}

export default LanguageDatabase;
