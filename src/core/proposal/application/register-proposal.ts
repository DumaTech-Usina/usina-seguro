import { CalendarDate } from '../domain/calendar-date.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { declareReceipt } from '../domain/receipt.ts';
import type { WorkedCommissionMode } from '../domain/worked-commission.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import { type ProposalView, toProposalView } from './proposal-view.ts';
import type { SourceDocumentStorage } from './source-document-storage.ts';

/** REQ-221: an intermediary and its CTU, as the user declared them. */
export interface IntermediaryDeclarationInput {
  readonly intermediaryId: string;
  /** Decimal string; `null` when not informed, which the domain refuses. */
  readonly ctu: string | null;
}

export interface RegisterProposalInstallmentInput {
  readonly amount: string;
  /** REQ-204: optional. */
  readonly dueDate: string | null;
}

/**
 * Use case input: raw data at the core boundary. Money and percentages arrive
 * as decimal strings (REQ-120, REQ-121) and dates as `YYYY-MM-DD`; they only
 * become value objects in here.
 */
export interface RegisterProposalInput {
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  readonly customerAccepted: boolean;
  readonly proposalNumber: string;
  readonly netPremium: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly installments: readonly RegisterProposalInstallmentInput[];
  readonly workedCommission: string;
  readonly workedCommissionMode: WorkedCommissionMode;
  /** REQ-220: `null` declares a direct receipt. */
  readonly intermediary: IntermediaryDeclarationInput | null;
  /** REQ-216: who signs the CT and the receipt declaration. */
  readonly author: string;
  /** REQ-219: the PDF the data was imported from, kept as uploaded. */
  readonly sourceDocument?: SourceDocumentInput | null;
}

export interface SourceDocumentInput {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

/**
 * `newId` and `now` are injected rather than called directly: they are the two
 * sources of non-determinism in this flow and the tests need to control them.
 */
export interface RegisterProposalDependencies {
  readonly proposals: ProposalRepository;
  readonly documents: SourceDocumentStorage;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-01 steps 1 to 6: registers the proposal with its commercial and
 * standardized data, the CT and the receipt declaration, leaving it awaiting
 * issuance with the expected value visible (REQ-232).
 *
 * The use case only converts and orchestrates — the rules live in the domain.
 */
export class RegisterProposal {
  private readonly deps: RegisterProposalDependencies;

  constructor(deps: RegisterProposalDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterProposalInput): Promise<ProposalView> {
    const id = this.deps.newId();
    const source = input.sourceDocument ?? null;
    const documentId = source === null ? null : this.deps.newId();

    const proposal = Proposal.register({
      id,
      clientId: input.clientId,
      brokerId: input.brokerId,
      insurerId: input.insurerId,
      productId: input.productId,
      paymentMethodId: input.paymentMethodId,
      customerAccepted: input.customerAccepted,
      proposalNumber: input.proposalNumber,
      netPremium: Money.fromString(input.netPremium),
      coverageStart: CalendarDate.fromString(input.coverageStart),
      coverageEnd: CalendarDate.fromString(input.coverageEnd),
      installments: input.installments.map((installment) => ({
        amount: Money.fromString(installment.amount),
        dueDate: installment.dueDate === null ? null : CalendarDate.fromString(installment.dueDate),
      })),
      workedCommission: Percentage.fromString(input.workedCommission),
      workedCommissionMode: input.workedCommissionMode,
      receipt: declareReceipt(toIntermediary(input.intermediary)),
      sourceDocument:
        source === null || documentId === null ? null : { documentId, fileName: source.fileName },
      registeredBy: input.author,
      registeredAt: this.deps.now(),
    });

    // Only once the domain accepted the proposal: a refused registration
    // leaves no document behind.
    if (source !== null && documentId !== null) {
      await this.deps.documents.save({ id: documentId, ...source });
    }

    await this.deps.proposals.save(proposal);

    return toProposalView(proposal);
  }
}

/** Shared with `ReviseReceipt`: the CTU only becomes a percentage when present. */
export function toIntermediary(input: IntermediaryDeclarationInput | null) {
  if (input === null) {
    return null;
  }

  return {
    intermediaryId: input.intermediaryId,
    ctu: input.ctu === null ? null : Percentage.fromString(input.ctu),
  };
}
