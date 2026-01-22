import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Vendor } from '../types';
import clsx from 'clsx';

interface VendorListProps {
  vendors: Vendor[];
  title: string;
  showAll?: boolean;
  maxItems?: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(0)}%`;
}

function getSourceBadgeColor(source: string | null): string {
  if (!source) return 'bg-gray-100 text-gray-600';

  const lowerSource = source.toLowerCase();
  if (lowerSource.includes('meta')) return 'bg-blue-100 text-blue-700';
  if (lowerSource.includes('google')) return 'bg-red-100 text-red-700';
  if (lowerSource.includes('organic')) return 'bg-green-100 text-green-700';
  if (lowerSource.includes('email')) return 'bg-purple-100 text-purple-700';
  if (lowerSource.includes('referral')) return 'bg-orange-100 text-orange-700';

  return 'bg-gray-100 text-gray-600';
}

export function VendorList({ vendors, title, showAll = false, maxItems = 10 }: VendorListProps) {
  const [expanded, setExpanded] = useState(showAll);
  const displayedVendors = expanded ? vendors : vendors.slice(0, maxItems);
  const hasMore = vendors.length > maxItems;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span className="text-sm text-gray-500">{vendors.length} Vendoren</span>
      </div>

      <div className="divide-y divide-gray-100">
        {displayedVendors.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            Keine Vendoren gefunden
          </div>
        ) : (
          displayedVendors.map((vendor) => (
            <div
              key={vendor.id}
              className="px-6 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">
                      {vendor.name || vendor.email}
                    </p>
                    {vendor.status === 'new' && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                        Neu
                      </span>
                    )}
                  </div>
                  {vendor.utmSource && (
                    <span
                      className={clsx(
                        'inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded',
                        getSourceBadgeColor(vendor.utmSource)
                      )}
                    >
                      {vendor.utmSource}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 ml-4">
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(vendor.totalRevenue)}
                    </p>
                    <p
                      className={clsx(
                        'text-sm font-medium',
                        vendor.revenueChange >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {vendor.revenueChange >= 0 ? '▲' : '▼'} {formatChange(vendor.revenueChange)}
                    </p>
                  </div>
                  <a
                    href={`https://app.hubspot.com/contacts/${vendor.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                    title="In HubSpot öffnen"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {hasMore && !showAll && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-6 py-3 text-sm font-medium text-primary-600 hover:bg-gray-50 border-t border-gray-200 flex items-center justify-center gap-1 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Weniger anzeigen
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Alle {vendors.length} Vendoren anzeigen
            </>
          )}
        </button>
      )}
    </div>
  );
}
