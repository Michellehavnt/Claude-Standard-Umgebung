import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { DateFilter as DateFilterType, DateFilterType as FilterType } from '../types';
import clsx from 'clsx';

interface DateFilterProps {
  value: DateFilterType;
  onChange: (filter: DateFilterType) => void;
}

const filterOptions: { value: FilterType; label: string }[] = [
  { value: 'today', label: 'Heute' },
  { value: 'this_week', label: 'Diese Woche' },
  { value: 'this_month', label: 'Diesen Monat' },
  { value: 'last_month', label: 'Letzter Monat' },
  { value: '3_months', label: '3 Monate' },
  { value: '6_months', label: '6 Monate' },
  { value: 'custom', label: 'Custom' },
];

export function DateFilter({ value, onChange }: DateFilterProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const handleFilterClick = (type: FilterType) => {
    if (type === 'custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      onChange({ type });
    }
  };

  const handleCustomApply = () => {
    if (customStart && customEnd) {
      onChange({
        type: 'custom',
        startDate: customStart,
        endDate: customEnd,
      });
      setShowCustom(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      <span className="text-sm font-medium text-gray-600 mr-2">Zeitraum:</span>

      {filterOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => handleFilterClick(option.value)}
          className={clsx(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            value.type === option.value
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          )}
        >
          {option.value === 'custom' && <Calendar className="inline-block w-4 h-4 mr-1" />}
          {option.label}
        </button>
      ))}

      {showCustom && (
        <div className="flex items-center gap-2 ml-4 p-2 bg-gray-50 rounded-md">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          />
          <span className="text-gray-500">bis</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          />
          <button
            onClick={handleCustomApply}
            className="px-3 py-1 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            Anwenden
          </button>
        </div>
      )}
    </div>
  );
}
