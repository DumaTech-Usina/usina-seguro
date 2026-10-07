import { describe, expect, it } from 'vitest';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import {
  type InstallmentBase,
  ParcelledPayoutCommission,
  parcelledSituationOf,
} from './parcelled-payout.ts';

const INFORMED_AT = new Date('2026-10-02T10:00:00.000Z');
const REVISED_AT = new Date('2026-10-03T10:00:00.000Z');
const ELIGIBLE_AT = new Date('2026-10-04T10:00:00.000Z');

/** CT 100/30 on three installments of 100.00 (CA-246). */
const INSTALLMENTS: readonly InstallmentBase[] = [
  {
    number: 1,
    amount: Money.fromString('100.00'),
    workedCommission: Percentage.fromString('100'),
    usinaValue: Money.fromString('100.00'),
  },
  {
    number: 2,
    amount: Money.fromString('100.00'),
    workedCommission: Percentage.fromString('30'),
    usinaValue: Money.fromString('30.00'),
  },
  {
    number: 3,
    amount: Money.fromString('100.00'),
    workedCommission: Percentage.fromString('30'),
    usinaValue: Money.fromString('30.00'),
  },
];

const CONTEXT = {
  policyNumber: 'PRP-1',
  broker: 'Corretora Alfa',
  insurer: 'ALLIANZ',
  client: 'Ana Lima',
};

function informed(first = '100', subsequent = '15'): ParcelledPayoutCommission {
  return ParcelledPayoutCommission.inform({
    id: 'payout-1',
    policyId: 'policy-1',
    installments: INSTALLMENTS,
    firstRate: Percentage.fromStringWithoutCeiling(first),
    subsequentRate: Percentage.fromStringWithoutCeiling(subsequent),
    informed: Authorship.of('ana', INFORMED_AT),
  });
}

function violation(work: () => unknown): BusinessRuleViolation {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    return error as BusinessRuleViolation;
  }
  throw new Error('should have thrown');
}

describe('ParcelledPayoutCommission.inform (REQ-287, REQ-263, REQ-264)', () => {
  it('applies the CR of the first to installment 1 and the other to the rest, on the installment value (REQ-264, CA-254)', () => {
    const [first, second] = informed().current.calculations;

    expect(first).toMatchObject({ number: 1 });
    expect(first?.payoutRate.toString()).toBe('100');
    expect(first?.payout.toString()).toBe('100.00');
    expect(first?.retained.toString()).toBe('0.00');
    expect(second?.payoutRate.toString()).toBe('15');
    // 100.00 x CR 15% = 15.00 to the broker, never 30.00 x 15% (REJ-237).
    expect(second?.payout.toString()).toBe('15.00');
    // What stays with the Usina is the difference (CA-263).
    expect(second?.retained.toString()).toBe('15.00');
  });

  it('keeps both CRs and who informed them, when (REQ-287, REQ-265)', () => {
    const entry = informed().current;

    expect(entry.firstRate.toString()).toBe('100');
    expect(entry.subsequentRate.toString()).toBe('15');
    expect(entry.previousFirstRate).toBeNull();
    expect(entry.reason).toBeNull();
    expect(entry.informed.author).toBe('ana');
    expect(entry.informed.at).toEqual(INFORMED_AT);
  });

  it('accepts a CR equal to its CT and a CR zero informed deliberately (REQ-263, CA-262, FA-225)', () => {
    expect(informed('100', '30').current.calculations[1]?.payout.toString()).toBe('30.00');
    expect(informed('0', '0').current.calculations.map((c) => c.payout.toString())).toEqual([
      '0.00',
      '0.00',
      '0.00',
    ]);
  });

  it('refuses a CR of the first above the CT of the first (REQ-263, EX-213, REJ-241)', () => {
    const error = violation(() => informed('100.01', '15'));

    expect(error.rule).toBe('REQ-263');
    expect(error.messageKey).toBe('commission.parcelled_first_rate_above_ct');
  });

  it('refuses a CR of the subsequent above the CT of the subsequent (REQ-263, CA-262)', () => {
    const error = violation(() => informed('100', '30.01'));

    expect(error.rule).toBe('REQ-263');
    expect(error.messageKey).toBe('commission.parcelled_subsequent_rate_above_ct');
  });

  it('rounds the broker amount of each installment by ABNT NBR 5891 (REQ-264, REQ-298)', () => {
    const commission = ParcelledPayoutCommission.inform({
      id: 'payout-1',
      policyId: 'policy-1',
      installments: [
        {
          number: 1,
          amount: Money.fromString('10.05'),
          workedCommission: Percentage.fromString('100'),
          usinaValue: Money.fromString('10.05'),
        },
        {
          number: 2,
          amount: Money.fromString('10.15'),
          workedCommission: Percentage.fromString('60'),
          usinaValue: Money.fromString('6.09'),
        },
      ],
      firstRate: Percentage.fromString('50'),
      subsequentRate: Percentage.fromString('50'),
      informed: Authorship.of('ana', INFORMED_AT),
    });

    expect(commission.current.calculations.map((c) => c.payout.toString())).toEqual([
      '5.02',
      '5.08',
    ]);
  });
});

describe('ParcelledPayoutCommission.revise (REQ-265, REQ-289)', () => {
  it('changes both CRs with a reason, keeping the earlier entry (REQ-265, FA-223, CA-255)', () => {
    const revised = informed().revise({
      firstRate: Percentage.fromString('90'),
      subsequentRate: Percentage.fromString('20'),
      reason: 'acordo revisto',
      informed: Authorship.of('bruno', REVISED_AT),
    });

    expect(revised.entries).toHaveLength(2);
    const entry = revised.current;
    expect(entry.previousFirstRate?.toString()).toBe('100');
    expect(entry.previousSubsequentRate?.toString()).toBe('15');
    expect(entry.firstRate.toString()).toBe('90');
    expect(entry.subsequentRate.toString()).toBe('20');
    expect(entry.reason).toBe('acordo revisto');
    // REQ-265: the calculation of each installment, as it was then.
    expect(entry.calculations.map((c) => c.payout.toString())).toEqual(['90.00', '20.00', '20.00']);
    expect(revised.entries[0]?.calculations.map((c) => c.payout.toString())).toEqual([
      '100.00',
      '15.00',
      '15.00',
    ]);
  });

  it('refuses a change without a reason (REQ-265, REQ-279)', () => {
    expect(
      violation(() =>
        informed().revise({
          firstRate: Percentage.fromString('90'),
          subsequentRate: Percentage.fromString('20'),
          reason: '  ',
          informed: Authorship.of('bruno', REVISED_AT),
        }),
      ).rule,
    ).toBe('REQ-265');
  });

  it('refuses a new CR above its CT (REQ-263)', () => {
    expect(
      violation(() =>
        informed().revise({
          firstRate: Percentage.fromString('90'),
          subsequentRate: Percentage.fromString('31'),
          reason: 'motivo',
          informed: Authorship.of('bruno', REVISED_AT),
        }),
      ).rule,
    ).toBe('REQ-263');
  });

  it('refuses any change once an installment is eligible: both CRs freeze for all (REQ-289, EX-211, REJ-234)', () => {
    const eligible = informed().declareEligible(2, CONTEXT, Authorship.of('carla', ELIGIBLE_AT));

    const error = violation(() =>
      eligible.revise({
        firstRate: Percentage.fromString('90'),
        subsequentRate: Percentage.fromString('20'),
        reason: 'motivo',
        informed: Authorship.of('bruno', REVISED_AT),
      }),
    );

    expect(error.rule).toBe('REQ-289');
    expect(error.messageKey).toBe('commission.parcelled_rates_frozen');
  });
});

describe('ParcelledPayoutCommission.declareEligible (REQ-288, REQ-266)', () => {
  it('makes one installment eligible, signed, with its statement (REQ-288, REQ-266, CA-256, CA-258)', () => {
    const eligible = informed().declareEligible(2, CONTEXT, Authorship.of('carla', ELIGIBLE_AT));

    expect(eligible.statementOf(2)).toEqual({
      policyNumber: 'PRP-1',
      broker: 'Corretora Alfa',
      insurer: 'ALLIANZ',
      client: 'Ana Lima',
      installmentNumber: 2,
      installmentAmount: Money.fromString('100.00'),
      workedCommission: Percentage.fromString('30'),
      payoutRate: Percentage.fromString('15'),
      retained: Money.fromString('15.00'),
      payout: Money.fromString('15.00'),
      eligibleAt: ELIGIBLE_AT,
      signedBy: 'carla',
    });
    expect(eligible.statementOf(1)).toBeNull();
  });

  it('needs no order: installment 3 may come before 1 and 2 (REQ-288, FA-222)', () => {
    const eligible = informed().declareEligible(3, CONTEXT, Authorship.of('carla', ELIGIBLE_AT));

    expect(eligible.statementOf(3)?.installmentNumber).toBe(3);
  });

  it('is definitive: the same installment cannot become eligible again (REQ-288, EX-212, REJ-239)', () => {
    const eligible = informed().declareEligible(2, CONTEXT, Authorship.of('carla', ELIGIBLE_AT));

    expect(
      violation(() => eligible.declareEligible(2, CONTEXT, Authorship.of('carla', ELIGIBLE_AT)))
        .messageKey,
    ).toBe('commission.installment_already_eligible');
  });

  it('refuses an installment the policy does not have', () => {
    expect(
      violation(() => informed().declareEligible(4, CONTEXT, Authorship.of('carla', ELIGIBLE_AT)))
        .messageKey,
    ).toBe('commission.installment_not_in_policy');
  });
});

describe('parcelledSituationOf (REQ-268)', () => {
  const signed = Authorship.of('carla', ELIGIBLE_AT);

  it('is "without CR" with no CR informed (REQ-268, CA-265)', () => {
    expect(parcelledSituationOf(null)).toBe('WITHOUT_CR');
  });

  it('is "no installment eligible" once the CRs are informed (CA-265)', () => {
    expect(parcelledSituationOf(informed())).toBe('NONE_ELIGIBLE');
  });

  it('is "partially eligible" with some and "fully eligible" with all (CA-267)', () => {
    const one = informed().declareEligible(1, CONTEXT, signed);
    const all = one.declareEligible(2, CONTEXT, signed).declareEligible(3, CONTEXT, signed);

    expect(parcelledSituationOf(one)).toBe('PARTIALLY_ELIGIBLE');
    expect(parcelledSituationOf(all)).toBe('FULLY_ELIGIBLE');
  });
});
