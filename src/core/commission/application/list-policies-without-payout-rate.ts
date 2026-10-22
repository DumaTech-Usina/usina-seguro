import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import {
  type Page,
  type PageSize,
  mapPage,
  pageRequestOf,
} from '../../proposal/application/page.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
import { payoutBase } from '../domain/payout-commission.ts';
import {
  type PolicyWithoutPayoutRateView,
  toPolicyWithoutPayoutRateView,
} from './payout-commission-view.ts';
import type { PayoutListing } from './payout-listing.ts';

export interface ListPoliciesWithoutPayoutRateInput {
  /** REQ-330 to REQ-332: the page, from 1, and its size; the first of 50 when absent. */
  readonly page?: number;
  readonly size?: PageSize;
}

export interface ListPoliciesWithoutPayoutRateDependencies {
  readonly listing: PayoutListing;
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  /** REQ-318: each line shows the client's current name. */
  readonly clients: ClientRepository;
}

/**
 * REQ-286, CA-238, CA-240: the policies that still need a CR — only those that
 * can receive one today, so a policy with parcelled CT never appears
 * (REQ-271, DEC-210). In the order of the policy listing: nearest renewal
 * first. One page at a time (REQ-330).
 */
export class ListPoliciesWithoutPayoutRate {
  private readonly deps: ListPoliciesWithoutPayoutRateDependencies;

  constructor(deps: ListPoliciesWithoutPayoutRateDependencies) {
    this.deps = deps;
  }

  async execute(
    input: ListPoliciesWithoutPayoutRateInput = {},
  ): Promise<Page<PolicyWithoutPayoutRateView>> {
    const ids = await this.deps.listing.policiesWithoutPayoutRate(pageRequestOf(input));

    const lines = await Promise.all(
      ids.items.map(async (id) => {
        const policy = await this.deps.policies.findById(id);
        if (policy === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id });
        }

        const proposal = await this.deps.proposals.findById(policy.proposalId);
        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
        }

        return toPolicyWithoutPayoutRateView(
          policy,
          proposal,
          payoutBase(proposal.expectedReceipt()).toString(),
          await clientNameOf(this.deps.clients, proposal.clientId),
        );
      }),
    );

    return mapPage(ids, lines);
  }
}
