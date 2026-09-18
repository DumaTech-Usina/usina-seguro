import type { ProposalStatus } from '../domain/proposal.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';

export interface ListProposalsInput {
  /**
   * When present, only proposals in that state are listed.
   *
   * OUT-01 asks for the proposals still open, which section 10.2 defines
   * exactly as `TRANSMITTED` — sent to the insurer and with no outcome yet
   * (REQ-043). OUT-02 is the same listing filtered by `REJECTED` (REQ-045).
   * The filter is the state itself so neither output has to be named here.
   */
  readonly status?: ProposalStatus;
}

export interface ListProposalsDependencies {
  readonly proposals: ProposalRepository;
}

/** OUT-01 / OUT-02, FP-01 step 5: the proposals an operator has to follow. */
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
