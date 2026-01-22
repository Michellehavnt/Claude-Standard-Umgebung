import { useQuery } from '@tanstack/react-query';
import { DateFilter, DashboardData, VendorFilter } from '../types';
import { fetchDashboardData } from '../services/api';

export function useVendorData(filter: DateFilter, vendorFilter?: VendorFilter) {
  return useQuery<DashboardData, Error>({
    queryKey: ['dashboard', filter, vendorFilter],
    queryFn: () => fetchDashboardData(filter, vendorFilter),
    staleTime: 1000 * 60 * 5, // 5 Minuten
    refetchOnWindowFocus: false,
  });
}

export function useDashboard(filter: DateFilter, vendorFilter?: VendorFilter) {
  const { data, isLoading, error, refetch } = useVendorData(filter, vendorFilter);

  return {
    data,
    isLoading,
    error,
    refetch,
    summary: data?.summary,
    activeVendors: data?.activeVendors || [],
    churnedVendors: data?.churnedVendors || [],
    decliningVendors: data?.decliningVendors || [],
    weeklyOnboarding: data?.weeklyOnboarding || [],
    utmAttribution: data?.utmAttribution || [],
    availableRoles: data?.availableRoles || [],
    availableLanguages: data?.availableLanguages || [],
  };
}
