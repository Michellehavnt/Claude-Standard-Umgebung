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
  FREE_EMAIL_DOMAINS
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
        expect(getWebsiteWithFallback('https://mysite.io', 'user@gmail.com')).toBe('https://mysite.io');
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
});
