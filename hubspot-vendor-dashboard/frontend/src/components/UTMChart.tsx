import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { UTMAttribution } from '../types';

interface UTMChartProps {
  attribution: UTMAttribution[];
}

const COLORS: Record<string, string> = {
  'Meta Ads': '#3b82f6',
  'Google Ads': '#ef4444',
  'Organic': '#22c55e',
  'Email': '#a855f7',
  'Referral': '#f97316',
  'Direct': '#6b7280',
  'Social': '#ec4899',
  'Unbekannt': '#9ca3af',
};

function getColor(source: string): string {
  return COLORS[source] || COLORS['Unbekannt'];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: UTMAttribution;
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;

  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
      <p className="font-semibold text-gray-900">{data.source}</p>
      <p className="text-sm text-gray-600">
        {data.vendorCount} Vendoren ({data.percentage}%)
      </p>
      <p className="text-sm font-medium text-primary-600">
        {formatCurrency(data.totalRevenue)}
      </p>
    </div>
  );
}

export function UTMChart({ attribution }: UTMChartProps) {
  const totalRevenue = attribution.reduce((sum, a) => sum + a.totalRevenue, 0);
  const totalVendors = attribution.reduce((sum, a) => sum + a.vendorCount, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">Akquisitions-Quellen (UTM Attribution)</h3>
        <p className="text-sm text-gray-500 mt-1">
          {totalVendors} Vendoren • {formatCurrency(totalRevenue)} Gesamtumsatz
        </p>
      </div>

      <div className="p-6">
        {attribution.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            Keine UTM-Daten verfügbar
          </div>
        ) : (
          <>
            {/* Bar Chart */}
            <div className="h-64 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={attribution}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 80 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="source"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#374151', fontSize: 14 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="vendorCount" radius={[0, 4, 4, 0]}>
                    {attribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.source)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Legend with details */}
            <div className="space-y-3">
              {attribution.map((item) => (
                <div key={item.source} className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: getColor(item.source) }}
                  />
                  <span className="flex-1 text-sm font-medium text-gray-900">
                    {item.source}
                  </span>
                  <span className="text-sm text-gray-600">
                    {item.percentage}%
                  </span>
                  <span className="text-sm text-gray-500">
                    ({item.vendorCount} Vendoren)
                  </span>
                  <span className="text-sm font-medium text-gray-900 w-24 text-right">
                    {formatCurrency(item.totalRevenue)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
