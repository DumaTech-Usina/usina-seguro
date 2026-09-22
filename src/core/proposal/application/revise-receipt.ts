import { Authorship } from '../domain/authorship.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import { declareReceipt } from '../domain/receipt.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';
import { type IntermediaryDeclarationInput, toIntermediary } from './register-proposal.ts';

export interface ReviseReceiptInput {
  readonly proposalId: string;
  /** REQ-220: `null` declares a direct receipt. */
  readonly intermediary: IntermediaryDeclarationInput | null;
  /** REQ-216: who signs the declaration. */
  readonly author: string;
}

export interface ReviseReceiptDependencies {
  readonly proposals: ProposalRepository;
  readonly now: () => Date;
}

/**
 * FP-01 step 7, FA-204, FA-209: declares, replaces or removes the
 * intermediary and its CTU while the proposal awaits issuance (REQ-225),
 * signed by who declared it (REQ-223).
 */
export class ReviseReceipt {
  private readonly deps: ReviseReceiptDependencies;

  constructor(deps: ReviseReceiptDependencies) {
    this.deps = deps;
  }

  async execute(input: ReviseReceiptInput): Promise<ProposalView> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    const revised = proposal.reviseReceipt({
      receipt: declareReceipt(toIntermediary(input.intermediary)),
      declared: Authorship.of(input.author, this.deps.now()),
    });

    await this.deps.proposals.save(revised);

    return toProposalView(revised);
  }
}
