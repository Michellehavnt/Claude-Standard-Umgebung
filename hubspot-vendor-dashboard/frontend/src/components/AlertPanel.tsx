import { AlertTriangle, TrendingDown, ExternalLink } from 'lucide-react';
import { Vendor } from '../types';
import clsx from 'clsx';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

interface AlertPanelProps {
  churnedVendors: Vendor[];
  decliningVendors: Vendor[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  try {
    return format(parseISO(dateString), 'dd.MM.yyyy', { locale: de });
  } catch {
    return '-';
  }
}

export function AlertPanel({ churnedVendors, decliningVendors }: AlertPanelProps) {
  return (
    <div className="space-y-6">
      {/* Churned Vendors Alert */}
      <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">Churned Vendoren</h3>
            <p className="text-sm text-amber-700">Letzten Monat aktiv, jetzt inaktiv</p>
          </div>
          <span className="ml-auto px-3 py-1 bg-amber-200 text-amber-800 text-sm font-semibold rounded-full">
            {churnedVendors.length}
          </span>
        </div>

        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {churnedVendors.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              Keine gechurnten Vendoren
            </div>
          ) : (
            churnedVendors.slice(0, 5).map((vendor) => (
              <div key={vendor.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{vendor.name || vendor.email}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Letzter Umsatz: {formatCurrency(vendor.totalRevenue)}
                    </p>
                    <p className="text-sm text-gray-500">
                      Letzte Aktivität: {formatDate(vendor.lastActivityDate)}
                    </p>
                    {vendor.utmSource && (
                      <p className="text-sm text-gray-400 mt-1">
                        Quelle: {vendor.utmSource}
                      </p>
                    )}
                  </div>
                  <a
                    href={`https://app.hubspot.com/contacts/${vendor.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-400 hover:text-amber-600 transition-colors"
                    title="In HubSpot öffnen"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>

        {churnedVendors.length > 5 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center">
            <span className="text-sm text-gray-600">
              + {churnedVendors.length - 5} weitere
            </span>
          </div>
        )}
      </div>

      {/* Declining Vendors Alert */}
      <div className="bg-white rounded-xl border border-red-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-red-50 border-b border-red-200 flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <TrendingDown className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-red-900">Umsatzeinbruch</h3>
            <p className="text-sm text-red-700">{'>'}30% Rückgang im Vergleich zur Vorperiode</p>
          </div>
          <span className="ml-auto px-3 py-1 bg-red-200 text-red-800 text-sm font-semibold rounded-full">
            {decliningVendors.length}
          </span>
        </div>

        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {decliningVendors.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              Keine Vendoren mit Umsatzeinbruch
            </div>
          ) : (
            decliningVendors.slice(0, 5).map((vendor) => (
              <div key={vendor.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{vendor.name || vendor.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-gray-700">
                        {formatCurrency(vendor.totalRevenue)}
                      </span>
                      <span
                        className={clsx(
                          'text-sm font-semibold px-2 py-0.5 rounded',
                          'bg-red-100 text-red-700'
                        )}
                      >
                        ▼ {Math.abs(vendor.revenueChange).toFixed(0)}%
                      </span>
                    </div>
                    {vendor.utmSource && (
                      <p className="text-sm text-gray-400 mt-1">
                        Quelle: {vendor.utmSource}
                      </p>
                    )}
                  </div>
                  <a
                    href={`https://app.hubspot.com/contacts/${vendor.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    title="In HubSpot öffnen"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>

        {decliningVendors.length > 5 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center">
            <span className="text-sm text-gray-600">
              + {decliningVendors.length - 5} weitere
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
