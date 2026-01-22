import { useQuery } from '@tanstack/react-query';
import { DateFilter, DashboardData } from '../types';
import { fetchDashboardData } from '../services/api';

export function useVendorData(filter: DateFilter) {
  return useQuery<DashboardData, Error>({
    queryKey: ['dashboard', filter],
    queryFn: () => fetchDashboardData(filter),
    staleTime: 1000 * 60 * 5, // 5 Minuten
    refetchOnWindowFocus: false,
  });
}

export function useDashboard(filter: DateFilter) {
  const { data, isLoading, error, refetch } = useVendorData(filter);

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
  };
}
