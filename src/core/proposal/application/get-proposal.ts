import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';

export interface GetProposalDependencies {
  readonly proposals: ProposalRepository;
}

/**
 * Reads one proposal, with what the Usina expects to receive (REQ-232). A
 * refused proposal stays consultable (REQ-253).
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
