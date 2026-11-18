/**
 * Billing Module
 * Provider-agnostic subscription and payment management
 */

// Export types
export * from './types';

// Export interfaces
export * from './gateway.interface';
export * from './webhook-normalizer.interface';

// Export services
export * from './billing.service';
export * from './dunning';
export {
  buildWompiFirstReference,
  buildWompiLegacyReference,
  buildWompiRenewalReference,
  parseWompiReference as parseWompiReferenceDetailed,
  isWompiFirstChargeReference,
  isWompiRenewalReference,
  toPeriodEndYmd,
} from './wompi-references';
export * from './billing-emails';
export * from './charge-leases';
export * from './refund-alerts';
export * from './renewals';
export * from './wompi-subscribe';

// Export adapters
export * from './adapters';
