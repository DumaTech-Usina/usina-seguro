import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { payoutBase } from '../domain/payout-commission.ts';
import type { PayoutCommissionRepository } from './payout-commission-repository.ts';
import {
  type PolicyWithoutPayoutRateView,
  toPolicyWithoutPayoutRateView,
} from './payout-commission-view.ts';

export interface ListPoliciesWithoutPayoutRateDependencies {
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  readonly payouts: PayoutCommissionRepository;
}

/**
 * REQ-286, CA-238, CA-240: the policies that still need a CR — only those that
 * can receive one today, so a policy with parcelled CT never appears
 * (REQ-271, DEC-210). In the order of the policy listing: nearest renewal
 * first.
 */
export class ListPoliciesWithoutPayoutRate {
  private readonly deps: ListPoliciesWithoutPayoutRateDependencies;

  constructor(deps: ListPoliciesWithoutPayoutRateDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly PolicyWithoutPayoutRateView[]> {
    const policies = await this.deps.policies.list({});
    const informed = new Set((await this.deps.payouts.list()).map((payout) => payout.policyId));
    const lines: PolicyWithoutPayoutRateView[] = [];

    for (const policy of policies) {
      if (informed.has(policy.id)) {
        continue;
      }

      const proposal = await this.deps.proposals.findById(policy.proposalId);

      if (proposal === null) {
        throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
      }

      if (proposal.workedCommissionMode !== 'INTEGRAL') {
        continue;
      }

      lines.push(
        toPolicyWithoutPayoutRateView(
          policy,
          proposal,
          payoutBase(proposal.expectedReceipt()).toString(),
        ),
      );
    }

    return lines;
  }
}
