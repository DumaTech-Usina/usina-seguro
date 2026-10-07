import { Authorship } from '../domain/authorship.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { WorkedCommissionMode } from '../domain/worked-commission.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';
import { toWorkedCommissionRates } from './register-proposal.ts';

export interface ReviseWorkedCommissionInput {
  readonly proposalId: string;
  readonly workedCommission: string;
  /** REQ-291, REQ-297: the CT of the subsequent installments, only with a parcelled CT. */
  readonly subsequentWorkedCommission?: string | null;
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
 * issuance (REQ-214), signed by who corrected it (REQ-215). With a parcelled
 * CT both CTs go together (REQ-297); the switch of mode follows REQ-299.
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

    const rates = toWorkedCommissionRates(input);
    const revised = proposal.reviseWorkedCommission({
      rate: rates.workedCommission,
      subsequentRate: rates.subsequentWorkedCommission,
      mode: input.workedCommissionMode,
      informed: Authorship.of(input.author, this.deps.now()),
    });

    await this.deps.proposals.save(revised);

    return toProposalView(revised);
  }
}
