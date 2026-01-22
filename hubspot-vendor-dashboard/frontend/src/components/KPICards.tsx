import { Users, UserMinus, TrendingDown, UserPlus } from 'lucide-react';
import { VendorSummary } from '../types';
import clsx from 'clsx';

interface KPICardsProps {
  summary: VendorSummary | undefined;
  isLoading: boolean;
}

interface KPICardProps {
  title: string;
  value: number | string;
  change?: number;
  icon: React.ReactNode;
  variant: 'default' | 'warning' | 'danger' | 'info';
  subtitle?: string;
}

function KPICard({ title, value, change, icon, variant, subtitle }: KPICardProps) {
  const bgColors = {
    default: 'bg-white',
    warning: 'bg-amber-50 border-amber-200',
    danger: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200',
  };

  const iconColors = {
    default: 'text-primary-600 bg-primary-100',
    warning: 'text-amber-600 bg-amber-100',
    danger: 'text-red-600 bg-red-100',
    info: 'text-blue-600 bg-blue-100',
  };

  return (
    <div className={clsx('p-6 rounded-xl border shadow-sm', bgColors[variant])}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {change !== undefined && (
            <p
              className={clsx(
                'mt-1 text-sm font-medium',
                change >= 0 ? 'text-green-600' : 'text-red-600'
              )}
            >
              {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
            </p>
          )}
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className={clsx('p-3 rounded-lg', iconColors[variant])}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export function KPICards({ summary, isLoading }: KPICardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="p-6 rounded-xl border bg-white shadow-sm animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-4" />
            <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-4 bg-gray-200 rounded w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <KPICard
        title="Aktive Vendoren"
        value={summary.activeVendors}
        change={summary.activeVendorsChange}
        icon={<Users className="w-6 h-6" />}
        variant="default"
      />
      <KPICard
        title="Churned Vendoren"
        value={summary.churnedVendors}
        icon={<UserMinus className="w-6 h-6" />}
        variant={summary.churnedVendors > 0 ? 'warning' : 'default'}
        subtitle="Letzten Monat aktiv"
      />
      <KPICard
        title="Umsatzeinbruch"
        value={summary.decliningVendors}
        icon={<TrendingDown className="w-6 h-6" />}
        variant={summary.decliningVendors > 0 ? 'danger' : 'default'}
        subtitle=">30% Rückgang"
      />
      <KPICard
        title="Neue Accounts"
        value={summary.newAccountsThisWeek}
        icon={<UserPlus className="w-6 h-6" />}
        variant="info"
        subtitle={`Ø ${summary.avgDaysToFirstSale} Tage bis 1. Verkauf`}
      />
    </div>
  );
}
