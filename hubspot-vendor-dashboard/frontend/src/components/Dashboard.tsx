import { useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { DateFilter as DateFilterType, VendorFilter } from '../types';
import { useDashboard } from '../hooks/useVendorData';
import { DateFilter } from './DateFilter';
import { VendorFilterPanel } from './VendorFilterPanel';
import { KPICards } from './KPICards';
import { VendorList } from './VendorList';
import { AlertPanel } from './AlertPanel';
import { OnboardingTable } from './OnboardingTable';
import { UTMChart } from './UTMChart';

export function Dashboard() {
  const [dateFilter, setDateFilter] = useState<DateFilterType>({ type: 'this_month' });
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>({});

  const {
    isLoading,
    error,
    refetch,
    summary,
    activeVendors,
    churnedVendors,
    decliningVendors,
    weeklyOnboarding,
    utmAttribution,
    availableRoles,
    availableLanguages,
  } = useDashboard(dateFilter, vendorFilter);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                HubSpot Vendor Dashboard
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Übersicht aktiver Vendoren und Performance-Alerts
              </p>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Aktualisieren
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {/* Date Filter */}
        <DateFilter value={dateFilter} onChange={setDateFilter} />

        {/* Vendor Filter (Role & Language) */}
        <VendorFilterPanel
          value={vendorFilter}
          onChange={setVendorFilter}
          availableRoles={availableRoles}
          availableLanguages={availableLanguages}
        />

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-900">Fehler beim Laden der Daten</h3>
              <p className="text-sm text-red-700 mt-1">{error.message}</p>
              <button
                onClick={() => refetch()}
                className="text-sm text-red-700 underline hover:text-red-900 mt-2"
              >
                Erneut versuchen
              </button>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <KPICards summary={summary} isLoading={isLoading} />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Active Vendors */}
          <VendorList
            vendors={activeVendors}
            title="Aktive Vendoren"
            maxItems={10}
          />

          {/* Right Column - Alerts */}
          <AlertPanel
            churnedVendors={churnedVendors}
            decliningVendors={decliningVendors}
          />
        </div>

        {/* Onboarding Section */}
        <OnboardingTable onboarding={weeklyOnboarding} summary={summary} />

        {/* UTM Attribution Section */}
        <UTMChart attribution={utmAttribution} />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-sm text-gray-500 text-center">
            Daten werden von HubSpot CRM geladen • Letzte Aktualisierung:{' '}
            {new Date().toLocaleString('de-DE')}
          </p>
        </div>
      </footer>
    </div>
  );
}
