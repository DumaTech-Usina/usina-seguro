import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';

export interface GetPolicyByProposalDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
}

/**
 * The policy a proposal originated (REQ-050), read from the proposal side.
 *
 * FP-01 step 6 ends on a policy, and whoever is tracking the proposal
 * (REQ-043) needs to reach it without knowing its id. REQ-049 makes the answer
 * at most one record, so this is a read of one and not a listing.
 *
 * A proposal with no policy is a `RecordNotFound`: nothing was broken, the
 * record simply does not exist yet.
 */
export class GetPolicyByProposal {
  private readonly deps: GetPolicyByProposalDependencies;

  constructor(deps: GetPolicyByProposalDependencies) {
    this.deps = deps;
  }

  async execute(proposalId: string): Promise<PolicyView> {
    const proposal = await this.deps.proposals.findById(proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: proposalId });
    }

    const policy = await this.deps.policies.findByProposalId(proposalId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND_FOR_PROPOSAL, { proposalId });
    }

    return toPolicyView(policy, proposal);
  }
}
