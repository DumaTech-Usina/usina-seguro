import {
  type Page,
  type PageSize,
  mapPage,
  pageRequestOf,
} from '../../proposal/application/page.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
import { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { ReferenceRepository } from '../../registry/application/reference-repository.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import type { PolicyListing, PolicyListingFilter } from './policy-listing.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyListItemView, toPolicyListItemView } from './policy-view.ts';

export interface ListPoliciesInput {
  /**
   * OUT-04, CA-032: when present, only the policies that renew on or before
   * this calendar day, which is what "a vencer" means once someone says until
   * when.
   *
   * REQ-055 requires the listing; no requirement fixes the window, so the day
   * is informed rather than assumed. A malformed one is refused by
   * `CalendarDate` (REQ-020) instead of being read as "no filter", which would
   * answer the whole listing to a question that was never understood.
   */
  readonly renewalUntil?: string;
  /**
   * REQ-319: part of the client's name or digits of its CPF. Absent or blank
   * means no filter. Matched through the client registry, so a policy whose
   * proposal holds a typed text from before it is not found (REQ-320).
   */
  readonly client?: string | undefined;
  /** REQ-330 to REQ-332: the page, from 1, and its size; the first of 50 when absent. */
  readonly page?: number;
  readonly size?: PageSize;
}

export interface ListPoliciesDependencies {
  readonly policies: PolicyRepository;
  readonly listing: PolicyListing;
  readonly proposals: ProposalRepository;
  /** IN-01: the names the line is identified by (REQ-096). */
  readonly references: ReferenceRepository;
  /** V2 section 9E: the client's name (REQ-318). */
  readonly clients: ClientRepository;
}

/**
 * OUT-03 and OUT-04: the policies the Usina sold, with coverage, state and
 * renewal date, nearest renewal first — one page at a time (REQ-330).
 *
 * `GetPolicy` answers one policy with its schedule; this is the entry point
 * that makes a policy findable at all.
 *
 * The listing port answers which policies are on the page; each line is then
 * completed with the proposal it came from, because the policy holds its id
 * and nothing a human recognises (REQ-050, REQ-022).
 */
export class ListPolicies {
  private readonly deps: ListPoliciesDependencies;

  constructor(deps: ListPoliciesDependencies) {
    this.deps = deps;
  }

  async execute(input: ListPoliciesInput = {}): Promise<Page<PolicyListItemView>> {
    const client = input.client?.trim() ?? '';
    const filter: PolicyListingFilter = {
      ...(input.renewalUntil === undefined
        ? {}
        : { renewalUntil: CalendarDate.fromString(input.renewalUntil) }),
      ...(client === '' ? {} : { client }),
    };

    const ids = await this.deps.listing.policies(filter, pageRequestOf(input));
    // Read once for the whole page, not once per line: the registry is the
    // counterparties of the brokerage, not a table that grows with volume.
    const names = await ReferenceNames.load(this.deps.references);

    const lines = await Promise.all(
      ids.items.map(async (id) => {
        const policy = await this.deps.policies.findById(id);
        if (policy === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id });
        }

        const proposal = await this.deps.proposals.findById(policy.proposalId);

        // REQ-048, REQ-050: a policy without its proposal is not a line to
        // hide from the listing, it is a broken record, and the reading says so.
        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
        }

        return toPolicyListItemView(
          policy,
          proposal,
          names,
          await clientNameOf(this.deps.clients, proposal.clientId),
        );
      }),
    );

    return mapPage(ids, lines);
  }
}
