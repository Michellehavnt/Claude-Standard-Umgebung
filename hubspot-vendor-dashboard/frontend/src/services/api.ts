import { DashboardData, DateFilter, Vendor, WeeklyOnboarding, UTMAttribution } from '../types';

const API_BASE = '/api';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP error ${response.status}`);
  }

  return response.json();
}

function buildQueryString(filter: DateFilter): string {
  const params = new URLSearchParams();
  params.set('filter', filter.type);

  if (filter.type === 'custom' && filter.startDate && filter.endDate) {
    params.set('startDate', filter.startDate);
    params.set('endDate', filter.endDate);
  }

  return params.toString();
}

export async function fetchDashboardData(filter: DateFilter): Promise<DashboardData> {
  const query = buildQueryString(filter);
  return fetchAPI<DashboardData>(`/vendors/dashboard?${query}`);
}

export async function fetchActiveVendors(
  filter: DateFilter,
  sortBy: string = 'revenue',
  sortOrder: string = 'desc'
): Promise<{ vendors: Vendor[]; total: number }> {
  const params = new URLSearchParams();
  params.set('filter', filter.type);
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);

  if (filter.type === 'custom' && filter.startDate && filter.endDate) {
    params.set('startDate', filter.startDate);
    params.set('endDate', filter.endDate);
  }

  return fetchAPI<{ vendors: Vendor[]; total: number }>(`/vendors/active?${params.toString()}`);
}

export async function fetchChurnedVendors(filter: DateFilter): Promise<{ vendors: Vendor[]; total: number }> {
  const query = buildQueryString(filter);
  return fetchAPI<{ vendors: Vendor[]; total: number }>(`/vendors/churned?${query}`);
}

export async function fetchDecliningVendors(filter: DateFilter): Promise<{ vendors: Vendor[]; total: number }> {
  const query = buildQueryString(filter);
  return fetchAPI<{ vendors: Vendor[]; total: number }>(`/vendors/declining?${query}`);
}

export async function fetchOnboardingData(filter: DateFilter): Promise<{ onboarding: WeeklyOnboarding[] }> {
  const query = buildQueryString(filter);
  return fetchAPI<{ onboarding: WeeklyOnboarding[] }>(`/vendors/onboarding?${query}`);
}

export async function fetchUTMData(filter: DateFilter): Promise<{ attribution: UTMAttribution[] }> {
  const query = buildQueryString(filter);
  return fetchAPI<{ attribution: UTMAttribution[] }>(`/vendors/utm?${query}`);
}

export async function fetchVendorDetails(id: string, filter: DateFilter): Promise<{ vendor: Vendor }> {
  const query = buildQueryString(filter);
  return fetchAPI<{ vendor: Vendor }>(`/vendors/${id}?${query}`);
}

export async function checkHealth(): Promise<{ status: string; hubspotConfigured: boolean }> {
  return fetchAPI<{ status: string; hubspotConfigured: boolean }>('/health');
}
