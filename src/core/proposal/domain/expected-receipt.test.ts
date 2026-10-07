import { describe, expect, it } from 'vitest';
import {
  commissionBase,
  expectedInstallmentReceipts,
  expectedReceipt,
} from './expected-receipt.ts';
import { Money } from './money.ts';
import { Percentage } from './percentage.ts';

const premium = Money.fromString('100.00');
const ct = Percentage.fromString('20');

describe('expectedReceipt', () => {
  it('without an intermediary, the Usina expects premium x CT (REQ-230, CA-201)', () => {
    const expected = expectedReceipt(premium, ct, { kind: 'DIRECT' });

    expect(expected.intermediary).toBeNull();
    expect(expected.usina.toString()).toBe('20.00');
  });

  it('with an intermediary, it receives premium x CT and the Usina that x CTU (REQ-231, CA-202)', () => {
    const expected = expectedReceipt(premium, ct, {
      kind: 'INTERMEDIARY',
      intermediaryId: 'intermediary-1',
      ctu: Percentage.fromString('50'),
    });

    expect(expected.intermediary?.toString()).toBe('20.00');
    expect(expected.usina.toString()).toBe('10.00');
  });

  it('rounds each step by ABNT NBR 5891: 100.05, CT 15%, CTU 50% -> 15.01 then 7.50 (CA-241, REQ-237)', () => {
    const expected = expectedReceipt(Money.fromString('100.05'), Percentage.fromString('15'), {
      kind: 'INTERMEDIARY',
      intermediaryId: 'intermediary-1',
      ctu: Percentage.fromString('50'),
    });

    expect(expected.intermediary?.toString()).toBe('15.01');
    expect(expected.usina.toString()).toBe('7.50');
  });

  it('rounds at each step, not only at the end: 100.07, CT 15%, CTU 50% -> 7.50, not 7.51 (REQ-237)', () => {
    const expected = expectedReceipt(Money.fromString('100.07'), Percentage.fromString('15'), {
      kind: 'INTERMEDIARY',
      intermediaryId: 'intermediary-1',
      ctu: Percentage.fromString('50'),
    });

    expect(expected.intermediary?.toString()).toBe('15.01');
    expect(expected.usina.toString()).toBe('7.50');
  });
});

describe('commissionBase', () => {
  it('is the net premium for an integral CT (REQ-235)', () => {
    expect(commissionBase(premium, 'INTEGRAL').toString()).toBe('100.00');
  });
});

describe('expectedInstallmentReceipts (parcelled CT)', () => {
  const installments = [
    { amount: Money.fromString('100.00') },
    { amount: Money.fromString('100.00') },
    { amount: Money.fromString('100.00') },
  ];

  it('applies the CT of the first to installment 1 and the other CT to each of the rest (REQ-291, REQ-293, CA-246)', () => {
    const receipts = expectedInstallmentReceipts(
      installments,
      Percentage.fromString('100'),
      Percentage.fromString('30'),
    );

    expect(
      receipts.map((receipt) => [
        receipt.number,
        receipt.amount.toString(),
        receipt.workedCommission.toString(),
        receipt.usina.toString(),
      ]),
    ).toEqual([
      [1, '100.00', '100', '100.00'],
      [2, '100.00', '30', '30.00'],
      [3, '100.00', '30', '30.00'],
    ]);
  });

  it('takes the installment value as the base, never the net premium (REQ-293, CA-247, REJ-231)', () => {
    const [first] = expectedInstallmentReceipts(
      [{ amount: Money.fromString('250.00') }, { amount: Money.fromString('10.00') }],
      Percentage.fromString('20'),
      Percentage.fromString('10'),
    );

    expect(first?.usina.toString()).toBe('50.00');
  });

  it('rounds each installment by ABNT NBR 5891 (REQ-294, REQ-298)', () => {
    const receipts = expectedInstallmentReceipts(
      [{ amount: Money.fromString('10.05') }, { amount: Money.fromString('10.15') }],
      Percentage.fromString('50'),
      Percentage.fromString('50'),
    );

    expect(receipts.map((receipt) => receipt.usina.toString())).toEqual(['5.02', '5.08']);
  });

  it('accepts a CT above 100% (REQ-295)', () => {
    const [first] = expectedInstallmentReceipts(
      [{ amount: Money.fromString('100.00') }, { amount: Money.fromString('100.00') }],
      Percentage.fromStringWithoutCeiling('150'),
      Percentage.fromString('30'),
    );

    expect(first?.usina.toString()).toBe('150.00');
  });
});
