import { describe, expect, it } from 'vitest';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { BrokerCommissionRate } from './broker-commission-rate.ts';
import {
  type BrokerBase,
  CommissionAgreement,
  type CommissionChain,
} from './commission-agreement.ts';
import { calculateCommission } from './commission-basis.ts';

function agreement(chain: CommissionChain, insurerRate = '40'): CommissionAgreement {
  return CommissionAgreement.register({
    id: 'agreement-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    effectiveFrom: CalendarDate.fromString('2026-01-01'),
    insurerRate: Percentage.fromString(insurerRate),
    chain,
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function brokerRate(rate: string): BrokerCommissionRate {
  return BrokerCommissionRate.register({
    brokerId: 'broker-1',
    rate: Percentage.fromString(rate),
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function intermediary(
  intermediaryRate: string,
  brokerBase: BrokerBase = 'INTERMEDIARY',
): CommissionChain {
  return {
    kind: 'INTERMEDIARY',
    intermediaryId: 'mega',
    intermediaryRate: Percentage.fromString(intermediaryRate),
    brokerBase,
  };
}

describe('calculateCommission', () => {
  it('walks the direct chain of the reference example (REQ-068)', () => {
    // Premium 100.00 -> the insurer pays 40.00 to the Usina -> the Usina
    // transfers 20.00 to the broker.
    const result = calculateCommission(
      Money.fromString('100.00'),
      agreement({ kind: 'DIRECT' }, '40'),
      brokerRate('50'),
    );

    expect(result.receivable.toString()).toBe('40.00');
    expect(result.payable.toString()).toBe('20.00');
  });

  it('bases the broker on what the Usina received when there is no intermediary (REQ-062, CA-010)', () => {
    const result = calculateCommission(
      Money.fromString('100.00'),
      agreement({ kind: 'DIRECT' }, '40'),
      brokerRate('50'),
    );

    expect(result.basis.brokerBase).toBe('USINA');
    expect(result.basis.brokerBaseAmount.toString()).toBe('40.00');
    expect(result.basis.intermediaryId).toBeNull();
  });

  it('walks the chain with an intermediary of the reference example (REQ-069)', () => {
    // Insurer 100.00 -> Mega 40.00 -> Usina 32.00.
    const result = calculateCommission(
      Money.fromString('100.00'),
      agreement(intermediary('80'), '40'),
      brokerRate('50'),
    );

    expect(result.basis.insurerAmount.toString()).toBe('40.00');
    expect(result.receivable.toString()).toBe('32.00');
  });

  it("defaults the broker base to the intermediary's amount (REQ-063, CA-011)", () => {
    const result = calculateCommission(
      Money.fromString('100.00'),
      agreement(intermediary('80'), '40'),
      brokerRate('50'),
    );

    // Base is Mega's 40.00, not the Usina's 32.00.
    expect(result.basis.brokerBase).toBe('INTERMEDIARY');
    expect(result.basis.brokerBaseAmount.toString()).toBe('40.00');
    expect(result.payable.toString()).toBe('20.00');
  });

  it("uses the Usina's amount as the base when the intermediary is configured that way (REQ-064, FA-06)", () => {
    const result = calculateCommission(
      Money.fromString('100.00'),
      agreement(intermediary('80', 'USINA'), '40'),
      brokerRate('50'),
    );

    expect(result.basis.brokerBaseAmount.toString()).toBe('32.00');
    expect(result.payable.toString()).toBe('16.00');
  });

  it('produces different commissions for different rates on the same premium (CA-013)', () => {
    const premium = Money.fromString('1200.00');

    const first = calculateCommission(
      premium,
      agreement({ kind: 'DIRECT' }, '40'),
      brokerRate('50'),
    );
    const second = calculateCommission(
      premium,
      agreement({ kind: 'DIRECT' }, '32.5'),
      brokerRate('50'),
    );

    expect(first.receivable.toString()).toBe('480.00');
    expect(second.receivable.toString()).toBe('390.00');
  });

  it('keeps the numbers that produced the result, for the panel of REQ-076 (REJ-011)', () => {
    const result = calculateCommission(
      Money.fromString('100.00'),
      agreement(intermediary('80'), '40'),
      brokerRate('50'),
    );

    expect(result.basis.premium.toString()).toBe('100.00');
    expect(result.basis.insurerRate.toString()).toBe('40');
    expect(result.basis.intermediaryId).toBe('mega');
    expect(result.basis.intermediaryRate?.toString()).toBe('80');
    expect(result.basis.brokerRate.toString()).toBe('50');
  });

  it('honours the informed precision of the rate without rounding it away (REQ-121)', () => {
    // 1200.00 x 32.5% = 390.00 exactly; a rate truncated to 32% would give 384.00.
    const result = calculateCommission(
      Money.fromString('1200.00'),
      agreement({ kind: 'DIRECT' }, '32.5'),
      brokerRate('10.75'),
    );

    expect(result.receivable.toString()).toBe('390.00');
    // 390.00 x 10.75% = 41.925 -> 41.93 (half away from zero, on the cent).
    expect(result.payable.toString()).toBe('41.93');
  });
});
