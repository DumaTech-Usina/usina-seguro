import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from './errors.ts';
import { Money } from './money.ts';
import { Percentage } from './percentage.ts';

describe('Money (REQ-120)', () => {
  it('preserves the exact decimal value', () => {
    expect(Money.fromString('1234.56').toString()).toBe('1234.56');
    expect(Money.fromString('0.07').toString()).toBe('0.07');
    expect(Money.fromString('100').toString()).toBe('100.00');
    expect(Money.fromString('100.5').toString()).toBe('100.50');
  });

  it('does not suffer the binary floating point representation error', () => {
    // 0.1 + 0.2 === 0.30000000000000004 under IEEE-754.
    expect(Money.fromString('0.30').equals(Money.fromString('0.3'))).toBe(true);
    expect(Number(Money.fromString('0.30').toString())).toBe(0.3);
  });

  it('adds amounts exactly, on cents (OUT-07)', () => {
    // The sum a statement shows is money, so it never goes through a float.
    expect(Money.fromString('0.10').plus(Money.fromString('0.20')).toString()).toBe('0.30');
    expect(Money.fromString('1234.56').plus(Money.fromString('0.44')).toString()).toBe('1235.00');
    expect(Money.zero().plus(Money.fromString('20.00')).toString()).toBe('20.00');
    expect(Money.zero().toString()).toBe('0.00');
  });

  it('keeps the operand untouched when adding', () => {
    const amount = Money.fromString('10.00');
    amount.plus(Money.fromString('5.00'));

    expect(amount.toString()).toBe('10.00');
  });

  it('rejects a value with more places than the scale supports, instead of rounding', () => {
    expect(() => Money.fromString('10.005')).toThrow(BusinessRuleViolation);
  });

  it('rejects non-numeric input', () => {
    for (const invalid of ['', 'abc', '1,50', '1.2.3', 'NaN']) {
      expect(() => Money.fromString(invalid)).toThrow(BusinessRuleViolation);
    }
  });

  it('reports a message key and params instead of rendered text', () => {
    try {
      Money.fromString('abc');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).messageKey).toBe('money.invalid_format');
      expect((error as BusinessRuleViolation).params).toEqual({ value: 'abc', scale: '2' });
    }
  });

  describe('applyRate', () => {
    it('applies a commission rate on the amount (REQ-068)', () => {
      expect(Money.fromString('100.00').applyRate(Percentage.fromString('40')).toString()).toBe(
        '40.00',
      );
    });

    it('uses the full informed precision of the rate (REQ-121)', () => {
      expect(Money.fromString('1200.00').applyRate(Percentage.fromString('32.5')).toString()).toBe(
        '390.00',
      );
      expect(
        Money.fromString('1000.00').applyRate(Percentage.fromString('12.3456')).toString(),
      ).toBe('123.46');
    });

    it('rounds halves away from zero, on the cent', () => {
      // 100.05 x 50% = 50.025 -> 50.03
      expect(Money.fromString('100.05').applyRate(Percentage.fromString('50')).toString()).toBe(
        '50.03',
      );
      // 0.01 x 50% = 0.005 -> 0.01
      expect(Money.fromString('0.01').applyRate(Percentage.fromString('50')).toString()).toBe(
        '0.01',
      );
    });

    it('never goes through binary floating point (REQ-120)', () => {
      // 0.1 + 0.2 is the classic float trap; here the chain stays on integers.
      const amount = Money.fromString('92233720368547758.07');

      expect(amount.applyRate(Percentage.fromString('100')).toString()).toBe(
        '92233720368547758.07',
      );
    });

    it('is a no-op at zero percent', () => {
      expect(Money.fromString('100.00').applyRate(Percentage.fromString('0')).toString()).toBe(
        '0.00',
      );
    });
  });

  describe('applyRate rounding down (REQ-275)', () => {
    it('floors on the cent: 10.00 x 70.55% = 7.055 -> 7.05 (CA-227)', () => {
      expect(
        Money.fromString('10.00').applyRate(Percentage.fromString('70.55'), 'FLOOR').toString(),
      ).toBe('7.05');
    });

    it('keeps an exact result exact (CA-225, CA-226)', () => {
      expect(
        Money.fromString('300.00').applyRate(Percentage.fromString('60'), 'FLOOR').toString(),
      ).toBe('180.00');
      expect(
        Money.fromString('160.00').applyRate(Percentage.fromString('70'), 'FLOOR').toString(),
      ).toBe('112.00');
    });

    it('does not change the default, which rounds halves up (REQ-237)', () => {
      expect(Money.fromString('10.00').applyRate(Percentage.fromString('70.55')).toString()).toBe(
        '7.06',
      );
    });
  });

  it('subtracts exactly, on cents (REQ-275)', () => {
    expect(Money.fromString('10.00').minus(Money.fromString('7.05')).toString()).toBe('2.95');
    expect(Money.fromString('300.00').minus(Money.fromString('0.00')).toString()).toBe('300.00');
  });
});
