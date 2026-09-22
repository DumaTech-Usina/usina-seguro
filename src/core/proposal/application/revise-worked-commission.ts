import { Authorship } from '../domain/authorship.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import { Percentage } from '../domain/percentage.ts';
import type { WorkedCommissionMode } from '../domain/worked-commission.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';

export interface ReviseWorkedCommissionInput {
  readonly proposalId: string;
  readonly workedCommission: string;
  readonly workedCommissionMode: WorkedCommissionMode;
  /** REQ-216: who signs the correction. */
  readonly author: string;
}

export interface ReviseWorkedCommissionDependencies {
  readonly proposals: ProposalRepository;
  readonly now: () => Date;
}

/**
 * FP-01 step 7, FA-203: corrects the CT and its mode while the proposal awaits
 * issuance (REQ-214), signed by who corrected it (REQ-215).
 */
export class ReviseWorkedCommission {
  private readonly deps: ReviseWorkedCommissionDependencies;

  constructor(deps: ReviseWorkedCommissionDependencies) {
    this.deps = deps;
  }

  async execute(input: ReviseWorkedCommissionInput): Promise<ProposalView> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    const revised = proposal.reviseWorkedCommission({
      rate: Percentage.fromString(input.workedCommission),
      mode: input.workedCommissionMode,
      informed: Authorship.of(input.author, this.deps.now()),
    });

    await this.deps.proposals.save(revised);

    return toProposalView(revised);
  }
}
