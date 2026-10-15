import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
import { parcelledSituationOf } from '../domain/parcelled-payout.ts';
import type { ParcelledPayoutRepository } from './parcelled-payout-repository.ts';
import type { ParcelledPolicyLineView } from './parcelled-payout-view.ts';

export interface ListParcelledPoliciesDependencies {
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
 */
export class ListParcelledPolicies {
  private readonly deps: ListParcelledPoliciesDependencies;

  constructor(deps: ListParcelledPoliciesDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly ParcelledPolicyLineView[]> {
    const payouts = new Map(
      (await this.deps.parcelledPayouts.list()).map((payout) => [payout.policyId, payout]),
    );
    const lines: ParcelledPolicyLineView[] = [];

    for (const policy of await this.deps.policies.list({})) {
      const proposal = await this.deps.proposals.findById(policy.proposalId);

      if (proposal === null) {
        throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
      }

      if (proposal.workedCommissionMode !== 'PARCELLED') {
        continue;
      }

      lines.push({
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        client: await clientNameOf(this.deps.clients, proposal.clientId),
        broker: proposal.brokerId,
        renewalDate: policy.renewalDate.toString(),
        situation: parcelledSituationOf(payouts.get(policy.id) ?? null),
      });
    }

    return lines;
  }
}
