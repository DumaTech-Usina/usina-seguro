import { describe, expect, it } from 'vitest';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import type { Receipt } from '../../proposal/domain/receipt.ts';
import { calculateCommission } from './commission-basis.ts';

function proposal(receipt: Receipt, workedCommission = '20'): Proposal {
  return Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    customerAccepted: true,
    proposalNumber: 'PRP-1',
    netPremium: Money.fromString('100.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [],
    workedCommission: Percentage.fromString(workedCommission),
    workedCommissionMode: 'INTEGRAL',
    receipt,
    registeredBy: 'operator',
    registeredAt: new Date('2026-09-22T12:00:00.000Z'),
  });
}

const THROUGH_INTERMEDIARY: Receipt = {
  kind: 'INTERMEDIARY',
  intermediaryId: 'mega',
  ctu: Percentage.fromString('50'),
};

describe('calculateCommission', () => {
  it('receives premium x CT when the receipt is direct (REQ-236, REQ-230)', () => {
    const result = calculateCommission(proposal({ kind: 'DIRECT' }));

    expect(result.receivable.toString()).toBe('20.00');
    expect(result.basis.insurerRate.toString()).toBe('20');
    expect(result.basis.insurerAmount.toString()).toBe('20.00');
    expect(result.basis.intermediaryId).toBeNull();
    expect(result.basis.intermediaryRate).toBeNull();
  });

  it('chains CT and CTU through the intermediary (REQ-236, REQ-231, CA-219)', () => {
    const result = calculateCommission(proposal(THROUGH_INTERMEDIARY));

    expect(result.basis.insurerAmount.toString()).toBe('20.00');
    expect(result.basis.intermediaryId).toBe('mega');
    expect(result.basis.intermediaryRate?.toString()).toBe('50');
    expect(result.receivable.toString()).toBe('10.00');
  });

  it('uses the net premium of the proposal as the base (REQ-235, REQ-211)', () => {
    const result = calculateCommission(proposal({ kind: 'DIRECT' }));

    expect(result.basis.premium.toString()).toBe('100.00');
  });

  it('follows the CT in force, not the one first informed (REQ-214)', () => {
    const revised = proposal({ kind: 'DIRECT' }).reviseWorkedCommission({
      rate: Percentage.fromString('25'),
      mode: 'INTEGRAL',
      informed: Authorship.of('bruno.lima', new Date('2026-09-23T09:30:00.000Z')),
    });

    expect(calculateCommission(revised).receivable.toString()).toBe('25.00');
  });
});
