import type { ProposalStatus } from '../domain/proposal.ts';
import type { ProposalClients } from './proposal-clients.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';

export interface ListProposalsInput {
  /** When present, only proposals in that state (REQ-250) are listed. */
  readonly status?: ProposalStatus;
  /**
   * REQ-319: part of the client's name or digits of its CPF. Absent or blank
   * means no filter. Matched through the client registry, so a proposal
   * registered before it, holding a typed text, is not found (REQ-320).
   */
  readonly client?: string | undefined;
}

export interface ListProposalsDependencies {
  readonly proposals: ProposalRepository;
  readonly clients: ProposalClients;
}

/** The proposals an operator follows while they await issuance (FP-01 step 6). */
export class ListProposals {
  private readonly deps: ListProposalsDependencies;

  constructor(deps: ListProposalsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListProposalsInput = {}): Promise<readonly ProposalView[]> {
    const proposals = await this.deps.proposals.list(
      input.status === undefined ? {} : { status: input.status },
    );
    const query = input.client?.trim() ?? '';

    if (query === '') {
      return proposals.map(toProposalView);
    }

    const clientIds = await this.deps.clients.matching(query);

    return proposals.filter((proposal) => clientIds.has(proposal.clientId)).map(toProposalView);
  }
}
