import type { Page, PageRequest } from '../../proposal/application/page.ts';

/**
 * REQ-284: the filters of the eligible commissions, already in the form a
 * query compares. Policy number, broker and client match by part, ignoring
 * case (`containsIgnoringCase`); `eligibleFrom` is included and
 * `eligibleBefore` excluded; the renewal months (`YYYY-MM`) are both included.
 */
export interface EligiblePayoutFilter {
  readonly policyNumber?: string;
  readonly broker?: string;
  readonly client?: string;
  readonly eligibleFrom?: Date;
  readonly eligibleBefore?: Date;
  readonly renewalFrom?: string;
  readonly renewalUntil?: string;
}

/**
 * REQ-330, REQ-333: one page of each listing of the payout, filtered and
 * counted over all the policies. Each answers policy ids; the lines are then
 * read through the repositories.
 *
 * A port of its own because what puts a policy in each listing lives in three
 * places — the policy, its proposal's CT and its payout — and the driver
 * answers it in one query instead of loading every policy.
 */
export interface PayoutListing {
  /** REQ-286: policies with CT integral and no CR yet, nearest renewal first. */
  policiesWithoutPayoutRate(page: PageRequest): Promise<Page<string>>;
  /** REQ-268: every policy with CT parcelled, nearest renewal first. */
  parcelledPolicies(page: PageRequest): Promise<Page<string>>;
  /** REQ-284: the policies of the eligible commissions, most recent eligibility first. */
  eligiblePayouts(filter: EligiblePayoutFilter, page: PageRequest): Promise<Page<string>>;
}
