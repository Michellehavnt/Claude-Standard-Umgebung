/**
 * Lead Quality Service Tests
 *
 * Tests for Lead Quality tab functionality including:
 * - Website extraction from email domain (excluding generic providers)
 * - Transcript check before analysis
 * - Analysis metadata persistence (model, timestamp)
 * - Deal stage updates linking to closing rate
 */

const {
  isBusinessEmail,
  getEmailDomain,
  deriveWebsiteFromEmail,
  getWebsiteWithFallback,
  FREE_EMAIL_DOMAINS,
  AFFILIATE_AGENCY_KEYWORDS,
  detectAffiliateAgency,
  scoreAffiliateReadiness,
  canAnalyzeLead,
  isGenericEmailDomain
} = require('../services/leadQualityService');

describe('Lead Quality Service', () => {
  describe('Email Domain Utilities', () => {
    describe('getEmailDomain', () => {
      it('should extract domain from valid email', () => {
        expect(getEmailDomain('user@example.com')).toBe('example.com');
        expect(getEmailDomain('john.doe@company.io')).toBe('company.io');
      });

      it('should return empty string for invalid email', () => {
        expect(getEmailDomain('')).toBe('');
        expect(getEmailDomain(null)).toBe('');
        expect(getEmailDomain(undefined)).toBe('');
        expect(getEmailDomain('invalid')).toBe('');
      });

      it('should lowercase the domain', () => {
        expect(getEmailDomain('User@EXAMPLE.COM')).toBe('example.com');
      });
    });

    describe('isBusinessEmail', () => {
      it('should return true for business emails', () => {
        expect(isBusinessEmail('john@acme.com')).toBe(true);
        expect(isBusinessEmail('ceo@startup.io')).toBe(true);
        expect(isBusinessEmail('sales@company.co')).toBe(true);
      });

      it('should return false for free email providers', () => {
        expect(isBusinessEmail('user@gmail.com')).toBe(false);
        expect(isBusinessEmail('user@yahoo.com')).toBe(false);
        expect(isBusinessEmail('user@hotmail.com')).toBe(false);
        expect(isBusinessEmail('user@outlook.com')).toBe(false);
        expect(isBusinessEmail('user@icloud.com')).toBe(false);
        expect(isBusinessEmail('user@protonmail.com')).toBe(false);
      });

      it('should return falsy value for empty/invalid input', () => {
        expect(isBusinessEmail('')).toBeFalsy();
        expect(isBusinessEmail(null)).toBeFalsy();
        expect(isBusinessEmail(undefined)).toBeFalsy();
      });
    });
  });

  describe('Website Extraction', () => {
    describe('deriveWebsiteFromEmail', () => {
      it('should derive website from business email domain', () => {
        expect(deriveWebsiteFromEmail('john@acme.com')).toBe('acme.com');
        expect(deriveWebsiteFromEmail('ceo@startup.io')).toBe('startup.io');
      });

      it('should return null for generic email providers', () => {
        expect(deriveWebsiteFromEmail('user@gmail.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@yahoo.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@hotmail.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@outlook.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@icloud.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@aol.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@mail.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@protonmail.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@zoho.com')).toBeNull();
        expect(deriveWebsiteFromEmail('user@yandex.com')).toBeNull();
      });

      it('should return null for invalid email', () => {
        expect(deriveWebsiteFromEmail('')).toBeNull();
        expect(deriveWebsiteFromEmail(null)).toBeNull();
        expect(deriveWebsiteFromEmail(undefined)).toBeNull();
      });
    });

    describe('getWebsiteWithFallback', () => {
      it('should use provided website as first choice', () => {
        expect(getWebsiteWithFallback('example.com', 'user@other.com')).toBe('example.com');
        // Protocol is stripped for consistency
        expect(getWebsiteWithFallback('https://mysite.io', 'user@gmail.com')).toBe('mysite.io');
      });

      it('should trim whitespace from provided website', () => {
        expect(getWebsiteWithFallback('  example.com  ', 'user@other.com')).toBe('example.com');
      });

      it('should fallback to email domain if no website provided', () => {
        expect(getWebsiteWithFallback(null, 'user@acme.com')).toBe('acme.com');
        expect(getWebsiteWithFallback('', 'user@startup.io')).toBe('startup.io');
        expect(getWebsiteWithFallback('  ', 'user@company.co')).toBe('company.co');
      });

      it('should return null if no website and email is generic provider', () => {
        expect(getWebsiteWithFallback(null, 'user@gmail.com')).toBeNull();
        expect(getWebsiteWithFallback('', 'user@yahoo.com')).toBeNull();
        expect(getWebsiteWithFallback('  ', 'user@hotmail.com')).toBeNull();
      });

      it('should return null if both website and email are invalid', () => {
        expect(getWebsiteWithFallback(null, null)).toBeNull();
        expect(getWebsiteWithFallback('', '')).toBeNull();
      });

      it('should reject placeholder values and fallback to email domain', () => {
        // Placeholders like "na", "n/a", "-" should be rejected
        expect(getWebsiteWithFallback('na', 'user@marrowz.com')).toBe('marrowz.com');
        expect(getWebsiteWithFallback('n/a', 'user@acme.com')).toBe('acme.com');
        expect(getWebsiteWithFallback('-', 'user@company.io')).toBe('company.io');
        expect(getWebsiteWithFallback('none', 'user@startup.co')).toBe('startup.co');
        expect(getWebsiteWithFallback('not applicable', 'user@business.com')).toBe('business.com');
        expect(getWebsiteWithFallback('tbd', 'user@enterprise.com')).toBe('enterprise.com');
      });

      it('should extract first domain from multi-URL strings', () => {
        // Handle cases like "Multiple brands: https://site1.com, https://site2.com"
        expect(getWebsiteWithFallback('Multiple brands: https://site1.com, https://site2.com', 'user@gmail.com')).toBe('site1.com');
      });

      it('should return null for placeholder with generic email', () => {
        expect(getWebsiteWithFallback('na', 'user@gmail.com')).toBeNull();
        expect(getWebsiteWithFallback('-', 'user@yahoo.com')).toBeNull();
      });
    });
  });

  describe('FREE_EMAIL_DOMAINS constant', () => {
    it('should contain all common free email providers', () => {
      const expectedDomains = [
        'gmail.com',
        'yahoo.com',
        'hotmail.com',
        'outlook.com',
        'icloud.com',
        'aol.com',
        'mail.com',
        'protonmail.com'
      ];

      expectedDomains.forEach(domain => {
        expect(FREE_EMAIL_DOMAINS).toContain(domain);
      });
    });

    it('should be lowercase for consistent comparison', () => {
      FREE_EMAIL_DOMAINS.forEach(domain => {
        expect(domain).toBe(domain.toLowerCase());
      });
    });
  });

  describe('isGenericEmailDomain', () => {
    it('should return true for generic email domains', () => {
      expect(isGenericEmailDomain('user@gmail.com')).toBe(true);
      expect(isGenericEmailDomain('user@yahoo.com')).toBe(true);
      expect(isGenericEmailDomain('user@outlook.com')).toBe(true);
    });

    it('should return false for business email domains', () => {
      expect(isGenericEmailDomain('user@company.com')).toBe(false);
      expect(isGenericEmailDomain('user@startup.io')).toBe(false);
    });
  });

  describe('canAnalyzeLead', () => {
    it('should return true if email and name are present', () => {
      const result = canAnalyzeLead({
        invitee_email: 'john@company.com',
        invitee_name: 'John Doe'
      });
      expect(result.canAnalyze).toBe(true);
    });

    it('should return false if email is missing', () => {
      const result = canAnalyzeLead({
        invitee_name: 'John Doe'
      });
      expect(result.canAnalyze).toBe(false);
      expect(result.reason).toContain('Email');
    });

    it('should return false if name is missing', () => {
      const result = canAnalyzeLead({
        invitee_email: 'john@company.com'
      });
      expect(result.canAnalyze).toBe(false);
      expect(result.reason).toContain('Name');
    });

    it('should return false if name is empty string', () => {
      const result = canAnalyzeLead({
        invitee_email: 'john@company.com',
        invitee_name: '   '
      });
      expect(result.canAnalyze).toBe(false);
    });

    it('should work with camelCase field names too', () => {
      const result = canAnalyzeLead({
        inviteeEmail: 'john@company.com',
        inviteeName: 'John Doe'
      });
      expect(result.canAnalyze).toBe(true);
    });
  });

  describe('Affiliate Agency Detection', () => {
    describe('AFFILIATE_AGENCY_KEYWORDS', () => {
      it('should contain common agency keywords', () => {
        expect(AFFILIATE_AGENCY_KEYWORDS).toContain('affiliate agency');
        expect(AFFILIATE_AGENCY_KEYWORDS).toContain('partner marketing');
        expect(AFFILIATE_AGENCY_KEYWORDS).toContain('performance marketing agency');
      });
    });

    describe('detectAffiliateAgency', () => {
      it('should detect agency from Perplexity company description', () => {
        const perplexityData = {
          company_info: {
            description: 'We are a leading affiliate marketing agency helping brands grow'
          }
        };
        const result = detectAffiliateAgency(perplexityData, {});
        expect(result.isAgency).toBe(true);
        expect(result.reason).toContain('affiliate');
      });

      it('should detect agency from company name', () => {
        const perplexityData = {
          company_info: {
            name: 'Performance Marketing Agency Inc'
          }
        };
        const result = detectAffiliateAgency(perplexityData, {});
        expect(result.isAgency).toBe(true);
      });

      it('should detect agency from form responses', () => {
        const calendlyData = {
          calendly_challenge: 'We are an affiliate agency looking to scale partner programs'
        };
        const result = detectAffiliateAgency({}, calendlyData);
        expect(result.isAgency).toBe(true);
      });

      it('should detect agency from JSON form responses', () => {
        const calendlyData = {
          calendly_form_responses: JSON.stringify([
            { question: 'What does your company do?', answer: 'We run a partner marketing agency' }
          ])
        };
        const result = detectAffiliateAgency({}, calendlyData);
        expect(result.isAgency).toBe(true);
      });

      it('should return false for non-agency companies', () => {
        const perplexityData = {
          company_info: {
            description: 'We are an e-commerce company selling organic products'
          }
        };
        const result = detectAffiliateAgency(perplexityData, {});
        expect(result.isAgency).toBe(false);
      });
    });

    describe('scoreAffiliateReadiness', () => {
      it('should give 3/3 for affiliate agencies', () => {
        const perplexityData = {
          company_info: {
            description: 'Leading affiliate marketing agency'
          }
        };
        const result = scoreAffiliateReadiness(perplexityData, {});
        expect(result.score).toBe(3);
        expect(result.rationale).toContain('affiliate agency');
      });

      it('should give 3/3 for companies with affiliate software', () => {
        const perplexityData = {
          affiliate_signals: {
            affiliate_software_detected: ['PartnerStack']
          }
        };
        const result = scoreAffiliateReadiness(perplexityData, {});
        expect(result.score).toBe(3);
        expect(result.rationale).toContain('partnerstack');
      });

      it('should give 2/3 for companies with affiliate page', () => {
        const perplexityData = {
          affiliate_signals: {
            affiliate_page_url: 'https://example.com/partners'
          }
        };
        const result = scoreAffiliateReadiness(perplexityData, {});
        expect(result.score).toBe(2);
      });

      it('should give 0/3 for companies with no signals', () => {
        const perplexityData = {
          company_info: {
            description: 'Just a regular company'
          }
        };
        const result = scoreAffiliateReadiness(perplexityData, {});
        expect(result.score).toBe(0);
      });
    });
  });
});
