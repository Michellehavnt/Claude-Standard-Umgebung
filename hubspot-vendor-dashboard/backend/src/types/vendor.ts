export interface Vendor {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  firstSaleDate: string | null;
  totalRevenue: number;
  revenueChange: number; // Prozentuale Änderung
  lastActivityDate: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  status: 'active' | 'churned' | 'declining' | 'new';
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

export interface DateFilter {
  type: 'today' | 'this_week' | 'this_month' | 'last_month' | '3_months' | '6_months' | 'custom';
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
}

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    amount: string;
    closedate: string;
    dealstage: string;
    hs_object_id: string;
  };
  associations?: {
    contacts?: { results: Array<{ id: string }> };
    companies?: { results: Array<{ id: string }> };
  };
}

export interface HubSpotContact {
  id: string;
  properties: {
    email: string;
    firstname: string;
    lastname: string;
    createdate: string;
    hs_analytics_source: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    [key: string]: string;
  };
}
