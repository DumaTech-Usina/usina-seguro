import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from './errors.ts';
import { Money } from './money.ts';
import { Proposal, type ProposalRegistrationData } from './proposal.ts';

function validData(overrides: Partial<ProposalRegistrationData> = {}): ProposalRegistrationData {
  return {
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: Money.fromString('1000.00'),
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    ...overrides,
  };
}

describe('Proposal.register', () => {
  it('registers the proposal as DRAFT when the required data is present (REQ-040)', () => {
    const proposal = Proposal.register(validData());

    expect(proposal.status).toBe('DRAFT');
    expect(proposal.netPremium.toString()).toBe('1000.00');
  });

  it('rejects registration without the customer acceptance (CA-001, REJ-004)', () => {
    expect(() => Proposal.register(validData({ customerAccepted: false }))).toThrow(
      BusinessRuleViolation,
    );
  });

  it('rejects registration without a payment method (CA-001, REJ-004)', () => {
    expect(() => Proposal.register(validData({ paymentMethodId: '  ' }))).toThrow(
      BusinessRuleViolation,
    );
  });

  it('identifies the violated rule so the interface can report it', () => {
    try {
      Proposal.register(validData({ customerAccepted: false }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).rule).toBe('REQ-040');
      expect((error as BusinessRuleViolation).messageKey).toBe(
        'proposal.customer_acceptance_required',
      );
    }
  });

  it('carries the offending field as a parameter, not baked into the text', () => {
    try {
      Proposal.register(validData({ clientId: '' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).params).toEqual({ field: 'clientId' });
    }
  });

  it('restores a persisted record without re-applying the creation rules (REQ-124)', () => {
    const proposal = Proposal.restore(validData({ customerAccepted: false }), 'TRANSMITTED');

    expect(proposal.status).toBe('TRANSMITTED');
  });
});
