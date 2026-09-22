import { describe, expect, it } from 'vitest';
import { commissionBase, expectedReceipt } from './expected-receipt.ts';
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
});

describe('commissionBase', () => {
  it('is the net premium for an integral CT (REQ-235)', () => {
    expect(commissionBase(premium, 'INTEGRAL').toString()).toBe('100.00');
  });

  it('is still the net premium for a parcelled CT while DEC-203 is open (REQ-235, CA-215)', () => {
    expect(commissionBase(premium, 'PARCELLED').toString()).toBe('100.00');
  });
});
