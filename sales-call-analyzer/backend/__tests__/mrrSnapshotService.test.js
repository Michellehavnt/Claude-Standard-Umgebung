/**
 * MRR Snapshot Service Tests
 *
 * Tests for MRR tracking functionality including:
 * - Exchange rate fetching
 * - MRR computation from Stripe subscriptions
 * - Snapshot storage and retrieval
 * - Growth calculations
 */

const mrrService = require('../services/mrrSnapshotService');

// Mock stripeClient
jest.mock('../services/stripeClient', () => ({
  isConfigured: jest.fn(),
  stripeRequest: jest.fn()
}));

// Mock dbAdapter
jest.mock('../services/dbAdapter', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn()
}));

// Mock fetch for exchange rate API
global.fetch = jest.fn();

const stripeClient = require('../services/stripeClient');
const dbAdapter = require('../services/dbAdapter');

describe('MRR Snapshot Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getExchangeRate', () => {
    it('should fetch exchange rate from API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rates: { USD: 1.27 }
        })
      });

      const result = await mrrService.getExchangeRate();

      expect(result.rate).toBe(1.27);
      expect(result.timestamp).toBeDefined();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('exchangerate-api.com')
      );
    });

    it('should return fallback rate on API failure', async () => {
      global.fetch.mockRejectedValueOnce(new Error('API Error'));

      const result = await mrrService.getExchangeRate();

      expect(result.rate).toBe(1.27);
      expect(result.fallback).toBe(true);
    });

    it('should return fallback rate on non-ok response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const result = await mrrService.getExchangeRate();

      expect(result.rate).toBe(1.27);
      expect(result.fallback).toBe(true);
    });
  });

  describe('fetchCurrentMrrFromStripe', () => {
    it('should throw if Stripe is not configured', async () => {
      stripeClient.isConfigured.mockReturnValue(false);

      await expect(mrrService.fetchCurrentMrrFromStripe())
        .rejects.toThrow('Stripe is not configured');
    });

    it('should compute MRR from active subscriptions', async () => {
      stripeClient.isConfigured.mockReturnValue(true);
      stripeClient.stripeRequest.mockResolvedValueOnce({
        data: [
          {
            id: 'sub_1',
            items: {
              data: [{
                price: {
                  unit_amount: 4900, // $49/month
                  recurring: { interval: 'month', interval_count: 1 }
                },
                quantity: 1
              }]
            }
          },
          {
            id: 'sub_2',
            items: {
              data: [{
                price: {
                  unit_amount: 9900, // $99/month
                  recurring: { interval: 'month', interval_count: 1 }
                },
                quantity: 2
              }]
            }
          }
        ],
        has_more: false
      });

      const result = await mrrService.fetchCurrentMrrFromStripe();

      expect(result.mrrCents).toBe(4900 + 9900 * 2); // 49 + 198 = 247
      expect(result.activeCount).toBe(2);
      expect(result.currency).toBe('GBP');
    });

    it('should normalize yearly subscriptions to monthly', async () => {
      stripeClient.isConfigured.mockReturnValue(true);
      stripeClient.stripeRequest.mockResolvedValueOnce({
        data: [
          {
            id: 'sub_yearly',
            items: {
              data: [{
                price: {
                  unit_amount: 120000, // $1200/year
                  recurring: { interval: 'year', interval_count: 1 }
                },
                quantity: 1
              }]
            }
          }
        ],
        has_more: false
      });

      const result = await mrrService.fetchCurrentMrrFromStripe();

      // $1200/year = $100/month = 10000 cents
      expect(result.mrrCents).toBe(10000);
    });

    it('should paginate through all subscriptions', async () => {
      stripeClient.isConfigured.mockReturnValue(true);

      // First page
      stripeClient.stripeRequest.mockResolvedValueOnce({
        data: [
          {
            id: 'sub_1',
            items: {
              data: [{
                price: { unit_amount: 5000, recurring: { interval: 'month' } },
                quantity: 1
              }]
            }
          }
        ],
        has_more: true
      });

      // Second page
      stripeClient.stripeRequest.mockResolvedValueOnce({
        data: [
          {
            id: 'sub_2',
            items: {
              data: [{
                price: { unit_amount: 5000, recurring: { interval: 'month' } },
                quantity: 1
              }]
            }
          }
        ],
        has_more: false
      });

      const result = await mrrService.fetchCurrentMrrFromStripe();

      expect(result.mrrCents).toBe(10000);
      expect(result.activeCount).toBe(2);
      expect(stripeClient.stripeRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('captureSnapshot', () => {
    beforeEach(() => {
      stripeClient.isConfigured.mockReturnValue(true);

      // Mock Stripe response
      stripeClient.stripeRequest.mockResolvedValue({
        data: [
          {
            id: 'sub_1',
            items: {
              data: [{
                price: { unit_amount: 10000, recurring: { interval: 'month' } },
                quantity: 1
              }]
            }
          }
        ],
        has_more: false
      });

      // Mock exchange rate
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { USD: 1.25 } })
      });
    });

    it('should create new snapshot when none exists for today', async () => {
      dbAdapter.queryOne.mockResolvedValueOnce(null); // No existing snapshot
      dbAdapter.execute.mockResolvedValueOnce();

      const result = await mrrService.captureSnapshot();

      expect(result.total_mrr_cents).toBe(10000);
      expect(result.exchange_rate).toBe(1.25);
      expect(result.total_mrr_usd_cents).toBe(12500);
      expect(result.created).toBe(true);
      expect(dbAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO mrr_snapshots'),
        expect.any(Array)
      );
    });

    it('should update existing snapshot for today', async () => {
      dbAdapter.queryOne.mockResolvedValueOnce({
        snapshot_date: new Date().toISOString().split('T')[0],
        total_mrr_cents: 5000
      });
      dbAdapter.execute.mockResolvedValueOnce();

      const result = await mrrService.captureSnapshot();

      expect(result.updated).toBe(true);
      expect(dbAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE mrr_snapshots'),
        expect.any(Array)
      );
    });
  });

  describe('getSnapshots', () => {
    it('should retrieve snapshots for given number of weeks', async () => {
      const mockSnapshots = [
        { snapshot_date: '2026-01-21', total_mrr_cents: 10000 },
        { snapshot_date: '2026-01-28', total_mrr_cents: 11000 }
      ];
      dbAdapter.query.mockResolvedValueOnce(mockSnapshots);

      const result = await mrrService.getSnapshots(4);

      expect(result).toEqual(mockSnapshots);
      expect(dbAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM mrr_snapshots'),
        expect.any(Array)
      );
    });

    it('should return empty array when no snapshots exist', async () => {
      dbAdapter.query.mockResolvedValueOnce(null);

      const result = await mrrService.getSnapshots(4);

      expect(result).toEqual([]);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return the most recent snapshot', async () => {
      const mockSnapshot = {
        snapshot_date: '2026-01-28',
        total_mrr_cents: 15000,
        total_mrr_usd_cents: 19050
      };
      dbAdapter.queryOne.mockResolvedValueOnce(mockSnapshot);

      const result = await mrrService.getLatestSnapshot();

      expect(result).toEqual(mockSnapshot);
      expect(dbAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY snapshot_date DESC LIMIT 1')
      );
    });
  });

  describe('getCurrentMrrWithGrowth', () => {
    beforeEach(() => {
      stripeClient.isConfigured.mockReturnValue(true);
      stripeClient.stripeRequest.mockResolvedValue({
        data: [
          {
            id: 'sub_1',
            items: {
              data: [{
                price: { unit_amount: 10000, recurring: { interval: 'month' } },
                quantity: 1
              }]
            }
          }
        ],
        has_more: false
      });
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { USD: 1.25 } })
      });
    });

    it('should return current MRR with growth calculations', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Latest snapshot (today)
      dbAdapter.queryOne
        .mockResolvedValueOnce({
          snapshot_date: today,
          total_mrr_cents: 10000,
          total_mrr_usd_cents: 12500,
          exchange_rate: 1.25,
          active_subscriptions: 1,
          created_at: new Date().toISOString()
        })
        // Snapshot from 1 week ago
        .mockResolvedValueOnce({
          snapshot_date: '2026-01-21',
          total_mrr_usd_cents: 10000
        })
        // Snapshot from 4 weeks ago
        .mockResolvedValueOnce({
          snapshot_date: '2026-01-01',
          total_mrr_usd_cents: 8000
        });

      const result = await mrrService.getCurrentMrrWithGrowth();

      expect(result.current.mrrUsdCents).toBe(12500);
      expect(result.current.mrrUsd).toBe(125);
      expect(result.growth.vsLastWeek.deltaCents).toBe(2500);
      expect(result.growth.vsLastWeek.percent).toBe(25);
      expect(result.growth.vs4WeeksAgo.deltaCents).toBe(4500);
    });

    it('should handle missing historical data gracefully', async () => {
      const today = new Date().toISOString().split('T')[0];

      dbAdapter.queryOne
        .mockResolvedValueOnce({
          snapshot_date: today,
          total_mrr_cents: 10000,
          total_mrr_usd_cents: 12500,
          exchange_rate: 1.25,
          active_subscriptions: 1,
          created_at: new Date().toISOString()
        })
        .mockResolvedValueOnce(null) // No week-ago snapshot
        .mockResolvedValueOnce(null); // No month-ago snapshot

      const result = await mrrService.getCurrentMrrWithGrowth();

      expect(result.current.mrrUsdCents).toBe(12500);
      expect(result.growth.vsLastWeek.deltaCents).toBeNull();
      expect(result.growth.vs4WeeksAgo.deltaCents).toBeNull();
    });
  });

  describe('getChartData', () => {
    it('should return chart-ready data for 4 weeks', async () => {
      const snapshots = [
        { snapshot_date: '2026-01-07', total_mrr_usd_cents: 10000, total_mrr_cents: 8000, active_subscriptions: 10 },
        { snapshot_date: '2026-01-14', total_mrr_usd_cents: 11000, total_mrr_cents: 8800, active_subscriptions: 11 },
        { snapshot_date: '2026-01-21', total_mrr_usd_cents: 12000, total_mrr_cents: 9600, active_subscriptions: 12 },
        { snapshot_date: '2026-01-28', total_mrr_usd_cents: 13000, total_mrr_cents: 10400, active_subscriptions: 13 }
      ];
      dbAdapter.query.mockResolvedValueOnce(snapshots);

      const result = await mrrService.getChartData(4);

      expect(result.labels).toHaveLength(4);
      expect(result.mrrUsd).toHaveLength(4);
      expect(result.mrrGbp).toHaveLength(4);
      expect(result.subscriptions).toHaveLength(4);
    });
  });

  describe('isConfigured', () => {
    it('should return true when Stripe is configured', () => {
      stripeClient.isConfigured.mockReturnValue(true);
      expect(mrrService.isConfigured()).toBe(true);
    });

    it('should return false when Stripe is not configured', () => {
      stripeClient.isConfigured.mockReturnValue(false);
      expect(mrrService.isConfigured()).toBe(false);
    });
  });
});
