import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from './errors.ts';
import { Percentage } from './percentage.ts';
import { declareReceipt } from './receipt.ts';

describe('declareReceipt', () => {
  it('declares a direct receipt when there is no intermediary (REQ-220, FA-201)', () => {
    expect(declareReceipt(null)).toEqual({ kind: 'DIRECT' });
  });

  it('declares the one intermediary with its CTU (REQ-220, REQ-221, FA-202)', () => {
    const receipt = declareReceipt({
      intermediaryId: 'intermediary-1',
      ctu: Percentage.fromString('50'),
    });

    expect(receipt.kind).toBe('INTERMEDIARY');
    expect(receipt.kind === 'INTERMEDIARY' && receipt.intermediaryId).toBe('intermediary-1');
    expect(receipt.kind === 'INTERMEDIARY' && receipt.ctu.toString()).toBe('50');
  });

  it('rejects an intermediary declared without a CTU (REJ-202, EX-202)', () => {
    try {
      declareReceipt({ intermediaryId: 'intermediary-1', ctu: null });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).rule).toBe('REQ-221');
      expect((error as BusinessRuleViolation).messageKey).toBe(
        'proposal.intermediary_requires_ctu',
      );
    }
  });

  it('rejects an intermediary with no identification (REQ-220)', () => {
    try {
      declareReceipt({ intermediaryId: '  ', ctu: Percentage.fromString('50') });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-220');
      expect((error as BusinessRuleViolation).params).toEqual({ field: 'intermediaryId' });
    }
  });
});
