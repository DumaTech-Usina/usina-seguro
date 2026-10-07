import type { Policy } from '../../policy/domain/policy.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
import {
  type InstallmentPayoutCalculation,
  type InstallmentStatement,
  type ParcelledPayoutCommission,
  type ParcelledPayoutSituation,
  parcelledSituationOf,
} from '../domain/parcelled-payout.ts';

/** REQ-266 at the core boundary: amounts and rates as decimal strings. */
export interface InstallmentStatementView {
  readonly policyNumber: string;
  readonly broker: string;
  readonly insurer: string;
  readonly client: string;
  readonly installmentNumber: number;
  readonly installmentAmount: string;
  readonly workedCommission: string;
  readonly payoutRate: string;
  readonly retained: string;
  readonly payout: string;
  readonly eligibleAt: string;
  readonly signedBy: string;
}

/** One installment of the policy: its expected value and, with CRs, its payout. */
export interface ParcelledInstallmentView {
  readonly number: number;
  readonly amount: string;
  readonly dueDate: string | null;
  readonly workedCommission: string;
  readonly usinaValue: string;
  /** `null` while the policy has no CR (REQ-268). */
  readonly payoutRate: string | null;
  readonly payout: string | null;
  readonly retained: string | null;
  /** REQ-266: present exactly when the installment is eligible. */
  readonly statement: InstallmentStatementView | null;
}

export interface InstallmentCalculationView {
  readonly number: number;
  readonly amount: string;
  readonly workedCommission: string;
  readonly usinaValue: string;
  readonly payoutRate: string;
  readonly payout: string;
  readonly retained: string;
}

/** REQ-265: one information or change of the two CRs. */
export interface ParcelledPayoutEntryView {
  readonly firstRate: string;
  readonly subsequentRate: string;
  readonly previousFirstRate: string | null;
  readonly previousSubsequentRate: string | null;
  readonly reason: string | null;
  readonly informedBy: string;
  readonly informedAt: string;
  readonly calculations: readonly InstallmentCalculationView[];
}

/** A policy with parcelled CT seen from its payout (V2 section 9B). */
export interface ParcelledPolicyPayoutView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly situation: ParcelledPayoutSituation;
  readonly firstWorkedCommission: string;
  readonly subsequentWorkedCommission: string;
  readonly firstRate: string | null;
  readonly subsequentRate: string | null;
  readonly installments: readonly ParcelledInstallmentView[];
  readonly entries: readonly ParcelledPayoutEntryView[];
}

/** REQ-268: one line of the list of parcelled policies. */
export interface ParcelledPolicyLineView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly client: string;
  readonly broker: string;
  readonly renewalDate: string;
  readonly situation: ParcelledPayoutSituation;
}

export function toInstallmentStatementView(
  statement: InstallmentStatement,
): InstallmentStatementView {
  return {
    policyNumber: statement.policyNumber,
    broker: statement.broker,
    insurer: statement.insurer,
    client: statement.client,
    installmentNumber: statement.installmentNumber,
    installmentAmount: statement.installmentAmount.toString(),
    workedCommission: statement.workedCommission.toString(),
    payoutRate: statement.payoutRate.toString(),
    retained: statement.retained.toString(),
    payout: statement.payout.toString(),
    eligibleAt: statement.eligibleAt.toISOString(),
    signedBy: statement.signedBy,
  };
}

function toCalculationView(calculation: InstallmentPayoutCalculation): InstallmentCalculationView {
  return {
    number: calculation.number,
    amount: calculation.amount.toString(),
    workedCommission: calculation.workedCommission.toString(),
    usinaValue: calculation.usinaValue.toString(),
    payoutRate: calculation.payoutRate.toString(),
    payout: calculation.payout.toString(),
    retained: calculation.retained.toString(),
  };
}

/**
 * The installments come from the proposal the policy inherited, frozen since
 * the issuance (REQ-244, REQ-245); the due dates from the policy's schedule.
 */
export function toParcelledPolicyPayoutView(
  policy: Policy,
  proposal: Proposal,
  commission: ParcelledPayoutCommission | null,
): ParcelledPolicyPayoutView {
  const expected = proposal.expectedInstallmentReceipts() ?? [];
  const current = commission?.current ?? null;

  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    situation: parcelledSituationOf(commission),
    firstWorkedCommission: proposal.workedCommission.toString(),
    subsequentWorkedCommission: proposal.subsequentWorkedCommission?.toString() ?? '',
    firstRate: current?.firstRate.toString() ?? null,
    subsequentRate: current?.subsequentRate.toString() ?? null,
    installments: expected.map((installment) => {
      const calculation =
        current?.calculations.find((item) => item.number === installment.number) ?? null;
      const statement = commission?.statementOf(installment.number) ?? null;
      const scheduled = policy.installments.find((item) => item.number === installment.number);

      return {
        number: installment.number,
        amount: installment.amount.toString(),
        dueDate: scheduled?.dueDate?.toString() ?? null,
        workedCommission: installment.workedCommission.toString(),
        usinaValue: installment.usina.toString(),
        payoutRate: calculation?.payoutRate.toString() ?? null,
        payout: calculation?.payout.toString() ?? null,
        retained: calculation?.retained.toString() ?? null,
        statement: statement === null ? null : toInstallmentStatementView(statement),
      };
    }),
    entries: (commission?.entries ?? []).map((entry) => ({
      firstRate: entry.firstRate.toString(),
      subsequentRate: entry.subsequentRate.toString(),
      previousFirstRate: entry.previousFirstRate?.toString() ?? null,
      previousSubsequentRate: entry.previousSubsequentRate?.toString() ?? null,
      reason: entry.reason,
      informedBy: entry.informed.author,
      informedAt: entry.informed.at.toISOString(),
      calculations: entry.calculations.map(toCalculationView),
    })),
  };
}
