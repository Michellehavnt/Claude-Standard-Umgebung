import { Calendar, Clock, TrendingUp } from 'lucide-react';
import { WeeklyOnboarding, VendorSummary } from '../types';
import clsx from 'clsx';

interface OnboardingTableProps {
  onboarding: WeeklyOnboarding[];
  summary: VendorSummary | undefined;
}

export function OnboardingTable({ onboarding, summary }: OnboardingTableProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">Neue Vendoren - Onboarding Pipeline</h3>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 p-6 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-600">Ø Zeit bis 1. Verkauf</p>
            <p className="text-xl font-bold text-gray-900">
              {summary?.avgDaysToFirstSale || 0} Tage
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-600">Diese Woche neu</p>
            <p className="text-xl font-bold text-gray-900">
              {summary?.newAccountsThisWeek || 0} Accounts
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Woche
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Neue Accounts
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Erster Verkauf
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Ø Tage
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Conversion
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {onboarding.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  Keine Daten verfügbar
                </td>
              </tr>
            ) : (
              onboarding.map((week, index) => (
                <tr
                  key={`${week.year}-${week.weekNumber}`}
                  className={clsx(
                    'hover:bg-gray-50 transition-colors',
                    index === 0 && 'bg-blue-50'
                  )}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className={clsx(
                        'font-medium',
                        index === 0 ? 'text-blue-700' : 'text-gray-900'
                      )}>
                        {week.week}
                        {index === 0 && (
                          <span className="ml-2 text-xs text-blue-600">(aktuell)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-semibold text-gray-900">{week.newAccounts}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-semibold text-gray-900">{week.firstSales}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-gray-700">
                      {week.avgDaysToFirstSale > 0 ? week.avgDaysToFirstSale : '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={clsx(
                        'inline-block px-2 py-1 rounded-full text-sm font-medium',
                        week.conversionRate >= 70
                          ? 'bg-green-100 text-green-700'
                          : week.conversionRate >= 40
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      )}
                    >
                      {week.conversionRate}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
