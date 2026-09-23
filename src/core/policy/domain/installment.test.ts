import { describe, expect, it } from 'vitest';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
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
    expect(installment.dueDate?.toString()).toBe('2026-10-10');
  });

  it('keeps no due date when the proposal informed none (REQ-204, REQ-241, CA-208)', () => {
    expect(Installment.create(validData({ dueDate: null })).dueDate).toBeNull();
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

  describe('pay', () => {
    const confirmation = { userId: 'financeiro-1', at: new Date('2026-10-11T12:00:00.000Z') };

    it('records the manual confirmation that the client paid (IN-13, REQ-092)', () => {
      const paid = Installment.create(validData()).pay(confirmation);

      expect(paid.status).toBe('PAID');
      expect(paid.isPaid).toBe(true);
    });

    it('records who confirmed the receipt and when (REQ-123, IN-13)', () => {
      const paid = Installment.create(validData()).pay(confirmation);

      expect(paid.confirmation?.userId).toBe('financeiro-1');
      expect(paid.confirmation?.at).toBe(confirmation.at);
    });

    it('is rejected without the user who confirmed it (REQ-123)', () => {
      expect(() => Installment.create(validData()).pay({ ...confirmation, userId: '  ' })).toThrow(
        BusinessRuleViolation,
      );
    });

    it('leaves the original untouched', () => {
      const installment = Installment.create(validData());
      installment.pay(confirmation);

      expect(installment.status).toBe('PENDING');
      expect(installment.confirmation).toBeNull();
    });

    it('refuses a second confirmation (REQ-124)', () => {
      const paid = Installment.create(validData()).pay(confirmation);

      expect(() => paid.pay(confirmation)).toThrow(BusinessRuleViolation);
    });
  });
});
