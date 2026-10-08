import type { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import type { Policy } from '../domain/policy.ts';

/**
 * What narrows a listing. Absent means "every policy".
 *
 * There is no filter by state. Section 10.3 documents four, but only `ACTIVE`
 * is reachable — cancellation, renewal and expiry are operations that do not
 * exist yet — so a state filter would be a parameter with one possible answer.
 * The state travels on the line, as OUT-03 asks, and the filter comes back
 * when an operation can produce a second one.
 */
export interface PolicyListFilter {
  /**
   * REQ-055, OUT-04, CA-032: only policies whose renewal date falls on or
   * before this calendar day.
   *
   * The day is informed by whoever asks. No requirement says how near
   * "proxima" is, so the window is the caller's, not a number decided here.
   */
  readonly renewalUntil?: CalendarDate;
}

/**
 * Persistence contract for policies, declared by the side that needs it.
 *
 * The policy is stored with its installments: REQ-020 makes them part of the
 * policy and nothing writes an installment on its own, so there is no separate
 * installment repository.
 */
export interface PolicyRepository {
  save(policy: Policy): Promise<void>;
  findById(id: string): Promise<Policy | null>;
  /**
   * REQ-082, CA-019: when the report brings only the proposal number, the
   * policy is resolved through the link the proposal originated (REQ-050).
   */
  findByProposalId(proposalId: string): Promise<Policy | null>;
  /**
   * OUT-03, OUT-04: the policies the Usina sold, nearest renewal first.
   *
   * The order is part of the contract and not an accident of the driver:
   * REQ-055 makes the renewal date the axis this listing is controlled on, so
   * the policy that renews first leads whether or not a cut-off was informed.
   * Both implementations are tested against it.
   */
  list(filter: PolicyListFilter): Promise<readonly Policy[]>;
}
