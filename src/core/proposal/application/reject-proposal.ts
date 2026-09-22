import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalRepository } from './proposal-repository.ts';

export interface RejectProposalInput {
  readonly proposalId: string;
  /** REQ-253: mandatory. Free text. */
  readonly reason: string;
}

export interface RejectProposalOutput {
  readonly id: string;
  readonly status: string;
  readonly rejectionReason: string | null;
}

export interface RejectProposalDependencies {
  readonly proposals: ProposalRepository;
}

/**
 * FP-01 step 8, refusal branch (REQ-253, FA-208): the insurer did not issue
 * the proposal. The refusal is final and the record stays consultable.
 */
export class RejectProposal {
  private readonly deps: RejectProposalDependencies;

  constructor(deps: RejectProposalDependencies) {
    this.deps = deps;
  }

  async execute(input: RejectProposalInput): Promise<RejectProposalOutput> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    const rejected = proposal.reject(input.reason);

    await this.deps.proposals.save(rejected);

    return {
      id: rejected.id,
      status: rejected.status,
      rejectionReason: rejected.rejectionReason,
    };
  }
}
