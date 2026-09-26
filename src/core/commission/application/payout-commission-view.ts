import type { Policy } from '../../policy/domain/policy.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
import type { WorkedCommissionMode } from '../../proposal/domain/worked-commission.ts';
import type {
  EligibilityStatement,
  PayoutCommission,
  PayoutSituation,
} from '../domain/payout-commission.ts';

/** REQ-283 at the core boundary: amounts and rates as decimal strings. */
export interface EligibilityStatementView {
  readonly policyNumber: string;
  readonly broker: string;
  readonly client: string;
  readonly netPremium: string;
  readonly workedCommission: string;
  readonly payoutRate: string;
  readonly ctu: string | null;
  readonly usinaValue: string;
  readonly eligibleAt: string;
  readonly retained: string;
  readonly payout: string;
  readonly signedBy: string;
}

/** One CR entry as REQ-279 audits it. */
export interface PayoutRateEntryView {
  readonly rate: string;
  readonly previousRate: string | null;
  readonly reason: string | null;
  readonly base: string;
  readonly payout: string;
  readonly retained: string;
  readonly informedBy: string;
  readonly informedAt: string;
}

/** REQ-278: the Usina value, the payout and what stays, always explicit. */
export interface PayoutCommissionView {
  readonly id: string;
  readonly policyId: string;
  readonly status: string;
  readonly rate: string;
  readonly base: string;
  readonly payout: string;
  readonly retained: string;
  readonly entries: readonly PayoutRateEntryView[];
  readonly statement: EligibilityStatementView | null;
}

/**
 * A policy seen from FP-02: its situation (REQ-285), the Usina value the CR
 * applies to (REQ-274) and its payout commission, when there is one.
 *
 * `situation` is `null` for a policy with parcelled CT, which is outside the
 * three situations while DEC-210 is open (REQ-271); so is `usinaValue`,
 * because no CR is applied to it.
 */
export interface PolicyPayoutView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly workedCommissionMode: WorkedCommissionMode;
  readonly situation: PayoutSituation | null;
  readonly usinaValue: string | null;
  readonly commission: PayoutCommissionView | null;
}

export function toStatementView(statement: EligibilityStatement): EligibilityStatementView {
  return {
    policyNumber: statement.policyNumber,
    broker: statement.broker,
    client: statement.client,
    netPremium: statement.netPremium.toString(),
    workedCommission: statement.workedCommission.toString(),
    payoutRate: statement.payoutRate.toString(),
    ctu: statement.ctu?.toString() ?? null,
    usinaValue: statement.usinaValue.toString(),
    eligibleAt: statement.eligibleAt.toISOString(),
    retained: statement.retained.toString(),
    payout: statement.payout.toString(),
    signedBy: statement.signedBy,
  };
}

export function toPayoutCommissionView(commission: PayoutCommission): PayoutCommissionView {
  const current = commission.current;

  return {
    id: commission.id,
    policyId: commission.policyId,
    status: commission.status,
    rate: current.rate.toString(),
    base: current.base.toString(),
    payout: current.payout.toString(),
    retained: current.retained.toString(),
    entries: commission.entries.map((entry) => ({
      rate: entry.calculation.rate.toString(),
      previousRate: entry.previousRate?.toString() ?? null,
      reason: entry.reason,
      base: entry.calculation.base.toString(),
      payout: entry.calculation.payout.toString(),
      retained: entry.calculation.retained.toString(),
      informedBy: entry.informed.author,
      informedAt: entry.informed.at.toISOString(),
    })),
    statement: commission.statement === null ? null : toStatementView(commission.statement),
  };
}

/**
 * One line of the eligible commissions (REQ-284): the statement, the policy it
 * leads to (CA-235) and the renewal date the listing is filtered by.
 */
export interface EligiblePayoutView extends EligibilityStatementView {
  readonly policyId: string;
  readonly renewalDate: string;
}

/** One line of the policies still waiting for a CR (REQ-286). */
export interface PolicyWithoutPayoutRateView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly client: string;
  readonly broker: string;
  readonly usinaValue: string;
  readonly renewalDate: string;
}

export function toPolicyWithoutPayoutRateView(
  policy: Policy,
  proposal: Proposal,
  usinaValue: string,
): PolicyWithoutPayoutRateView {
  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    client: proposal.clientId,
    broker: proposal.brokerId,
    usinaValue,
    renewalDate: policy.renewalDate.toString(),
  };
}
