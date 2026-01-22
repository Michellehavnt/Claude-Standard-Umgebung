import { Users, Globe } from 'lucide-react';
import { VendorFilter } from '../types';
import clsx from 'clsx';

interface VendorFilterPanelProps {
  value: VendorFilter;
  onChange: (filter: VendorFilter) => void;
  availableRoles: string[];
  availableLanguages: string[];
}

export function VendorFilterPanel({
  value,
  onChange,
  availableRoles,
  availableLanguages,
}: VendorFilterPanelProps) {
  const handleRoleChange = (role: string) => {
    onChange({
      ...value,
      role: role === 'all' ? undefined : role,
    });
  };

  const handleLanguageChange = (language: string) => {
    onChange({
      ...value,
      language: language === 'all' ? undefined : language,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Role Filter */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-600">Rolle:</span>
        <select
          value={value.role || 'all'}
          onChange={(e) => handleRoleChange(e.target.value)}
          className={clsx(
            'px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
            value.role ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white'
          )}
        >
          <option value="all">Alle Rollen</option>
          {availableRoles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      {/* Language Filter */}
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-600">Region:</span>
        <select
          value={value.language || 'all'}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className={clsx(
            'px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
            value.language ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white'
          )}
        >
          <option value="all">Alle Regionen</option>
          {availableLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>

      {/* Clear Filters Button */}
      {(value.role || value.language) && (
        <button
          onClick={() => onChange({})}
          className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
        >
          Filter zurücksetzen
        </button>
      )}
    </div>
  );
}
