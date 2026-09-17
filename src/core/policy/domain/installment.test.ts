import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { CalendarDate } from './calendar-date.ts';
import { Installment, type InstallmentData } from './installment.ts';

function validData(overrides: Partial<InstallmentData> = {}): InstallmentData {
  return {
    id: 'installment-1',
    policyId: 'policy-1',
    number: 1,
    amount: Money.fromString('100.00'),
    dueDate: CalendarDate.fromString('2026-10-10'),
    ...overrides,
  };
}

describe('Installment.create', () => {
  it('starts PENDING and keeps what a later apportionment needs (REQ-021)', () => {
    const installment = Installment.create(validData());

    expect(installment.status).toBe('PENDING');
    expect(installment.policyId).toBe('policy-1');
    expect(installment.number).toBe(1);
    expect(installment.amount.toString()).toBe('100.00');
    expect(installment.dueDate.toString()).toBe('2026-10-10');
  });

  it('rejects a non-positive amount', () => {
    expect(() => Installment.create(validData({ amount: Money.fromString('0.00') }))).toThrow(
      BusinessRuleViolation,
    );
    expect(() => Installment.create(validData({ amount: Money.fromString('-1.00') }))).toThrow(
      BusinessRuleViolation,
    );
  });

  it('rejects a position below one: REQ-091 needs a first installment', () => {
    expect(() => Installment.create(validData({ number: 0 }))).toThrow(BusinessRuleViolation);
    expect(() => Installment.create(validData({ number: 1.5 }))).toThrow(BusinessRuleViolation);
  });

  it('restores a persisted installment in the state it was stored in (REQ-124)', () => {
    const installment = Installment.restore(validData(), 'PAID');

    expect(installment.status).toBe('PAID');
  });
});
