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

    it('rounds on the cent by ABNT NBR 5891: an exact half goes to the even cent (REQ-298)', () => {
      // 100.05 x 50% = 50.025 -> 50.02 (2 is even)
      expect(Money.fromString('100.05').applyRate(Percentage.fromString('50')).toString()).toBe(
        '50.02',
      );
      // 0.01 x 50% = 0.005 -> 0.00 (0 is even)
      expect(Money.fromString('0.01').applyRate(Percentage.fromString('50')).toString()).toBe(
        '0.00',
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

  describe('applyRate by ABNT NBR 5891 (REQ-298, CA-248)', () => {
    it('keeps the cent when less than half of it is discarded', () => {
      // 100.00 x 12.3444% = 12.3444 -> 12.34
      expect(
        Money.fromString('100.00').applyRate(Percentage.fromString('12.3444')).toString(),
      ).toBe('12.34');
    });

    it('raises the cent when more than half of it is discarded: 15.0075 -> 15.01', () => {
      expect(Money.fromString('100.05').applyRate(Percentage.fromString('15')).toString()).toBe(
        '15.01',
      );
    });

    it('on an exact half, keeps an even cent: 10.05 x 50% = 5.025 -> 5.02', () => {
      expect(Money.fromString('10.05').applyRate(Percentage.fromString('50')).toString()).toBe(
        '5.02',
      );
    });

    it('on an exact half, raises an odd cent to the even one: 10.15 x 50% = 5.075 -> 5.08', () => {
      expect(Money.fromString('10.15').applyRate(Percentage.fromString('50')).toString()).toBe(
        '5.08',
      );
    });

    it('is the rounding of the broker amount too: 10.00 x 70.55% = 7.055 -> 7.06 (CA-227)', () => {
      expect(Money.fromString('10.00').applyRate(Percentage.fromString('70.55')).toString()).toBe(
        '7.06',
      );
    });

    it('is symmetric for a negative amount', () => {
      expect(Money.fromString('-10.05').applyRate(Percentage.fromString('50')).toString()).toBe(
        '-5.02',
      );
      expect(Money.fromString('-10.15').applyRate(Percentage.fromString('50')).toString()).toBe(
        '-5.08',
      );
    });
  });

  it('subtracts exactly, on cents (REQ-275)', () => {
    expect(Money.fromString('10.00').minus(Money.fromString('7.05')).toString()).toBe('2.95');
    expect(Money.fromString('300.00').minus(Money.fromString('0.00')).toString()).toBe('300.00');
  });
});
