import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from './errors.ts';
import { Money } from './money.ts';

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
});
