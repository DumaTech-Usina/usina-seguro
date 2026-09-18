import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';

export interface GetProposalDependencies {
  readonly proposals: ProposalRepository;
}

/**
 * Reads one proposal (FP-01 step 5).
 *
 * REQ-043 makes a transmitted proposal trackable, and REQ-045/REQ-046 keep a
 * refused one consultable after the commercial cycle ended. Both read through
 * here.
 */
export class GetProposal {
  private readonly deps: GetProposalDependencies;

  constructor(deps: GetProposalDependencies) {
    this.deps = deps;
  }

  async execute(proposalId: string): Promise<ProposalView> {
    const proposal = await this.deps.proposals.findById(proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: proposalId });
    }

    return toProposalView(proposal);
  }
}
