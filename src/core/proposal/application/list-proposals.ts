import type { ProposalStatus } from '../domain/proposal.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';

export interface ListProposalsInput {
  /** When present, only proposals in that state (REQ-250) are listed. */
  readonly status?: ProposalStatus;
}

export interface ListProposalsDependencies {
  readonly proposals: ProposalRepository;
}

/** The proposals an operator follows while they await issuance (FP-01 step 6). */
export class ListProposals {
  private readonly deps: ListProposalsDependencies;

  constructor(deps: ListProposalsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListProposalsInput = {}): Promise<readonly ProposalView[]> {
    const proposals = await this.deps.proposals.list(input);

    return proposals.map(toProposalView);
  }
}
