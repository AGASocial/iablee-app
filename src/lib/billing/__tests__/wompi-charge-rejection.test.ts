/**
 * @jest-environment node
 */
import {
  classifyWompiChargeHttpFailure,
  isDefinitiveWompiChargeRejection,
  PaymentGatewayError,
} from '../types';

describe('isDefinitiveWompiChargeRejection classifier', () => {
  it('treats known validation 4xx as definitive (no tx created)', () => {
    expect(
      classifyWompiChargeHttpFailure(400, 'Invalid amount_in_cents')
    ).toBe('definitive');
    expect(
      classifyWompiChargeHttpFailure(400, 'payment_source not available')
    ).toBe('definitive');
    expect(
      isDefinitiveWompiChargeRejection(
        new PaymentGatewayError(
          'Wompi source transaction failed (400)',
          'wompi',
          'WOMPI_SOURCE_CHARGE_FAILED',
          400,
          'Invalid installments'
        )
      )
    ).toBe(true);
  });

  it('treats 422 duplicate reference as inconclusive', () => {
    expect(
      classifyWompiChargeHttpFailure(
        422,
        'La referencia ya ha sido usada'
      )
    ).toBe('inconclusive');
    expect(classifyWompiChargeHttpFailure(422, 'anything else')).toBe(
      'inconclusive'
    );
  });

  it('treats 409 as inconclusive', () => {
    expect(classifyWompiChargeHttpFailure(409, 'Conflict')).toBe(
      'inconclusive'
    );
  });

  it('treats unrecognized 4xx as inconclusive (safe default)', () => {
    expect(
      classifyWompiChargeHttpFailure(400, 'Mysterious provider error')
    ).toBe('inconclusive');
    expect(classifyWompiChargeHttpFailure(403, 'Forbidden')).toBe(
      'inconclusive'
    );
  });

  it('treats 5xx / missing status as inconclusive', () => {
    expect(classifyWompiChargeHttpFailure(503, 'Unavailable')).toBe(
      'inconclusive'
    );
    expect(
      isDefinitiveWompiChargeRejection(
        new PaymentGatewayError('network', 'wompi', 'X')
      )
    ).toBe(false);
    expect(isDefinitiveWompiChargeRejection(new Error('boom'))).toBe(false);
  });
});
