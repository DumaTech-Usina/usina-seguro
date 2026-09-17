import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalRepository } from './proposal-repository.ts';

export interface RejectProposalInput {
  readonly proposalId: string;
  /** REQ-045: mandatory. Free text; the set of categories is DEC-014. */
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
 * FP-01, step 6 (refusal branch): records the insurer's refusal (REQ-044,
 * REQ-045). The record stays in the system (REQ-046, OUT-02).
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
