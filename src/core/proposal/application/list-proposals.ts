import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalStatus } from '../domain/proposal.ts';
import { type Page, type PageSize, mapPage, pageRequestOf } from './page.ts';
import type { ProposalClients } from './proposal-clients.ts';
import type { ProposalListing } from './proposal-listing.ts';
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
  /** REQ-330 to REQ-332: the page, from 1, and its size; the first of 50 when absent. */
  readonly page?: number;
  readonly size?: PageSize;
}

/** A line of the listing: the proposal and the name of its client (REQ-318). */
export interface ProposalListItemView extends ProposalView {
  readonly clientName: string;
}

export interface ListProposalsDependencies {
  readonly proposals: ProposalRepository;
  readonly listing: ProposalListing;
  readonly clients: ProposalClients;
}

/** The proposals an operator follows while they await issuance (FP-01 step 6). */
export class ListProposals {
  private readonly deps: ListProposalsDependencies;

  constructor(deps: ListProposalsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListProposalsInput = {}): Promise<Page<ProposalListItemView>> {
    const client = input.client?.trim() ?? '';
    const ids = await this.deps.listing.proposals(
      {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(client === '' ? {} : { client }),
      },
      pageRequestOf(input),
    );

    const lines = await Promise.all(
      ids.items.map(async (id) => {
        const proposal = await this.deps.proposals.findById(id);
        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id });
        }
        return {
          ...toProposalView(proposal),
          clientName: await this.deps.clients.nameOf(proposal.clientId),
        };
      }),
    );

    return mapPage(ids, lines);
  }
}
