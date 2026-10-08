import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import type { CommissionBasis } from './commission-basis.ts';
import { Commission } from './commission.ts';

const CALCULATED_AT = new Date('2026-09-20T10:00:00.000Z');

const BASIS: CommissionBasis = {
  premium: Money.fromString('100.00'),
  insurerRate: Percentage.fromString('40'),
  insurerAmount: Money.fromString('40.00'),
  intermediaryId: null,
  intermediaryRate: null,
};

function forecast(): Commission {
  return Commission.forecast({
    id: 'commission-1',
    policyId: 'policy-1',
    basis: BASIS,
    agreedReceivable: Money.fromString('40.00'),
    calculatedAt: CALCULATED_AT,
  });
}

describe('Commission', () => {
  it('starts forecast, with the agreed value (REQ-236)', () => {
    const commission = forecast();

    expect(commission.status).toBe('FORECAST');
    expect(commission.agreedReceivable.toString()).toBe('40.00');
  });

  describe('applyOverride', () => {
    const override = {
      receivable: Money.fromString('45.00'),
      justification: 'acordo extraordinario',
      userId: 'user-1',
      at: CALCULATED_AT,
    };

    it('adjusts what the Usina receives on this policy (REQ-066, CA-014)', () => {
      const overridden = forecast().applyOverride(override);

      expect(overridden.effectiveReceivable.toString()).toBe('45.00');
    });

    it('keeps the calculated values next to the override (REQ-124)', () => {
      const overridden = forecast().applyOverride(override);

      expect(overridden.agreedReceivable.toString()).toBe('40.00');
      expect(overridden.override?.justification).toBe('acordo extraordinario');
      expect(overridden.override?.userId).toBe('user-1');
    });

    it('is rejected without a justification (REQ-067, CA-015, REJ-010)', () => {
      expect(() => forecast().applyOverride({ ...override, justification: '   ' })).toThrow(
        BusinessRuleViolation,
      );
    });

    it('is rejected without a user (REQ-123, REJ-010)', () => {
      expect(() => forecast().applyOverride({ ...override, userId: '' })).toThrow(
        BusinessRuleViolation,
      );
    });

    it('is rejected when the value is not positive (REQ-066)', () => {
      expect(() =>
        forecast().applyOverride({ ...override, receivable: Money.fromString('0.00') }),
      ).toThrow(BusinessRuleViolation);
    });
  });
});
