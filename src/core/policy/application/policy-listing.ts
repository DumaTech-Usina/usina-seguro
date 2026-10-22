import type { Page, PageRequest } from '../../proposal/application/page.ts';
import type { CalendarDate } from '../../proposal/domain/calendar-date.ts';

export interface PolicyListingFilter {
  /** OUT-04, CA-032: only the policies that renew on or before this day. */
  readonly renewalUntil?: CalendarDate;
  /**
   * REQ-319: a term matched against the name or CPF of the client of the
   * policy's proposal (REQ-241), by the rule of REQ-316.
   */
  readonly client?: string;
}

/**
 * REQ-330, REQ-333: one page of the policies, nearest renewal first, filtered
 * and counted over all of them. Answers ids: the policies themselves are read
 * through `PolicyRepository`.
 *
 * A port of its own because the client filter reaches the proposal and the
 * client registry: the driver answers it in one query instead of loading
 * every policy.
 */
export interface PolicyListing {
  policies(filter: PolicyListingFilter, page: PageRequest): Promise<Page<string>>;
}
