import { Router, Request, Response } from 'express';
import { HubSpotService } from '../services/hubspot';
import { getDateRange, getPreviousPeriodRange } from '../utils/dateFilters';
import {
  buildVendorData,
  calculateSummary,
  calculateWeeklyOnboarding,
  calculateUTMAttribution,
  sortVendorsByRevenue,
  filterVendorsByStatus,
  filterVendorsByRoleAndLanguage,
  getAvailableRoles,
  getAvailableLanguages,
} from '../utils/analytics';
import { DateFilter, DashboardData, VendorFilter } from '../types/vendor';

const router = Router();

// Singleton für HubSpot Service
let hubspotService: HubSpotService | null = null;

function getHubSpotService(): HubSpotService {
  if (!hubspotService) {
    const apiKey = process.env.HUBSPOT_API_KEY;
    if (!apiKey) {
      throw new Error('HUBSPOT_API_KEY is not configured');
    }
    hubspotService = new HubSpotService(apiKey);
  }
  return hubspotService;
}

/**
 * GET /api/vendors/dashboard
 * Holt alle Dashboard-Daten basierend auf dem Zeitfilter
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const filterType = (req.query.filter as string) || 'this_month';
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;
    const roleFilter = req.query.role as string;
    const languageFilter = req.query.language as string;

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
      startDate: startDateParam,
      endDate: endDateParam,
    };

    const vendorFilter: VendorFilter = {
      role: roleFilter || undefined,
      language: languageFilter || undefined,
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    // Hole Daten parallel
    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    // Berechne Vendor-Daten
    let vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);

    // Hole verfügbare Optionen BEVOR der Filter angewendet wird
    const availableRoles = getAvailableRoles(vendors);
    const availableLanguages = getAvailableLanguages(vendors);

    // Wende Role/Language Filter an
    vendors = filterVendorsByRoleAndLanguage(vendors, vendorFilter);

    // Berechne Statistiken
    const summary = calculateSummary(vendors, startDate, endDate);
    const weeklyOnboarding = calculateWeeklyOnboarding(vendors, startDate, endDate);
    const utmAttribution = calculateUTMAttribution(vendors);

    // Filtere und sortiere Vendoren nach Status
    const activeVendors = sortVendorsByRevenue(filterVendorsByStatus(vendors, 'active'));
    const newVendors = sortVendorsByRevenue(filterVendorsByStatus(vendors, 'new'));
    const churnedVendors = filterVendorsByStatus(vendors, 'churned');
    const decliningVendors = sortVendorsByRevenue(filterVendorsByStatus(vendors, 'declining'));

    const dashboardData: DashboardData = {
      summary,
      activeVendors: [...activeVendors, ...newVendors],
      churnedVendors,
      decliningVendors,
      weeklyOnboarding,
      utmAttribution,
      filter,
      vendorFilter,
      availableRoles,
      availableLanguages,
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/vendors/active
 * Holt alle aktiven Vendoren mit Umsatz
 */
router.get('/active', async (req: Request, res: Response) => {
  try {
    const filterType = (req.query.filter as string) || 'this_month';
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;
    const sortBy = (req.query.sortBy as string) || 'revenue';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
      startDate: startDateParam,
      endDate: endDateParam,
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    const vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);
    let activeVendors = filterVendorsByStatus(vendors, 'active');
    const newVendors = filterVendorsByStatus(vendors, 'new');
    activeVendors = [...activeVendors, ...newVendors];

    // Sortierung
    if (sortBy === 'revenue') {
      activeVendors = sortVendorsByRevenue(activeVendors, sortOrder === 'asc');
    } else if (sortBy === 'change') {
      activeVendors.sort((a, b) => {
        return sortOrder === 'asc'
          ? a.revenueChange - b.revenueChange
          : b.revenueChange - a.revenueChange;
      });
    }

    res.json({
      vendors: activeVendors,
      total: activeVendors.length,
      filter,
    });
  } catch (error) {
    console.error('Error fetching active vendors:', error);
    res.status(500).json({
      error: 'Failed to fetch active vendors',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/vendors/churned
 * Holt alle gechurnten Vendoren
 */
router.get('/churned', async (req: Request, res: Response) => {
  try {
    const filterType = (req.query.filter as string) || 'this_month';
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
      startDate: startDateParam,
      endDate: endDateParam,
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    const vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);
    const churnedVendors = filterVendorsByStatus(vendors, 'churned');

    res.json({
      vendors: churnedVendors,
      total: churnedVendors.length,
      filter,
    });
  } catch (error) {
    console.error('Error fetching churned vendors:', error);
    res.status(500).json({
      error: 'Failed to fetch churned vendors',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/vendors/declining
 * Holt alle Vendoren mit Umsatzeinbruch
 */
router.get('/declining', async (req: Request, res: Response) => {
  try {
    const filterType = (req.query.filter as string) || 'this_month';
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
      startDate: startDateParam,
      endDate: endDateParam,
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    const vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);
    const decliningVendors = sortVendorsByRevenue(filterVendorsByStatus(vendors, 'declining'));

    res.json({
      vendors: decliningVendors,
      total: decliningVendors.length,
      filter,
    });
  } catch (error) {
    console.error('Error fetching declining vendors:', error);
    res.status(500).json({
      error: 'Failed to fetch declining vendors',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/vendors/onboarding
 * Holt wöchentliche Onboarding-Statistiken
 */
router.get('/onboarding', async (req: Request, res: Response) => {
  try {
    const filterType = (req.query.filter as string) || '3_months';
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
      startDate: startDateParam,
      endDate: endDateParam,
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    const vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);
    const weeklyOnboarding = calculateWeeklyOnboarding(vendors, startDate, endDate);

    res.json({
      onboarding: weeklyOnboarding,
      filter,
    });
  } catch (error) {
    console.error('Error fetching onboarding data:', error);
    res.status(500).json({
      error: 'Failed to fetch onboarding data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/vendors/utm
 * Holt UTM Attribution Statistiken
 */
router.get('/utm', async (req: Request, res: Response) => {
  try {
    const filterType = (req.query.filter as string) || 'this_month';
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
      startDate: startDateParam,
      endDate: endDateParam,
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    const vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);
    const utmAttribution = calculateUTMAttribution(vendors);

    res.json({
      attribution: utmAttribution,
      filter,
    });
  } catch (error) {
    console.error('Error fetching UTM data:', error);
    res.status(500).json({
      error: 'Failed to fetch UTM data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/vendors/:id
 * Holt Details zu einem spezifischen Vendor
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const filterType = (req.query.filter as string) || 'this_month';

    const filter: DateFilter = {
      type: filterType as DateFilter['type'],
    };

    const { startDate, endDate } = getDateRange(filter);
    const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousPeriodRange(filter);

    const service = getHubSpotService();

    const [contacts, deals, previousDeals] = await Promise.all([
      service.getAllContacts(),
      service.getDealsInDateRange(startDate, endDate),
      service.getDealsInDateRange(prevStartDate, prevEndDate),
    ]);

    const vendors = buildVendorData(contacts, deals, previousDeals, startDate, endDate);
    const vendor = vendors.find((v) => v.id === id);

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    res.json({ vendor, filter });
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({
      error: 'Failed to fetch vendor',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
