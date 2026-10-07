import type { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { ExpectedReceipt } from '../../proposal/domain/expected-receipt.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import type { WorkedCommissionMode } from '../../proposal/domain/worked-commission.ts';
import { COMMISSION_MESSAGES } from './errors.ts';

/**
 * States of the payout commission of a policy (REQ-276).
 *
 * ```
 * (policy without CR) ──CR informed──► CALCULATED ──eligibility signed──► ELIGIBLE
 *                                        │     ▲
 *                                        └─────┘ recalculation (CR changed)
 * ```
 *
 * "Without CR" is not a state of this record: it is the absence of it
 * (REQ-273), and nothing is assumed in its place (REQ-272, REJ-220).
 */
export type PayoutStatus = 'CALCULATED' | 'ELIGIBLE';

/**
 * REQ-285: the three situations of a policy with integral CT as to the
 * payout. They only move forward: without CR -> calculated -> eligible.
 */
export type PayoutSituation = 'WITHOUT_CR' | 'CALCULATED' | 'ELIGIBLE';

/** REQ-274, REQ-275: the calculation as it was made, never recalculated later. */
export interface PayoutCalculation {
  /** The Usina value the CR was applied to (REQ-274). */
  readonly base: Money;
  /** The CR (REQ-270). */
  readonly rate: Percentage;
  /** To be paid to the broker: base x CR, rounded by ABNT NBR 5891 (REQ-275, REQ-298). */
  readonly payout: Money;
  /** What stays with the Usina: the difference (REQ-275). */
  readonly retained: Money;
}

/** One information or change of the CR, audited as REQ-279 lists. */
export interface PayoutRateEntry {
  readonly calculation: PayoutCalculation;
  /** The CR it replaced; `null` on the first information. */
  readonly previousRate: Percentage | null;
  /** Mandatory on a change, not asked on the first information. */
  readonly reason: string | null;
  /** Who, signed as REQ-216, and the moment it was recorded. */
  readonly informed: Authorship;
}

/**
 * What the statement takes from the policy (REQ-283). Nothing of it is typed:
 * the use case reads it from the policy and the proposal it inherited.
 */
export interface EligibilityContext {
  readonly policyNumber: string;
  /** The broker's name as the proposal carries it (DEC-208). */
  readonly broker: string;
  readonly client: string;
  readonly netPremium: Money;
  /** The CT. */
  readonly workedCommission: Percentage;
  /** The CTU, only when the receipt was through an intermediary. */
  readonly ctu: Percentage | null;
}

/** REQ-283: the canonical record of the eligibility event. */
export interface EligibilityStatement extends EligibilityContext {
  readonly payoutRate: Percentage;
  readonly usinaValue: Money;
  readonly retained: Money;
  readonly payout: Money;
  /** The eligibility date: the moment it was signed (REQ-281). */
  readonly eligibleAt: Date;
  readonly signedBy: string;
}

export interface PayoutCommissionData {
  readonly id: string;
  readonly policyId: string;
  readonly status: PayoutStatus;
  /** Every CR informed, oldest first. Nothing is erased (REQ-124). */
  readonly entries: readonly PayoutRateEntry[];
  readonly statement: EligibilityStatement | null;
}

export interface PayoutInformation {
  readonly id: string;
  readonly policyId: string;
  /** REQ-271: only a policy with integral CT receives a CR. */
  readonly workedCommissionMode: WorkedCommissionMode;
  /** The Usina value of the policy, chosen by `payoutBase`. */
  readonly base: Money;
  readonly rate: Percentage;
  readonly informed: Authorship;
}

export interface PayoutRevision {
  readonly rate: Percentage;
  readonly reason: string;
  readonly informed: Authorship;
}

/**
 * REQ-234, REQ-274: the base of the payout is the Usina value — through the
 * CT, or the CTU when there is an intermediary. Kept apart from the
 * calculation so an extraordinary base can be added without rewriting it
 * (CA-211).
 */
export function payoutBase(expected: ExpectedReceipt): Money {
  return expected.usina;
}

/** REQ-274, REQ-275: payout rounded by ABNT NBR 5891 (REQ-298); the Usina keeps the rest. */
export function calculatePayout(base: Money, rate: Percentage): PayoutCalculation {
  const payout = base.applyRate(rate);

  return { base, rate, payout, retained: base.minus(payout) };
}

/**
 * REQ-285: the situation of a policy. A policy with parcelled CT is outside
 * the three while DEC-210 is open (REQ-271), which is `null`.
 */
export function situationOf(
  mode: WorkedCommissionMode,
  commission: { readonly status: PayoutStatus } | null,
): PayoutSituation | null {
  if (mode !== 'INTEGRAL') {
    return null;
  }

  return commission === null ? 'WITHOUT_CR' : commission.status;
}

/** REQ-272: 0 to 100 is `Percentage`'s; at most two decimals is this rule's. */
function assertRatePrecision(rate: Percentage): void {
  if (rate.asFraction().scale > 2) {
    throw new BusinessRuleViolation('REQ-272', COMMISSION_MESSAGES.PAYOUT_RATE_TOO_PRECISE, {
      value: rate.toString(),
    });
  }
}

/**
 * The payout commission of one policy: the CR, its calculation and, once
 * signed, its eligibility (V2 section 9A).
 *
 * Calculated is control and still changes; eligible is fit for the payout and
 * never changes again (REQ-280). The system pays nothing: the statement is
 * what an external system acts on.
 */
export class PayoutCommission {
  readonly id: string;
  readonly policyId: string;
  readonly status: PayoutStatus;
  readonly entries: readonly PayoutRateEntry[];
  readonly statement: EligibilityStatement | null;

  private constructor(data: PayoutCommissionData) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.status = data.status;
    this.entries = data.entries;
    this.statement = data.statement;
  }

  /** FP-02 step 2: a user informs the CR of a policy with integral CT. */
  static inform(information: PayoutInformation): PayoutCommission {
    if (information.workedCommissionMode !== 'INTEGRAL') {
      throw new BusinessRuleViolation('REQ-271', COMMISSION_MESSAGES.PAYOUT_REQUIRES_INTEGRAL_CT);
    }

    assertRatePrecision(information.rate);

    return new PayoutCommission({
      id: information.id,
      policyId: information.policyId,
      status: 'CALCULATED',
      entries: [
        {
          calculation: calculatePayout(information.base, information.rate),
          previousRate: null,
          reason: null,
          informed: information.informed,
        },
      ],
      statement: null,
    });
  }

  /** Rebuilds a persisted commission without re-applying the rules (REQ-124). */
  static restore(data: PayoutCommissionData): PayoutCommission {
    return new PayoutCommission(data);
  }

  /** The calculation in force: the last CR informed. */
  get current(): PayoutCalculation {
    const last = this.entries[this.entries.length - 1];

    if (last === undefined) {
      throw new Error('A payout commission always has at least one CR entry.');
    }

    return last.calculation;
  }

  /**
   * FP-02 step 4, REQ-277: the recalculation. Only the CR changes; the base is
   * the policy's, which is immutable. Reason, author and moment are recorded
   * next to the previous and the new CR (REQ-279).
   */
  revise(revision: PayoutRevision): PayoutCommission {
    this.assertCalculated();

    const reason = revision.reason.trim();

    if (reason === '') {
      throw new BusinessRuleViolation(
        'REQ-279',
        COMMISSION_MESSAGES.PAYOUT_REVISION_REASON_REQUIRED,
      );
    }

    assertRatePrecision(revision.rate);

    return new PayoutCommission({
      ...this,
      entries: [
        ...this.entries,
        {
          calculation: calculatePayout(this.current.base, revision.rate),
          previousRate: this.current.rate,
          reason,
          informed: revision.informed,
        },
      ],
    });
  }

  /**
   * FP-02 steps 5 and 6, REQ-281 to REQ-283: a user, having verified outside
   * the system that the Usina received, signs the eligibility. The statement
   * is generated from the policy, the calculation and the signature.
   */
  declareEligible(context: EligibilityContext, signed: Authorship): PayoutCommission {
    this.assertCalculated();

    const { base, rate, payout, retained } = this.current;

    return new PayoutCommission({
      ...this,
      status: 'ELIGIBLE',
      statement: {
        ...context,
        payoutRate: rate,
        usinaValue: base,
        retained,
        payout,
        eligibleAt: signed.at,
        signedBy: signed.author,
      },
    });
  }

  /** REQ-282: an eligible commission is only consulted. */
  private assertCalculated(): void {
    if (this.status !== 'CALCULATED') {
      throw new BusinessRuleViolation('REQ-282', COMMISSION_MESSAGES.PAYOUT_ELIGIBLE_IS_FINAL);
    }
  }
}
