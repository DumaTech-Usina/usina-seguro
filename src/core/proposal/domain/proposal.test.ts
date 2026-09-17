import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from './errors.ts';
import { Money } from './money.ts';
import { Percentage } from './percentage.ts';
import { Proposal, type ProposalRegistrationData } from './proposal.ts';

const TRANSMITTED_AT = new Date('2026-09-18T09:00:00.000Z');

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

function transmitted(): Proposal {
  return Proposal.register(validData()).transmit({
    proposalNumber: 'PRP-9001',
    workedCommission: Percentage.fromString('40'),
    transmittedAt: TRANSMITTED_AT,
  });
}

describe('Proposal.register', () => {
  it('registers the proposal as DRAFT when the required data is present (REQ-040)', () => {
    const proposal = Proposal.register(validData());

    expect(proposal.status).toBe('DRAFT');
    expect(proposal.netPremium.toString()).toBe('1000.00');
  });

  it('leaves the insurer-issued data empty until transmission (REQ-041)', () => {
    const proposal = Proposal.register(validData());

    expect(proposal.proposalNumber).toBeNull();
    expect(proposal.workedCommission).toBeNull();
    expect(proposal.transmittedAt).toBeNull();
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
    const proposal = Proposal.restore(validData({ customerAccepted: false }), {
      status: 'TRANSMITTED',
    });

    expect(proposal.status).toBe('TRANSMITTED');
  });

  it('restores everything the proposal accumulated after registration', () => {
    const proposal = Proposal.restore(validData(), {
      status: 'REJECTED',
      proposalNumber: 'PRP-9001',
      workedCommission: Percentage.fromString('40'),
      transmittedAt: TRANSMITTED_AT,
      rejectionReason: 'perfil de risco',
    });

    expect(proposal.proposalNumber).toBe('PRP-9001');
    expect(proposal.workedCommission?.toString()).toBe('40');
    expect(proposal.transmittedAt).toEqual(TRANSMITTED_AT);
    expect(proposal.rejectionReason).toBe('perfil de risco');
  });
});

describe('Proposal.transmit', () => {
  it('records the moment, the insurer number and the worked commission (REQ-041)', () => {
    const proposal = transmitted();

    expect(proposal.status).toBe('TRANSMITTED');
    expect(proposal.proposalNumber).toBe('PRP-9001');
    expect(proposal.workedCommission?.toString()).toBe('40');
    expect(proposal.transmittedAt).toEqual(TRANSMITTED_AT);
  });

  it('leaves the original instance untouched', () => {
    const draft = Proposal.register(validData());

    draft.transmit({
      proposalNumber: 'PRP-9001',
      workedCommission: Percentage.fromString('40'),
      transmittedAt: TRANSMITTED_AT,
    });

    expect(draft.status).toBe('DRAFT');
  });

  it('rejects a proposal transmitted without the insurer number (REQ-022)', () => {
    expect(() =>
      Proposal.register(validData()).transmit({
        proposalNumber: '   ',
        workedCommission: Percentage.fromString('40'),
        transmittedAt: TRANSMITTED_AT,
      }),
    ).toThrow(BusinessRuleViolation);
  });

  it('rejects transmitting twice: the first commission informed cannot be overwritten', () => {
    expect(() =>
      transmitted().transmit({
        proposalNumber: 'PRP-9002',
        workedCommission: Percentage.fromString('50'),
        transmittedAt: TRANSMITTED_AT,
      }),
    ).toThrow(BusinessRuleViolation);
  });
});

describe('Proposal.reject', () => {
  it('records the refusal and keeps the reason (REQ-045)', () => {
    const proposal = transmitted().reject('perfil de risco recusado');

    expect(proposal.status).toBe('REJECTED');
    expect(proposal.rejectionReason).toBe('perfil de risco recusado');
  });

  it('keeps the transmission data so the record stays consultable (REQ-046, OUT-02)', () => {
    const proposal = transmitted().reject('perfil de risco recusado');

    expect(proposal.proposalNumber).toBe('PRP-9001');
    expect(proposal.transmittedAt).toEqual(TRANSMITTED_AT);
  });

  it('rejects a refusal without a reason (CA-004, REJ-003)', () => {
    try {
      transmitted().reject('   ');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-045');
    }
  });

  it('does not allow refusing a proposal that was never transmitted', () => {
    expect(() => Proposal.register(validData()).reject('motivo')).toThrow(BusinessRuleViolation);
  });

  it('does not reopen a refused proposal (REQ-112, REJ-015)', () => {
    const rejected = transmitted().reject('motivo');

    expect(() => rejected.reject('outro motivo')).toThrow(BusinessRuleViolation);
  });
});

describe('Proposal.accept', () => {
  it('moves a transmitted proposal to ACCEPTED (REQ-048, REQ-111)', () => {
    expect(transmitted().accept().status).toBe('ACCEPTED');
  });

  it('does not allow a refused proposal to originate a policy (CA-006, REQ-047)', () => {
    const rejected = transmitted().reject('motivo');

    try {
      rejected.accept();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-047');
    }
  });

  it('does not allow a second policy for the same proposal (CA-007, REJ-005)', () => {
    const accepted = transmitted().accept();

    try {
      accepted.accept();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-049');
    }
  });

  it('does not allow accepting a proposal that was never transmitted (REQ-111)', () => {
    try {
      Proposal.register(validData()).accept();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-111');
      expect((error as BusinessRuleViolation).params).toEqual({ status: 'DRAFT' });
    }
  });
});
