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

  describe('without the 100% ceiling (REQ-295, REQ-263)', () => {
    it('accepts a CT of a parcelled proposal above 100%, with no upper limit for now (CA-249)', () => {
      expect(Percentage.fromStringWithoutCeiling('150').toString()).toBe('150');
      expect(Percentage.fromStringWithoutCeiling('100.01').toString()).toBe('100.01');
      expect(Percentage.fromStringWithoutCeiling('1000').toString()).toBe('1000');
    });

    it('still refuses text that is not a decimal number', () => {
      for (const invalid of ['', '32,5', '-1', 'abc']) {
        expect(() => Percentage.fromStringWithoutCeiling(invalid)).toThrow(BusinessRuleViolation);
      }
    });
  });

  it('compares two rates exactly, whatever their informed scales (REQ-263)', () => {
    const thirty = Percentage.fromString('30');

    expect(Percentage.fromString('30.01').isGreaterThan(thirty)).toBe(true);
    expect(Percentage.fromString('30.00').isGreaterThan(thirty)).toBe(false);
    expect(Percentage.fromString('29.999').isGreaterThan(thirty)).toBe(false);
    expect(Percentage.fromStringWithoutCeiling('150').isGreaterThan(thirty)).toBe(true);
  });
});
