import { describe, expect, it } from 'vitest';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Installment } from './installment.ts';
import { Policy, type PolicyRegistrationData } from './policy.ts';

function installment(number: number, amount = '100.00', policyId = 'policy-1'): Installment {
  return Installment.create({
    id: `installment-${number}`,
    policyId,
    number,
    amount: Money.fromString(amount),
    dueDate: CalendarDate.fromString(`2026-10-${10 + number}`),
  });
}

function validData(overrides: Partial<PolicyRegistrationData> = {}): PolicyRegistrationData {
  return {
    id: 'policy-1',
    proposalId: 'proposal-1',
    policyNumber: 'APL-4711',
    premium: Money.fromString('1200.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-09-30'),
    renewalDate: CalendarDate.fromString('2027-09-30'),
    registeredAt: new Date('2026-09-20T10:00:00.000Z'),
    installments: [installment(1)],
    ...overrides,
  };
}

describe('Policy.register', () => {
  it('registers an ACTIVE policy with its schedule (REQ-020, REQ-048)', () => {
    const policy = Policy.register(validData({ installments: [installment(1), installment(2)] }));

    expect(policy.status).toBe('ACTIVE');
    expect(policy.policyNumber).toBe('APL-4711');
    expect(policy.proposalId).toBe('proposal-1');
    expect(policy.installments).toHaveLength(2);
  });

  it('keeps a policy number that differs from the proposal number (CA-008)', () => {
    // The link to the proposal is what makes both numbers consultable: the
    // policy never copies the proposal number.
    const policy = Policy.register(validData({ policyNumber: 'APL-0001' }));

    expect(policy.policyNumber).toBe('APL-0001');
    expect(policy.proposalId).toBe('proposal-1');
  });

  it('rejects a policy without a policy number (REJ-006)', () => {
    expect(() => Policy.register(validData({ policyNumber: '   ' }))).toThrow(
      BusinessRuleViolation,
    );
  });

  it('rejects a non-positive premium', () => {
    expect(() => Policy.register(validData({ premium: Money.fromString('0.00') }))).toThrow(
      BusinessRuleViolation,
    );
  });

  it('rejects a coverage period that does not move forward (REQ-020)', () => {
    expect(() =>
      Policy.register(
        validData({
          coverageStart: CalendarDate.fromString('2027-09-30'),
          coverageEnd: CalendarDate.fromString('2026-10-01'),
        }),
      ),
    ).toThrow(BusinessRuleViolation);

    expect(() =>
      Policy.register(
        validData({
          coverageStart: CalendarDate.fromString('2026-10-01'),
          coverageEnd: CalendarDate.fromString('2026-10-01'),
        }),
      ),
    ).toThrow(BusinessRuleViolation);
  });

  it('rejects a policy with no installment (REQ-021)', () => {
    try {
      Policy.register(validData({ installments: [] }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-021');
    }
  });

  it('rejects a schedule that is not numbered from 1 in sequence (REQ-091)', () => {
    expect(() =>
      Policy.register(validData({ installments: [installment(2), installment(3)] })),
    ).toThrow(BusinessRuleViolation);

    expect(() =>
      Policy.register(validData({ installments: [installment(2), installment(1)] })),
    ).toThrow(BusinessRuleViolation);
  });

  it('rejects an installment that belongs to another policy', () => {
    expect(() =>
      Policy.register(validData({ installments: [installment(1, '100.00', 'policy-other')] })),
    ).toThrow(BusinessRuleViolation);
  });

  it('does not require the schedule to add up to the premium', () => {
    // No requirement states that relation, and inventing it would reject a
    // legitimate instalment plan whose charges exceed the cash premium.
    const policy = Policy.register(
      validData({
        premium: Money.fromString('1200.00'),
        installments: [installment(1, '700.00'), installment(2, '700.00')],
      }),
    );

    expect(policy.installments).toHaveLength(2);
  });

  it('restores a persisted policy in the state it was stored in (REQ-124)', () => {
    const policy = Policy.restore(validData(), 'CANCELLED');

    expect(policy.status).toBe('CANCELLED');
  });
});

describe('Policy.payInstallment', () => {
  const confirmation = { userId: 'financeiro-1', at: new Date('2026-10-11T12:00:00.000Z') };

  function scheduled(): Policy {
    return Policy.register(validData({ installments: [installment(1), installment(2)] }));
  }

  it('confirms one installment of the schedule (IN-13)', () => {
    const policy = scheduled().payInstallment(1, confirmation);

    expect(policy.installments[0]?.status).toBe('PAID');
    expect(policy.isFirstInstallmentPaid).toBe(true);
  });

  it('carries the user and the moment of the confirmation (REQ-123)', () => {
    const policy = scheduled().payInstallment(1, confirmation);

    expect(policy.installments[0]?.confirmation?.userId).toBe('financeiro-1');
    expect(policy.installments[0]?.confirmation?.at).toBe(confirmation.at);
  });

  it('leaves the other installments untouched', () => {
    const policy = scheduled().payInstallment(1, confirmation);

    expect(policy.installments[1]?.status).toBe('PENDING');
  });

  it('answers REQ-091 about the first installment specifically', () => {
    const policy = scheduled();

    expect(policy.isFirstInstallmentPaid).toBe(false);
    // A later installment paid does not release the transfer of REQ-091.
    expect(policy.payInstallment(2, confirmation).isFirstInstallmentPaid).toBe(false);
  });

  it('reports an installment that is not in the schedule', () => {
    expect(() => scheduled().payInstallment(99, confirmation)).toThrow(RecordNotFound);
  });
});
