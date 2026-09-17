import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';

export interface GetPolicyDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
}

/**
 * Reads a registered policy with its installments and both numbers (CA-008,
 * OUT-03).
 *
 * It loads the originating proposal because the proposal number lives there
 * (REQ-050); the two records are linked, not duplicated.
 */
export class GetPolicy {
  private readonly deps: GetPolicyDependencies;

  constructor(deps: GetPolicyDependencies) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<PolicyView> {
    const policy = await this.deps.policies.findById(policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: policyId });
    }

    const proposal = await this.deps.proposals.findById(policy.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
    }

    return toPolicyView(policy, proposal);
  }
}
