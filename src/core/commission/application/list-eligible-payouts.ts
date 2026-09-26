import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import type { EligibilityStatement } from '../domain/payout-commission.ts';
import type { PayoutCommissionRepository } from './payout-commission-repository.ts';
import { type EligiblePayoutView, toStatementView } from './payout-commission-view.ts';

/**
 * REQ-284: the filters of the eligible commissions. Absent means "any".
 *
 * Policy number, broker and client match by part, ignoring case. The
 * eligibility period is a pair of instants — `eligibleFrom` included,
 * `eligibleBefore` excluded — so the days of the confirmed inclusive interval
 * are turned into instants by whoever knows the reader's time zone. The
 * renewal period is month/year (`YYYY-MM`), both ends included.
 */
export interface ListEligiblePayoutsInput {
  readonly policyNumber?: string;
  readonly broker?: string;
  readonly client?: string;
  readonly eligibleFrom?: string;
  readonly eligibleBefore?: string;
  readonly renewalFrom?: string;
  readonly renewalUntil?: string;
}

export interface ListEligiblePayoutsDependencies {
  readonly policies: PolicyRepository;
  readonly payouts: PayoutCommissionRepository;
}

function containsIgnoringCase(value: string, part: string | undefined): boolean {
  const wanted = part?.trim().toLowerCase() ?? '';
  return wanted === '' || value.toLowerCase().includes(wanted);
}

function withinInstants(at: Date, from?: string, before?: string): boolean {
  return (
    (from === undefined || at.getTime() >= new Date(from).getTime()) &&
    (before === undefined || at.getTime() < new Date(before).getTime())
  );
}

function withinMonths(date: string, from?: string, until?: string): boolean {
  const month = date.slice(0, 7);
  return (from === undefined || month >= from) && (until === undefined || month <= until);
}

function matchesStatement(
  statement: EligibilityStatement,
  input: ListEligiblePayoutsInput,
): boolean {
  return (
    containsIgnoringCase(statement.policyNumber, input.policyNumber) &&
    containsIgnoringCase(statement.broker, input.broker) &&
    containsIgnoringCase(statement.client, input.client) &&
    withinInstants(statement.eligibleAt, input.eligibleFrom, input.eligibleBefore)
  );
}

/**
 * REQ-284, CA-234, CA-235: the eligible commissions, read-only, most recent
 * eligibility first, each one leading to its policy.
 */
export class ListEligiblePayouts {
  private readonly deps: ListEligiblePayoutsDependencies;

  constructor(deps: ListEligiblePayoutsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListEligiblePayoutsInput): Promise<readonly EligiblePayoutView[]> {
    const eligible = (await this.deps.payouts.list())
      .flatMap((payout) =>
        payout.statement === null ? [] : [{ payout, statement: payout.statement }],
      )
      .filter(({ statement }) => matchesStatement(statement, input))
      .sort((a, b) => b.statement.eligibleAt.getTime() - a.statement.eligibleAt.getTime());

    const lines: EligiblePayoutView[] = [];

    for (const { payout, statement } of eligible) {
      const policy = await this.deps.policies.findById(payout.policyId);

      if (policy === null) {
        throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: payout.policyId });
      }

      const renewalDate = policy.renewalDate.toString();

      if (withinMonths(renewalDate, input.renewalFrom, input.renewalUntil)) {
        lines.push({ ...toStatementView(statement), policyId: policy.id, renewalDate });
      }
    }

    return lines;
  }
}
