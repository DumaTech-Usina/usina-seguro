import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import { Percentage } from '../domain/percentage.ts';
import type { ProposalRepository } from './proposal-repository.ts';

export interface TransmitProposalInput {
  readonly proposalId: string;
  /** Number issued by the insurer (glossary 5.1, REQ-022). */
  readonly proposalNumber: string;
  /** Worked commission informed in the act of transmission (REQ-041). */
  readonly workedCommission: string;
}

export interface TransmitProposalOutput {
  readonly id: string;
  readonly status: string;
  readonly proposalNumber: string | null;
  readonly workedCommission: string | null;
  readonly transmittedAt: string | null;
}

export interface TransmitProposalDependencies {
  readonly proposals: ProposalRepository;
  readonly now: () => Date;
}

/**
 * FP-01, step 4: transmits the proposal to the insurer (REQ-041, REQ-042).
 *
 * The transition rules live in `Proposal.transmit`; the use case only loads,
 * delegates and persists.
 */
export class TransmitProposal {
  private readonly deps: TransmitProposalDependencies;

  constructor(deps: TransmitProposalDependencies) {
    this.deps = deps;
  }

  async execute(input: TransmitProposalInput): Promise<TransmitProposalOutput> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    const transmitted = proposal.transmit({
      proposalNumber: input.proposalNumber,
      workedCommission: Percentage.fromString(input.workedCommission),
      transmittedAt: this.deps.now(),
    });

    await this.deps.proposals.save(transmitted);

    return {
      id: transmitted.id,
      status: transmitted.status,
      proposalNumber: transmitted.proposalNumber,
      workedCommission: transmitted.workedCommission?.toString() ?? null,
      transmittedAt: transmitted.transmittedAt?.toISOString() ?? null,
    };
  }
}
