import { Authorship } from '../domain/authorship.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';
import { type RegisterProposalInstallmentInput, toInstallments } from './register-proposal.ts';

export interface ReviseInstallmentsInput {
  readonly proposalId: string;
  /** The whole list as it stays: included, altered and removed in one act. */
  readonly installments: readonly RegisterProposalInstallmentInput[];
  /** REQ-216: who signs the correction. */
  readonly author: string;
}

export interface ReviseInstallmentsDependencies {
  readonly proposals: ProposalRepository;
  readonly now: () => Date;
}

/**
 * REQ-254, FA-224: "Corrigir parcelas" — the installments corrected while the
 * proposal awaits issuance, in either mode, signed by who corrected them. The
 * earlier lists stay (REQ-124).
 */
export class ReviseInstallments {
  private readonly deps: ReviseInstallmentsDependencies;

  constructor(deps: ReviseInstallmentsDependencies) {
    this.deps = deps;
  }

  async execute(input: ReviseInstallmentsInput): Promise<ProposalView> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    const revised = proposal.reviseInstallments({
      installments: toInstallments(input.installments),
      informed: Authorship.of(input.author, this.deps.now()),
    });

    await this.deps.proposals.save(revised);

    return toProposalView(revised);
  }
}
