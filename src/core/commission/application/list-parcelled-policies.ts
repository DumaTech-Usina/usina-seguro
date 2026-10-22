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
import { parcelledSituationOf } from '../domain/parcelled-payout.ts';
import type { ParcelledPayoutRepository } from './parcelled-payout-repository.ts';
import type { ParcelledPolicyLineView } from './parcelled-payout-view.ts';
import type { PayoutListing } from './payout-listing.ts';

export interface ListParcelledPoliciesInput {
  /** REQ-330 to REQ-332: the page, from 1, and its size; the first of 50 when absent. */
  readonly page?: number;
  readonly size?: PageSize;
}

export interface ListParcelledPoliciesDependencies {
  readonly listing: PayoutListing;
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  readonly parcelledPayouts: ParcelledPayoutRepository;
  /** REQ-318: each line shows the client's current name. */
  readonly clients: ClientRepository;
}

/**
 * REQ-268: every policy with parcelled CT, each with its situation — its own
 * list, apart from the policies without CR of REQ-286, which keeps only the
 * integral ones. In the order of the policy listing: nearest renewal first.
 * One page at a time (REQ-330).
 */
export class ListParcelledPolicies {
  private readonly deps: ListParcelledPoliciesDependencies;

  constructor(deps: ListParcelledPoliciesDependencies) {
    this.deps = deps;
  }

  async execute(input: ListParcelledPoliciesInput = {}): Promise<Page<ParcelledPolicyLineView>> {
    const ids = await this.deps.listing.parcelledPolicies(pageRequestOf(input));

    const lines = await Promise.all(
      ids.items.map(async (id): Promise<ParcelledPolicyLineView> => {
        const policy = await this.deps.policies.findById(id);
        if (policy === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id });
        }

        const proposal = await this.deps.proposals.findById(policy.proposalId);
        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
        }

        return {
          policyId: policy.id,
          policyNumber: policy.policyNumber,
          client: await clientNameOf(this.deps.clients, proposal.clientId),
          broker: proposal.brokerId,
          renewalDate: policy.renewalDate.toString(),
          situation: parcelledSituationOf(
            await this.deps.parcelledPayouts.findByPolicyId(policy.id),
          ),
        };
      }),
    );

    return mapPage(ids, lines);
  }
}
