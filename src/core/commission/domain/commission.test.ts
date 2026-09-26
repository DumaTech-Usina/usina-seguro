import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import type { CommissionBasis } from './commission-basis.ts';
import { Commission } from './commission.ts';

const CALCULATED_AT = new Date('2026-09-20T10:00:00.000Z');
const RECONCILED_AT = new Date('2026-10-02T10:00:00.000Z');

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
  it('starts forecast, with the agreed value and no real value (REQ-075, section 10.5)', () => {
    const commission = forecast();

    expect(commission.status).toBe('FORECAST');
    expect(commission.agreedReceivable.toString()).toBe('40.00');
    expect(commission.realReceivable).toBeNull();
    expect(commission.isDivergent).toBe(false);
  });

  describe('reconcile', () => {
    it('records the real value and matches the agreed one (REQ-075, section 10.5)', () => {
      const reconciled = forecast().reconcile('2026-10', Money.fromString('40.00'), RECONCILED_AT);

      expect(reconciled.status).toBe('RECONCILED');
      expect(reconciled.realReceivable?.toString()).toBe('40.00');
      expect(reconciled.isDivergent).toBe(false);
    });

    it('signals a divergence when agreed and real disagree (REQ-076, CA-017)', () => {
      const reconciled = forecast().reconcile('2026-10', Money.fromString('35.00'), RECONCILED_AT);

      expect(reconciled.status).toBe('DIVERGENT');
      expect(reconciled.isDivergent).toBe(true);
      // REQ-077: the divergence is information, and both values stay readable.
      expect(reconciled.agreedReceivable.toString()).toBe('40.00');
      expect(reconciled.realReceivable?.toString()).toBe('35.00');
    });

    it('refuses a second entry for the same competence (REQ-086, CA-021, REJ-012)', () => {
      const reconciled = forecast().reconcile('2026-10', Money.fromString('40.00'), RECONCILED_AT);

      expect(reconciled.isReconciledFor('2026-10')).toBe(true);
      expect(() =>
        reconciled.reconcile('2026-10', Money.fromString('40.00'), RECONCILED_AT),
      ).toThrow(BusinessRuleViolation);
    });

    it('accepts a later competence on the same policy (REQ-086)', () => {
      const reconciled = forecast()
        .reconcile('2026-10', Money.fromString('40.00'), RECONCILED_AT)
        .reconcile('2026-11', Money.fromString('40.00'), RECONCILED_AT);

      expect(reconciled.reconciledCompetence).toBe('2026-11');
    });

    it('requires a competence (REQ-086)', () => {
      expect(() => forecast().reconcile('  ', Money.fromString('40.00'), RECONCILED_AT)).toThrow(
        BusinessRuleViolation,
      );
    });
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

    it('does not erase the resolution of a divergence already closed (REQ-124, REJ-014)', () => {
      const resolved = forecast()
        .reconcile('2026-10', Money.fromString('45.00'), RECONCILED_AT)
        .resolveDivergence({
          justification: 'seguradora confirmou 45.00',
          userId: 'user-2',
          at: RECONCILED_AT,
        });

      // The agreed side is then adjusted to the value the insurer confirmed.
      const overridden = resolved.applyOverride(override);

      expect(overridden.isDivergent).toBe(false);
      // CA-026 keeps who closed the divergence, when and why, on the record.
      expect(overridden.resolution?.userId).toBe('user-2');
      expect(overridden.resolution?.justification).toBe('seguradora confirmou 45.00');
    });

    it('re-answers the comparison of REQ-076 on a commission already apurada', () => {
      const reconciled = forecast().reconcile('2026-10', Money.fromString('45.00'), RECONCILED_AT);
      expect(reconciled.status).toBe('DIVERGENT');

      // The agreement was in fact 45.00, so there is no divergence any more.
      const overridden = reconciled.applyOverride(override);

      expect(overridden.isDivergent).toBe(false);
      expect(overridden.status).toBe('RECONCILED');
    });
  });

  describe('resolveDivergence', () => {
    const resolution = {
      justification: 'seguradora confirmou o valor menor',
      userId: 'user-2',
      at: RECONCILED_AT,
    };

    it('records user, date and reason (REQ-085, CA-026, REQ-123)', () => {
      const resolved = forecast()
        .reconcile('2026-10', Money.fromString('35.00'), RECONCILED_AT)
        .resolveDivergence(resolution);

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolution?.userId).toBe('user-2');
      expect(resolved.resolution?.at).toBe(RECONCILED_AT);
      // REJ-014: the divergent values are not erased by the resolution.
      expect(resolved.realReceivable?.toString()).toBe('35.00');
      expect(resolved.agreedReceivable.toString()).toBe('40.00');
    });

    it('only applies to a divergent commission (section 10.5)', () => {
      const reconciled = forecast().reconcile('2026-10', Money.fromString('40.00'), RECONCILED_AT);

      expect(() => reconciled.resolveDivergence(resolution)).toThrow(BusinessRuleViolation);
    });

    it('is rejected without a justification (REQ-085)', () => {
      const divergent = forecast().reconcile('2026-10', Money.fromString('35.00'), RECONCILED_AT);

      expect(() => divergent.resolveDivergence({ ...resolution, justification: '' })).toThrow(
        BusinessRuleViolation,
      );
    });
  });
});
