import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from './errors.ts';
import { Percentage } from './percentage.ts';

describe('Percentage', () => {
  it('keeps the exact decimal text that was informed (REQ-121)', () => {
    expect(Percentage.fromString('32.5').toString()).toBe('32.5');
    expect(Percentage.fromString('12.345678').toString()).toBe('12.345678');
    expect(Percentage.fromString('40').toString()).toBe('40');
  });

  it('does not normalise away the informed scale', () => {
    // '40' and '40.00' were informed differently and are stored differently:
    // rounding or padding here would diverge from what the insurer sent.
    expect(Percentage.fromString('40.00').toString()).toBe('40.00');
  });

  it('accepts the boundaries of the range', () => {
    expect(Percentage.fromString('0').toString()).toBe('0');
    expect(Percentage.fromString('100').toString()).toBe('100');
    expect(Percentage.fromString('100.000').toString()).toBe('100.000');
  });

  it('rejects a value above one hundred percent', () => {
    expect(() => Percentage.fromString('100.01')).toThrow(BusinessRuleViolation);
    expect(() => Percentage.fromString('101')).toThrow(BusinessRuleViolation);
  });

  it('rejects text that is not a decimal number', () => {
    for (const invalid of ['', '32,5', '32%', '-1', 'abc', '1e2']) {
      expect(() => Percentage.fromString(invalid)).toThrow(BusinessRuleViolation);
    }
  });

  it('reports the violated rule and the offending value', () => {
    try {
      Percentage.fromString('32,5');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-121');
      expect((error as BusinessRuleViolation).params).toEqual({ value: '32,5' });
    }
  });
});
