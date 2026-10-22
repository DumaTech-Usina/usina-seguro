import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import {
  type Page,
  type PageSize,
  mapPage,
  pageRequestOf,
} from '../../proposal/application/page.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import type { PayoutCommissionRepository } from './payout-commission-repository.ts';
import { type EligiblePayoutView, toStatementView } from './payout-commission-view.ts';
import type { EligiblePayoutFilter, PayoutListing } from './payout-listing.ts';

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
  /** REQ-330 to REQ-332: the page, from 1, and its size; the first of 50 when absent. */
  readonly page?: number;
  readonly size?: PageSize;
}

export interface ListEligiblePayoutsDependencies {
  readonly listing: PayoutListing;
  readonly policies: PolicyRepository;
  readonly payouts: PayoutCommissionRepository;
}

/**
 * REQ-284: a value matches a filter by part, ignoring case; a blank filter
 * matches everything. Exported so a driver that filters in its own query
 * answers exactly the same.
 */
export function containsIgnoringCase(value: string, part: string | undefined): boolean {
  const wanted = part?.trim().toLowerCase() ?? '';
  return wanted === '' || value.toLowerCase().includes(wanted);
}

/**
 * REQ-284, CA-234, CA-235: the eligible commissions, read-only, most recent
 * eligibility first, each one leading to its policy. One page at a time
 * (REQ-330); the filters apply to all of them (REQ-333).
 */
export class ListEligiblePayouts {
  private readonly deps: ListEligiblePayoutsDependencies;

  constructor(deps: ListEligiblePayoutsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListEligiblePayoutsInput): Promise<Page<EligiblePayoutView>> {
    const ids = await this.deps.listing.eligiblePayouts(filterOf(input), pageRequestOf(input));

    const lines = await Promise.all(
      ids.items.map(async (policyId): Promise<EligiblePayoutView> => {
        const policy = await this.deps.policies.findById(policyId);
        if (policy === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: policyId });
        }

        const statement = (await this.deps.payouts.findByPolicyId(policyId))?.statement ?? null;
        if (statement === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: policyId });
        }

        return {
          ...toStatementView(statement),
          policyId: policy.id,
          renewalDate: policy.renewalDate.toString(),
        };
      }),
    );

    return mapPage(ids, lines);
  }
}

function filterOf(input: ListEligiblePayoutsInput): EligiblePayoutFilter {
  const text = (value: string | undefined) => (value?.trim() ? value : undefined);
  const instant = (value: string | undefined) =>
    value === undefined ? undefined : new Date(value);
  const entries = {
    policyNumber: text(input.policyNumber),
    broker: text(input.broker),
    client: text(input.client),
    eligibleFrom: instant(input.eligibleFrom),
    eligibleBefore: instant(input.eligibleBefore),
    renewalFrom: input.renewalFrom,
    renewalUntil: input.renewalUntil,
  };
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as EligiblePayoutFilter;
}
