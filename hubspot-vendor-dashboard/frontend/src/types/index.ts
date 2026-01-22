export interface Vendor {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  firstSaleDate: string | null;
  totalRevenue: number;
  revenueChange: number;
  lastActivityDate: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  status: 'active' | 'churned' | 'declining' | 'new';
  role: string | null;
  language: string | null;
}

export interface VendorFilter {
  role?: string;
  language?: string;
}

export interface VendorSummary {
  activeVendors: number;
  activeVendorsChange: number;
  churnedVendors: number;
  decliningVendors: number;
  newAccountsThisWeek: number;
  avgDaysToFirstSale: number;
}

export interface WeeklyOnboarding {
  week: string;
  weekNumber: number;
  year: number;
  newAccounts: number;
  firstSales: number;
  avgDaysToFirstSale: number;
  conversionRate: number;
}

export interface UTMAttribution {
  source: string;
  vendorCount: number;
  percentage: number;
  totalRevenue: number;
}

export type DateFilterType =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | '3_months'
  | '6_months'
  | 'custom';

export interface DateFilter {
  type: DateFilterType;
  startDate?: string;
  endDate?: string;
}

export interface DashboardData {
  summary: VendorSummary;
  activeVendors: Vendor[];
  churnedVendors: Vendor[];
  decliningVendors: Vendor[];
  weeklyOnboarding: WeeklyOnboarding[];
  utmAttribution: UTMAttribution[];
  filter: DateFilter;
  vendorFilter: VendorFilter;
  availableRoles: string[];
  availableLanguages: string[];
}
