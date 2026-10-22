import type { ProposalStatus } from '../domain/proposal.ts';
import type { Page, PageRequest } from './page.ts';

export interface ProposalListingFilter {
  /** Only proposals in that state (REQ-250). */
  readonly status?: ProposalStatus;
  /**
   * REQ-319: a term matched against the registered client's name or CPF, by
   * the rule of REQ-316. A proposal holding a typed text from before the
   * registry is never found by it (REQ-320).
   */
  readonly client?: string;
}

/**
 * REQ-330, REQ-333: one page of the proposals, most recent registration
 * first, filtered and counted over all of them. Answers ids: the proposals
 * themselves are read through `ProposalRepository`.
 *
 * A port of its own because the client filter reaches the client registry:
 * the driver answers it in one query instead of loading every proposal.
 */
export interface ProposalListing {
  proposals(filter: ProposalListingFilter, page: PageRequest): Promise<Page<string>>;
}
