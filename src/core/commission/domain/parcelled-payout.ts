import type { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from './errors.ts';

/**
 * REQ-268: the situations of a policy with parcelled CT. They are not the
 * three of REQ-285, which belong to the integral CT.
 */
export type ParcelledPayoutSituation =
  | 'WITHOUT_CR'
  | 'NONE_ELIGIBLE'
  | 'PARTIALLY_ELIGIBLE'
  | 'FULLY_ELIGIBLE';

/**
 * One installment of the policy as the payout sees it: its value, the CT
 * applied to it and the Usina value that follows (REQ-293), fixed on the
 * policy (REQ-245).
 */
export interface InstallmentBase {
  readonly number: number;
  /** The installment value: the base of both the CT and the CR (REQ-293, REQ-264). */
  readonly amount: Money;
  readonly workedCommission: Percentage;
  readonly usinaValue: Money;
}

/** REQ-264: the payout of one installment, as it was calculated. */
export interface InstallmentPayoutCalculation extends InstallmentBase {
  /** The CR applied: the first's on installment 1, the other on the rest (REQ-287). */
  readonly payoutRate: Percentage;
  /** Installment value x CR, rounded by ABNT NBR 5891 (REQ-264, REQ-298). */
  readonly payout: Money;
  /** What stays with the Usina: its value minus the payout (REQ-264). */
  readonly retained: Money;
}

/**
 * One information or change of the two CRs (REQ-265): who, when, the previous
 * and the new CRs, the reason on a change, and the calculation of every
 * installment as it was then — never recalculated.
 */
export interface ParcelledPayoutEntry {
  readonly firstRate: Percentage;
  readonly subsequentRate: Percentage;
  /** `null` on the first information. */
  readonly previousFirstRate: Percentage | null;
  readonly previousSubsequentRate: Percentage | null;
  /** Mandatory on a change, not asked on the first information. */
  readonly reason: string | null;
  readonly informed: Authorship;
  readonly calculations: readonly InstallmentPayoutCalculation[];
}

/** What the statement takes from the policy (REQ-266). Nothing of it is typed. */
export interface InstallmentEligibilityContext {
  readonly policyNumber: string;
  /** The broker's name as the proposal carries it (DEC-208). */
  readonly broker: string;
  readonly insurer: string;
  readonly client: string;
}

/** REQ-266: the statement of one eligible installment. */
export interface InstallmentStatement extends InstallmentEligibilityContext {
  readonly installmentNumber: number;
  readonly installmentAmount: Money;
  readonly workedCommission: Percentage;
  readonly payoutRate: Percentage;
  readonly retained: Money;
  readonly payout: Money;
  /** The eligibility date: the moment it was signed (REQ-288). */
  readonly eligibleAt: Date;
  readonly signedBy: string;
}

export interface ParcelledPayoutData {
  readonly id: string;
  readonly policyId: string;
  /** Oldest first; never empty. Nothing is erased (REQ-124). */
  readonly entries: readonly ParcelledPayoutEntry[];
  /** One per eligible installment, in the order they became eligible. */
  readonly statements: readonly InstallmentStatement[];
}

export interface ParcelledPayoutInformation {
  readonly id: string;
  readonly policyId: string;
  readonly installments: readonly InstallmentBase[];
  readonly firstRate: Percentage;
  readonly subsequentRate: Percentage;
  readonly informed: Authorship;
}

export interface ParcelledPayoutRevision {
  readonly firstRate: Percentage;
  readonly subsequentRate: Percentage;
  readonly reason: string;
  readonly informed: Authorship;
}

/**
 * REQ-263, REQ-264: each CR applied to the installment value, at most the CT
 * applied to the same installment — so the broker never gets more than the
 * Usina value of that installment. The Usina keeps the difference.
 */
function calculate(
  installments: readonly InstallmentBase[],
  firstRate: Percentage,
  subsequentRate: Percentage,
): InstallmentPayoutCalculation[] {
  return installments.map((installment) => {
    const first = installment.number === 1;
    const payoutRate = first ? firstRate : subsequentRate;

    if (payoutRate.isGreaterThan(installment.workedCommission)) {
      const params = { rate: payoutRate.toString(), ct: installment.workedCommission.toString() };

      if (first) {
        throw new BusinessRuleViolation(
          'REQ-263',
          COMMISSION_MESSAGES.PARCELLED_FIRST_RATE_ABOVE_CT,
          params,
        );
      }

      throw new BusinessRuleViolation(
        'REQ-263',
        COMMISSION_MESSAGES.PARCELLED_SUBSEQUENT_RATE_ABOVE_CT,
        params,
      );
    }

    const payout = installment.amount.applyRate(payoutRate);

    return { ...installment, payoutRate, payout, retained: installment.usinaValue.minus(payout) };
  });
}

/** REQ-268: the situation of a parcelled policy, from its payout (or the absence of one). */
export function parcelledSituationOf(
  commission: ParcelledPayoutCommission | null,
): ParcelledPayoutSituation {
  if (commission === null) {
    return 'WITHOUT_CR';
  }

  const eligible = commission.statements.length;

  if (eligible === 0) {
    return 'NONE_ELIGIBLE';
  }

  return eligible < commission.current.calculations.length
    ? 'PARTIALLY_ELIGIBLE'
    : 'FULLY_ELIGIBLE';
}

/**
 * The payout of a policy with parcelled CT (V2 section 9B): the two CRs, the
 * calculation of each installment and the eligibility of each installment.
 *
 * A flow parallel to `PayoutCommission`, which is the integral CT's and does
 * not change (REQ-290). The system pays nothing: each statement is what an
 * external system acts on (REQ-280).
 */
export class ParcelledPayoutCommission {
  readonly id: string;
  readonly policyId: string;
  readonly entries: readonly ParcelledPayoutEntry[];
  readonly statements: readonly InstallmentStatement[];

  private constructor(data: ParcelledPayoutData) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.entries = data.entries;
    this.statements = data.statements;
  }

  /** REQ-287: both CRs, informed together on the policy. */
  static inform(information: ParcelledPayoutInformation): ParcelledPayoutCommission {
    return new ParcelledPayoutCommission({
      id: information.id,
      policyId: information.policyId,
      entries: [
        {
          firstRate: information.firstRate,
          subsequentRate: information.subsequentRate,
          previousFirstRate: null,
          previousSubsequentRate: null,
          reason: null,
          informed: information.informed,
          calculations: calculate(
            information.installments,
            information.firstRate,
            information.subsequentRate,
          ),
        },
      ],
      statements: [],
    });
  }

  /** Rebuilds a persisted payout without re-applying the rules (REQ-124). */
  static restore(data: ParcelledPayoutData): ParcelledPayoutCommission {
    return new ParcelledPayoutCommission(data);
  }

  /** The entry in force: the last CRs informed. */
  get current(): ParcelledPayoutEntry {
    const last = this.entries[this.entries.length - 1];

    if (last === undefined) {
      throw new Error('A parcelled payout always has at least one CR entry.');
    }

    return last;
  }

  statementOf(number: number): InstallmentStatement | null {
    return this.statements.find((statement) => statement.installmentNumber === number) ?? null;
  }

  /**
   * REQ-265, FA-223: both CRs changed together, with a reason, while no
   * installment is eligible. From the first eligible one on they freeze, for
   * every installment (REQ-289).
   */
  revise(revision: ParcelledPayoutRevision): ParcelledPayoutCommission {
    if (this.statements.length > 0) {
      throw new BusinessRuleViolation('REQ-289', COMMISSION_MESSAGES.PARCELLED_RATES_FROZEN);
    }

    const reason = revision.reason.trim();

    if (reason === '') {
      throw new BusinessRuleViolation(
        'REQ-265',
        COMMISSION_MESSAGES.PAYOUT_REVISION_REASON_REQUIRED,
      );
    }

    const current = this.current;

    return new ParcelledPayoutCommission({
      ...this,
      entries: [
        ...this.entries,
        {
          firstRate: revision.firstRate,
          subsequentRate: revision.subsequentRate,
          previousFirstRate: current.firstRate,
          previousSubsequentRate: current.subsequentRate,
          reason,
          informed: revision.informed,
          calculations: calculate(
            current.calculations,
            revision.firstRate,
            revision.subsequentRate,
          ),
        },
      ],
    });
  }

  /**
   * REQ-288, REQ-266: a user, having verified that the Usina received the
   * installment, signs its eligibility — in any order, once. The statement
   * comes from the policy, the calculation in force and the signature.
   */
  declareEligible(
    number: number,
    context: InstallmentEligibilityContext,
    signed: Authorship,
  ): ParcelledPayoutCommission {
    const calculation = this.current.calculations.find(
      (installment) => installment.number === number,
    );

    if (calculation === undefined) {
      throw new BusinessRuleViolation('REQ-288', COMMISSION_MESSAGES.INSTALLMENT_NOT_IN_POLICY, {
        number: String(number),
      });
    }

    if (this.statementOf(number) !== null) {
      throw new BusinessRuleViolation('REQ-288', COMMISSION_MESSAGES.INSTALLMENT_ALREADY_ELIGIBLE, {
        number: String(number),
      });
    }

    return new ParcelledPayoutCommission({
      ...this,
      statements: [
        ...this.statements,
        {
          ...context,
          installmentNumber: number,
          installmentAmount: calculation.amount,
          workedCommission: calculation.workedCommission,
          payoutRate: calculation.payoutRate,
          retained: calculation.retained,
          payout: calculation.payout,
          eligibleAt: signed.at,
          signedBy: signed.author,
        },
      ],
    });
  }
}
