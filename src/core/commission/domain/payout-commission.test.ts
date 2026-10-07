import { describe, expect, it } from 'vitest';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from './errors.ts';
import {
  type EligibilityContext,
  PayoutCommission,
  calculatePayout,
  payoutBase,
} from './payout-commission.ts';

const INFORMED_AT = new Date('2026-10-05T12:00:00.000Z');
const REVISED_AT = new Date('2026-10-06T12:00:00.000Z');
const SIGNED_AT = new Date('2026-11-02T15:30:00.000Z');

function informed(rate: string, base = '300.00'): PayoutCommission {
  return PayoutCommission.inform({
    id: 'payout-1',
    policyId: 'policy-1',
    workedCommissionMode: 'INTEGRAL',
    base: Money.fromString(base),
    rate: Percentage.fromString(rate),
    informed: Authorship.of('ana.financeiro', INFORMED_AT),
  });
}

const CONTEXT: EligibilityContext = {
  policyNumber: 'PRP-1',
  broker: 'Corretora Alfa',
  client: 'Ana Lima',
  netPremium: Money.fromString('1000.00'),
  workedCommission: Percentage.fromString('30'),
  ctu: null,
};

function violation(action: () => unknown): BusinessRuleViolation {
  try {
    action();
  } catch (error) {
    if (error instanceof BusinessRuleViolation) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected a BusinessRuleViolation.');
}

describe('payout calculation (REQ-274, REQ-275)', () => {
  it('direct receipt: Usina 300.00, CR 60% -> 180.00 to the broker, 120.00 stays (CA-225)', () => {
    const result = calculatePayout(Money.fromString('300.00'), Percentage.fromString('60'));

    expect(result.payout.toString()).toBe('180.00');
    expect(result.retained.toString()).toBe('120.00');
  });

  it('through an intermediary: Usina 160.00, CR 70% -> 112.00 and 48.00 (CA-226)', () => {
    const result = calculatePayout(Money.fromString('160.00'), Percentage.fromString('70'));

    expect(result.payout.toString()).toBe('112.00');
    expect(result.retained.toString()).toBe('48.00');
  });

  it('rounds the payout by ABNT NBR 5891 and the Usina keeps the difference (CA-227, REQ-298)', () => {
    const result = calculatePayout(Money.fromString('10.00'), Percentage.fromString('70.55'));

    expect(result.payout.toString()).toBe('7.06');
    expect(result.retained.toString()).toBe('2.94');
  });

  it('CR 0: nothing to pay, everything stays with the Usina (CA-228, FA-211)', () => {
    const result = calculatePayout(Money.fromString('300.00'), Percentage.fromString('0'));

    expect(result.payout.toString()).toBe('0.00');
    expect(result.retained.toString()).toBe('300.00');
  });

  it('takes the Usina value as the base, never the intermediary one (REQ-274, REJ-221)', () => {
    const base = payoutBase({
      intermediary: Money.fromString('200.00'),
      usina: Money.fromString('160.00'),
    });

    expect(base.toString()).toBe('160.00');
  });
});

describe('PayoutCommission.inform (REQ-270 to REQ-273)', () => {
  it('is CALCULATED as soon as the CR is informed (REQ-277)', () => {
    const commission = informed('60');

    expect(commission.status).toBe('CALCULATED');
    expect(commission.current.rate.toString()).toBe('60');
    expect(commission.current.payout.toString()).toBe('180.00');
    expect(commission.current.retained.toString()).toBe('120.00');
  });

  it('accepts 0, 70.55 and 100 (CA-229)', () => {
    for (const rate of ['0', '70.55', '100']) {
      expect(informed(rate).current.rate.toString()).toBe(rate);
    }
  });

  it('refuses a CR with more than two decimals (REQ-272, REJ-219)', () => {
    const error = violation(() => informed('70.555'));

    expect(error.rule).toBe('REQ-272');
    expect(error.messageKey).toBe(COMMISSION_MESSAGES.PAYOUT_RATE_TOO_PRECISE);
  });

  it('refuses a CR above 100% or negative (REQ-272, REJ-219)', () => {
    expect(() => informed('100.01')).toThrow(BusinessRuleViolation);
    expect(() => informed('-1')).toThrow(BusinessRuleViolation);
  });

  it('refuses a CR on a policy with parcelled CT (REQ-271, REJ-218)', () => {
    const error = violation(() =>
      PayoutCommission.inform({
        id: 'payout-1',
        policyId: 'policy-1',
        workedCommissionMode: 'PARCELLED',
        base: Money.fromString('300.00'),
        rate: Percentage.fromString('60'),
        informed: Authorship.of('ana.financeiro', INFORMED_AT),
      }),
    );

    expect(error.rule).toBe('REQ-271');
    expect(error.messageKey).toBe(COMMISSION_MESSAGES.PAYOUT_REQUIRES_INTEGRAL_CT);
  });

  it('records who informed it, when, and the calculation as it was (REQ-279, CA-230)', () => {
    const [entry] = informed('60').entries;

    expect(entry?.informed.author).toBe('ana.financeiro');
    expect(entry?.informed.at).toEqual(INFORMED_AT);
    expect(entry?.calculation.base.toString()).toBe('300.00');
    expect(entry?.calculation.rate.toString()).toBe('60');
    expect(entry?.calculation.payout.toString()).toBe('180.00');
    expect(entry?.calculation.retained.toString()).toBe('120.00');
    // The first information has no previous CR and needs no reason.
    expect(entry?.previousRate).toBeNull();
    expect(entry?.reason).toBeNull();
  });
});

describe('PayoutCommission.revise (REQ-277, REQ-279)', () => {
  it('recalculates with the new CR and keeps the earlier entry untouched (FA-212)', () => {
    const revised = informed('60').revise({
      rate: Percentage.fromString('50'),
      reason: 'corretor renegociou',
      informed: Authorship.of('bruno.financeiro', REVISED_AT),
    });

    expect(revised.status).toBe('CALCULATED');
    expect(revised.current.payout.toString()).toBe('150.00');
    expect(revised.current.retained.toString()).toBe('150.00');
    expect(revised.entries).toHaveLength(2);
    expect(revised.entries[0]?.calculation.payout.toString()).toBe('180.00');
  });

  it('records previous and new CR, reason, who and when (CA-230)', () => {
    const revised = informed('60').revise({
      rate: Percentage.fromString('50'),
      reason: 'corretor renegociou',
      informed: Authorship.of('bruno.financeiro', REVISED_AT),
    });
    const entry = revised.entries[1];

    expect(entry?.previousRate?.toString()).toBe('60');
    expect(entry?.calculation.rate.toString()).toBe('50');
    expect(entry?.reason).toBe('corretor renegociou');
    expect(entry?.informed.author).toBe('bruno.financeiro');
    expect(entry?.informed.at).toEqual(REVISED_AT);
  });

  it('refuses a change without a reason (REQ-279, EX-204, REJ-224)', () => {
    const error = violation(() =>
      informed('60').revise({
        rate: Percentage.fromString('50'),
        reason: '   ',
        informed: Authorship.of('bruno.financeiro', REVISED_AT),
      }),
    );

    expect(error.rule).toBe('REQ-279');
    expect(error.messageKey).toBe(COMMISSION_MESSAGES.PAYOUT_REVISION_REASON_REQUIRED);
  });

  it('refuses a new CR with more than two decimals (REQ-272)', () => {
    expect(() =>
      informed('60').revise({
        rate: Percentage.fromString('50.123'),
        reason: 'ajuste',
        informed: Authorship.of('bruno.financeiro', REVISED_AT),
      }),
    ).toThrow(BusinessRuleViolation);
  });

  it('keeps the base of the first calculation: the policy is immutable (REQ-277)', () => {
    const revised = informed('60').revise({
      rate: Percentage.fromString('10'),
      reason: 'ajuste',
      informed: Authorship.of('bruno.financeiro', REVISED_AT),
    });

    expect(revised.current.base.toString()).toBe('300.00');
  });
});

describe('PayoutCommission.declareEligible (REQ-281 to REQ-283)', () => {
  it('becomes ELIGIBLE, signed by who and when (REQ-281, CA-232)', () => {
    const eligible = informed('60').declareEligible(
      CONTEXT,
      Authorship.of('carla.financeiro', SIGNED_AT),
    );

    expect(eligible.status).toBe('ELIGIBLE');
    expect(eligible.statement?.signedBy).toBe('carla.financeiro');
    expect(eligible.statement?.eligibleAt).toEqual(SIGNED_AT);
  });

  it('generates the statement with every datum of REQ-283, none typed (CA-233, CA-237)', () => {
    const statement = informed('60').declareEligible(
      CONTEXT,
      Authorship.of('carla.financeiro', SIGNED_AT),
    ).statement;

    expect(statement).toMatchObject({
      policyNumber: 'PRP-1',
      broker: 'Corretora Alfa',
      client: 'Ana Lima',
      signedBy: 'carla.financeiro',
    });
    expect(statement?.netPremium.toString()).toBe('1000.00');
    expect(statement?.workedCommission.toString()).toBe('30');
    expect(statement?.payoutRate.toString()).toBe('60');
    expect(statement?.ctu).toBeNull();
    expect(statement?.usinaValue.toString()).toBe('300.00');
    expect(statement?.retained.toString()).toBe('120.00');
    expect(statement?.payout.toString()).toBe('180.00');
  });

  it('carries the CTU when the receipt was through an intermediary (REQ-283)', () => {
    const statement = informed('70', '160.00').declareEligible(
      {
        ...CONTEXT,
        workedCommission: Percentage.fromString('20'),
        ctu: Percentage.fromString('80'),
      },
      Authorship.of('carla.financeiro', SIGNED_AT),
    ).statement;

    expect(statement?.ctu?.toString()).toBe('80');
    expect(statement?.usinaValue.toString()).toBe('160.00');
    expect(statement?.payout.toString()).toBe('112.00');
  });

  it('refuses an eligibility nobody signed (REQ-281, REJ-227)', () => {
    expect(() => informed('60').declareEligible(CONTEXT, Authorship.of('  ', SIGNED_AT))).toThrow(
      BusinessRuleViolation,
    );
  });

  it('is definitive: no revision and no second eligibility (REQ-282, EX-206, REJ-228)', () => {
    const eligible = informed('60').declareEligible(
      CONTEXT,
      Authorship.of('carla.financeiro', SIGNED_AT),
    );

    const revision = violation(() =>
      eligible.revise({
        rate: Percentage.fromString('50'),
        reason: 'ajuste',
        informed: Authorship.of('bruno.financeiro', REVISED_AT),
      }),
    );
    expect(revision.rule).toBe('REQ-282');
    expect(revision.messageKey).toBe(COMMISSION_MESSAGES.PAYOUT_ELIGIBLE_IS_FINAL);

    expect(() =>
      eligible.declareEligible(CONTEXT, Authorship.of('carla.financeiro', SIGNED_AT)),
    ).toThrow(BusinessRuleViolation);
  });
});
