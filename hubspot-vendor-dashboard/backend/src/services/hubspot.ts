import { Client } from '@hubspot/api-client';
import { HubSpotContact, HubSpotDeal } from '../types/vendor';

export class HubSpotService {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client({ accessToken: apiKey });
  }

  /**
   * Holt alle Contacts (Vendoren) mit ihren Eigenschaften
   */
  async getContacts(limit: number = 100, after?: string): Promise<{ contacts: HubSpotContact[]; paging?: { next?: { after: string } } }> {
    const properties = [
      'email',
      'firstname',
      'lastname',
      'createdate',
      'hs_analytics_source',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'hs_analytics_first_url',
      'role',
      'language',
    ];

    const response = await this.client.crm.contacts.basicApi.getPage(
      limit,
      after,
      properties
    );

    return {
      contacts: response.results as unknown as HubSpotContact[],
      paging: response.paging as { next?: { after: string } } | undefined,
    };
  }

  /**
   * Holt alle Contacts mit Pagination
   */
  async getAllContacts(): Promise<HubSpotContact[]> {
    const allContacts: HubSpotContact[] = [];
    let after: string | undefined;

    do {
      const response = await this.getContacts(100, after);
      allContacts.push(...response.contacts);
      after = response.paging?.next?.after;
    } while (after);

    return allContacts;
  }

  /**
   * Holt alle Deals mit Associations
   */
  async getDeals(limit: number = 100, after?: string): Promise<{ deals: HubSpotDeal[]; paging?: { next?: { after: string } } }> {
    const properties = [
      'dealname',
      'amount',
      'closedate',
      'dealstage',
      'hs_object_id',
    ];

    const response = await this.client.crm.deals.basicApi.getPage(
      limit,
      after,
      properties,
      undefined,
      ['contacts', 'companies']
    );

    return {
      deals: response.results as unknown as HubSpotDeal[],
      paging: response.paging as { next?: { after: string } } | undefined,
    };
  }

  /**
   * Holt alle Deals mit Pagination
   */
  async getAllDeals(): Promise<HubSpotDeal[]> {
    const allDeals: HubSpotDeal[] = [];
    let after: string | undefined;

    do {
      const response = await this.getDeals(100, after);
      allDeals.push(...response.deals);
      after = response.paging?.next?.after;
    } while (after);

    return allDeals;
  }

  /**
   * Holt Deals für einen bestimmten Zeitraum
   */
  async getDealsInDateRange(startDate: Date, endDate: Date): Promise<HubSpotDeal[]> {
    const filterGroups = [
      {
        filters: [
          {
            propertyName: 'closedate',
            operator: 'GTE' as const,
            value: startDate.getTime().toString(),
          },
          {
            propertyName: 'closedate',
            operator: 'LTE' as const,
            value: endDate.getTime().toString(),
          },
        ],
      },
    ];

    const properties = [
      'dealname',
      'amount',
      'closedate',
      'dealstage',
      'hs_object_id',
    ];

    const response = await this.client.crm.deals.searchApi.doSearch({
      filterGroups,
      properties,
      limit: 100,
      after: '0',
      sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
    });

    return response.results as unknown as HubSpotDeal[];
  }

  /**
   * Holt Contacts die in einem bestimmten Zeitraum erstellt wurden
   */
  async getContactsCreatedInDateRange(startDate: Date, endDate: Date): Promise<HubSpotContact[]> {
    const filterGroups = [
      {
        filters: [
          {
            propertyName: 'createdate',
            operator: 'GTE' as const,
            value: startDate.getTime().toString(),
          },
          {
            propertyName: 'createdate',
            operator: 'LTE' as const,
            value: endDate.getTime().toString(),
          },
        ],
      },
    ];

    const properties = [
      'email',
      'firstname',
      'lastname',
      'createdate',
      'hs_analytics_source',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'role',
      'language',
    ];

    const response = await this.client.crm.contacts.searchApi.doSearch({
      filterGroups,
      properties,
      limit: 100,
      after: '0',
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    });

    return response.results as unknown as HubSpotContact[];
  }

  /**
   * Holt die Deal-Associations für einen Contact
   */
  async getDealsForContact(contactId: string): Promise<HubSpotDeal[]> {
    try {
      const associations = await this.client.crm.contacts.associationsApi.getAll(
        contactId,
        'deals'
      );

      if (!associations.results || associations.results.length === 0) {
        return [];
      }

      const dealIds = associations.results.map((a) => a.id);
      const deals: HubSpotDeal[] = [];

      for (const dealId of dealIds) {
        const deal = await this.client.crm.deals.basicApi.getById(dealId, [
          'dealname',
          'amount',
          'closedate',
          'dealstage',
        ]);
        deals.push(deal as unknown as HubSpotDeal);
      }

      return deals;
    } catch {
      return [];
    }
  }
}

export default HubSpotService;
