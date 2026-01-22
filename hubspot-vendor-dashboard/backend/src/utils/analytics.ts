import {
  Vendor,
  VendorSummary,
  WeeklyOnboarding,
  UTMAttribution,
  HubSpotContact,
  HubSpotDeal,
} from '../types/vendor';
import { daysBetween, getWeekNumber, formatWeekLabel, getWeeksInRange } from './dateFilters';

const REVENUE_DECLINE_THRESHOLD = 0.30; // 30% Rückgang

interface DealWithContact {
  deal: HubSpotDeal;
  contactId: string | null;
}

export function buildVendorData(
  contacts: HubSpotContact[],
  deals: HubSpotDeal[],
  previousPeriodDeals: HubSpotDeal[],
  startDate: Date,
  endDate: Date
): Vendor[] {
  // Erstelle Mapping von Contact ID zu Contact
  const contactMap = new Map<string, HubSpotContact>();
  contacts.forEach((contact) => {
    contactMap.set(contact.id, contact);
  });

  // Erstelle Mapping von Contact ID zu Deals
  const contactDealsMap = new Map<string, HubSpotDeal[]>();
  const contactPreviousDealsMap = new Map<string, HubSpotDeal[]>();

  // Aktuelle Periode
  deals.forEach((deal) => {
    const contactIds = deal.associations?.contacts?.results?.map((c) => c.id) || [];
    contactIds.forEach((contactId) => {
      if (!contactDealsMap.has(contactId)) {
        contactDealsMap.set(contactId, []);
      }
      contactDealsMap.get(contactId)!.push(deal);
    });
  });

  // Vorherige Periode
  previousPeriodDeals.forEach((deal) => {
    const contactIds = deal.associations?.contacts?.results?.map((c) => c.id) || [];
    contactIds.forEach((contactId) => {
      if (!contactPreviousDealsMap.has(contactId)) {
        contactPreviousDealsMap.set(contactId, []);
      }
      contactPreviousDealsMap.get(contactId)!.push(deal);
    });
  });

  const vendors: Vendor[] = [];

  contacts.forEach((contact) => {
    const contactDeals = contactDealsMap.get(contact.id) || [];
    const previousDeals = contactPreviousDealsMap.get(contact.id) || [];

    const currentRevenue = calculateTotalRevenue(contactDeals);
    const previousRevenue = calculateTotalRevenue(previousDeals);
    const revenueChange = previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : currentRevenue > 0 ? 100 : 0;

    const firstSaleDate = findFirstSaleDate(contactDeals);
    const lastActivityDate = findLastActivityDate(contactDeals);

    const status = determineVendorStatus(
      currentRevenue,
      previousRevenue,
      revenueChange,
      contact,
      startDate
    );

    const utmSource = contact.properties.utm_source ||
      contact.properties.hs_analytics_source ||
      null;

    vendors.push({
      id: contact.id,
      name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || contact.properties.email,
      email: contact.properties.email,
      createdAt: contact.properties.createdate,
      firstSaleDate,
      totalRevenue: currentRevenue,
      revenueChange,
      lastActivityDate,
      utmSource,
      utmMedium: contact.properties.utm_medium || null,
      utmCampaign: contact.properties.utm_campaign || null,
      status,
    });
  });

  return vendors;
}

export function calculateTotalRevenue(deals: HubSpotDeal[]): number {
  return deals.reduce((sum, deal) => {
    const amount = parseFloat(deal.properties.amount) || 0;
    return sum + amount;
  }, 0);
}

export function findFirstSaleDate(deals: HubSpotDeal[]): string | null {
  if (deals.length === 0) return null;

  const sortedDeals = [...deals].sort((a, b) => {
    const dateA = new Date(a.properties.closedate).getTime();
    const dateB = new Date(b.properties.closedate).getTime();
    return dateA - dateB;
  });

  return sortedDeals[0].properties.closedate;
}

export function findLastActivityDate(deals: HubSpotDeal[]): string | null {
  if (deals.length === 0) return null;

  const sortedDeals = [...deals].sort((a, b) => {
    const dateA = new Date(a.properties.closedate).getTime();
    const dateB = new Date(b.properties.closedate).getTime();
    return dateB - dateA;
  });

  return sortedDeals[0].properties.closedate;
}

export function determineVendorStatus(
  currentRevenue: number,
  previousRevenue: number,
  revenueChange: number,
  contact: HubSpotContact,
  startDate: Date
): 'active' | 'churned' | 'declining' | 'new' {
  const createdAt = new Date(contact.properties.createdate);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Neu: In den letzten 30 Tagen erstellt
  if (createdAt >= thirtyDaysAgo) {
    return 'new';
  }

  // Churned: Vorher aktiv, jetzt kein Umsatz
  if (previousRevenue > 0 && currentRevenue === 0) {
    return 'churned';
  }

  // Declining: Umsatz um mehr als 30% gesunken
  if (revenueChange < -REVENUE_DECLINE_THRESHOLD * 100) {
    return 'declining';
  }

  // Aktiv: Hat Umsatz im aktuellen Zeitraum
  if (currentRevenue > 0) {
    return 'active';
  }

  // Default: churned wenn kein Umsatz
  return 'churned';
}

export function calculateSummary(vendors: Vendor[], startDate: Date, endDate: Date): VendorSummary {
  const activeVendors = vendors.filter((v) => v.status === 'active' || v.status === 'new');
  const churnedVendors = vendors.filter((v) => v.status === 'churned');
  const decliningVendors = vendors.filter((v) => v.status === 'declining');

  // Neue Accounts diese Woche
  const weekStart = new Date();
  const dayOfWeek = weekStart.getDay();
  const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);

  const newAccountsThisWeek = vendors.filter((v) => {
    const createdAt = new Date(v.createdAt);
    return createdAt >= weekStart;
  }).length;

  // Durchschnittliche Tage bis zum ersten Verkauf
  const vendorsWithFirstSale = vendors.filter((v) => v.firstSaleDate);
  let avgDaysToFirstSale = 0;

  if (vendorsWithFirstSale.length > 0) {
    const totalDays = vendorsWithFirstSale.reduce((sum, v) => {
      const createdAt = new Date(v.createdAt);
      const firstSale = new Date(v.firstSaleDate!);
      return sum + daysBetween(createdAt, firstSale);
    }, 0);
    avgDaysToFirstSale = Math.round(totalDays / vendorsWithFirstSale.length);
  }

  // Berechne Änderung der aktiven Vendoren (vereinfacht)
  const activeVendorsChange = activeVendors.length > 0
    ? ((activeVendors.length - (activeVendors.length - newAccountsThisWeek)) / activeVendors.length) * 100
    : 0;

  return {
    activeVendors: activeVendors.length,
    activeVendorsChange,
    churnedVendors: churnedVendors.length,
    decliningVendors: decliningVendors.length,
    newAccountsThisWeek,
    avgDaysToFirstSale,
  };
}

export function calculateWeeklyOnboarding(
  vendors: Vendor[],
  startDate: Date,
  endDate: Date
): WeeklyOnboarding[] {
  const weeks = getWeeksInRange(startDate, endDate);

  return weeks.map(({ week, year, startDate: weekStart, endDate: weekEnd }) => {
    const newAccounts = vendors.filter((v) => {
      const createdAt = new Date(v.createdAt);
      return createdAt >= weekStart && createdAt <= weekEnd;
    });

    const withFirstSale = newAccounts.filter((v) => v.firstSaleDate);
    const firstSales = withFirstSale.length;

    let avgDaysToFirstSale = 0;
    if (withFirstSale.length > 0) {
      const totalDays = withFirstSale.reduce((sum, v) => {
        const createdAt = new Date(v.createdAt);
        const firstSale = new Date(v.firstSaleDate!);
        return sum + daysBetween(createdAt, firstSale);
      }, 0);
      avgDaysToFirstSale = Math.round(totalDays / withFirstSale.length);
    }

    const conversionRate = newAccounts.length > 0
      ? Math.round((firstSales / newAccounts.length) * 100)
      : 0;

    return {
      week: formatWeekLabel(week, year),
      weekNumber: week,
      year,
      newAccounts: newAccounts.length,
      firstSales,
      avgDaysToFirstSale,
      conversionRate,
    };
  }).reverse(); // Neueste Woche zuerst
}

export function calculateUTMAttribution(vendors: Vendor[]): UTMAttribution[] {
  const sourceMap = new Map<string, { count: number; revenue: number }>();

  vendors.forEach((vendor) => {
    const source = normalizeUTMSource(vendor.utmSource);
    if (!sourceMap.has(source)) {
      sourceMap.set(source, { count: 0, revenue: 0 });
    }
    const current = sourceMap.get(source)!;
    current.count += 1;
    current.revenue += vendor.totalRevenue;
  });

  const totalVendors = vendors.length;
  const attributions: UTMAttribution[] = [];

  sourceMap.forEach((data, source) => {
    attributions.push({
      source,
      vendorCount: data.count,
      percentage: totalVendors > 0 ? Math.round((data.count / totalVendors) * 100) : 0,
      totalRevenue: data.revenue,
    });
  });

  // Sortiere nach Anzahl der Vendoren
  return attributions.sort((a, b) => b.vendorCount - a.vendorCount);
}

export function normalizeUTMSource(source: string | null): string {
  if (!source) return 'Unbekannt';

  const lowerSource = source.toLowerCase();

  if (lowerSource.includes('facebook') || lowerSource.includes('meta') || lowerSource.includes('instagram')) {
    return 'Meta Ads';
  }
  if (lowerSource.includes('google') || lowerSource.includes('adwords')) {
    return 'Google Ads';
  }
  if (lowerSource.includes('organic') || lowerSource === 'organic_search') {
    return 'Organic';
  }
  if (lowerSource.includes('email') || lowerSource.includes('newsletter')) {
    return 'Email';
  }
  if (lowerSource.includes('referral')) {
    return 'Referral';
  }
  if (lowerSource.includes('direct')) {
    return 'Direct';
  }
  if (lowerSource.includes('social')) {
    return 'Social';
  }

  return source;
}

export function filterVendorsByStatus(vendors: Vendor[], status: string): Vendor[] {
  return vendors.filter((v) => v.status === status);
}

export function sortVendorsByRevenue(vendors: Vendor[], ascending = false): Vendor[] {
  return [...vendors].sort((a, b) => {
    return ascending
      ? a.totalRevenue - b.totalRevenue
      : b.totalRevenue - a.totalRevenue;
  });
}
