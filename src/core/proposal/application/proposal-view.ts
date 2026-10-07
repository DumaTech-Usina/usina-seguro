import type { Proposal, ProposalInstallment } from '../domain/proposal.ts';
import type { Receipt } from '../domain/receipt.ts';

/**
 * Representation of a proposal at the core boundary.
 *
 * Money and percentages are decimal strings (REQ-120, REQ-121); calendar
 * dates are `YYYY-MM-DD`; instants are ISO-8601.
 *
 * The registry ids travel as they are stored. The CT, its mode and the
 * receipt are the ones in force; the histories carry every entry with who
 * signed it (REQ-215, REQ-223).
 */
export interface ProposalView {
  readonly id: string;
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  readonly status: string;
  readonly proposalNumber: string;
  readonly netPremium: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /** REQ-203: always equal to `coverageEnd`. */
  readonly renewalDate: string;
  readonly installments: readonly ProposalInstallmentView[];
  /** The CT; with a parcelled CT, the CT of the first installment (REQ-291). */
  readonly workedCommission: string;
  /** REQ-291: the CT of the subsequent installments; `null` with an integral CT. */
  readonly subsequentWorkedCommission: string | null;
  readonly workedCommissionMode: string;
  /** REQ-220: `null` when the receipt is direct. */
  readonly intermediaryId: string | null;
  /** REQ-221: present exactly when there is an intermediary. */
  readonly ctu: string | null;
  /**
   * REQ-232, CA-203: what the Usina expects, before issuance, with an integral
   * CT. `null` with a parcelled CT, which has no total (REQ-293, REJ-232).
   */
  readonly expectedReceipt: {
    readonly intermediary: string | null;
    readonly usina: string;
  } | null;
  /** REQ-293, CA-246: with a parcelled CT, what the Usina expects from each installment. */
  readonly expectedInstallments: readonly ExpectedInstallmentView[] | null;
  readonly workedCommissionHistory: readonly {
    readonly workedCommission: string;
    readonly subsequentWorkedCommission: string | null;
    readonly workedCommissionMode: string;
    readonly informedBy: string;
    readonly informedAt: string;
  }[];
  /** REQ-254: every list of installments, with who signed it and when. */
  readonly installmentHistory: readonly {
    readonly installments: readonly ProposalInstallmentView[];
    readonly informedBy: string;
    readonly informedAt: string;
  }[];
  readonly receiptHistory: readonly {
    readonly intermediaryId: string | null;
    readonly ctu: string | null;
    readonly declaredBy: string;
    readonly declaredAt: string;
  }[];
  readonly registeredAt: string;
  /** REQ-253: present exactly when the proposal was refused. */
  readonly rejectionReason: string | null;
  /** REQ-209, CA-207: present exactly when the issuance was recognised. */
  readonly issuanceRecognizedBy: string | null;
  readonly issuanceRecognizedAt: string | null;
  /** REQ-219: the PDF the proposal was imported from, when there is one. */
  readonly sourceDocument: { readonly fileName: string } | null;
}

export interface ProposalInstallmentView {
  /** Position in the list, starting at 1. */
  readonly number: number;
  readonly amount: string;
  /** REQ-204: optional. */
  readonly dueDate: string | null;
}

export interface ExpectedInstallmentView {
  readonly number: number;
  readonly amount: string;
  /** The CT applied to this installment (REQ-291). */
  readonly workedCommission: string;
  readonly usina: string;
}

function installmentViews(installments: readonly ProposalInstallment[]): ProposalInstallmentView[] {
  return installments.map((installment, index) => ({
    number: index + 1,
    amount: installment.amount.toString(),
    dueDate: installment.dueDate?.toString() ?? null,
  }));
}

function receiptFields(receipt: Receipt) {
  return receipt.kind === 'DIRECT'
    ? { intermediaryId: null, ctu: null }
    : { intermediaryId: receipt.intermediaryId, ctu: receipt.ctu.toString() };
}

export function toProposalView(proposal: Proposal): ProposalView {
  const perInstallment = proposal.expectedInstallmentReceipts();
  const expected = perInstallment === null ? proposal.expectedReceipt() : null;

  return {
    id: proposal.id,
    clientId: proposal.clientId,
    brokerId: proposal.brokerId,
    insurerId: proposal.insurerId,
    productId: proposal.productId,
    paymentMethodId: proposal.paymentMethodId,
    status: proposal.status,
    proposalNumber: proposal.proposalNumber,
    netPremium: proposal.netPremium.toString(),
    coverageStart: proposal.coverageStart.toString(),
    coverageEnd: proposal.coverageEnd.toString(),
    renewalDate: proposal.renewalDate.toString(),
    installments: installmentViews(proposal.installments),
    workedCommission: proposal.workedCommission.toString(),
    subsequentWorkedCommission: proposal.subsequentWorkedCommission?.toString() ?? null,
    workedCommissionMode: proposal.workedCommissionMode,
    ...receiptFields(proposal.receipt),
    expectedReceipt:
      expected === null
        ? null
        : {
            intermediary: expected.intermediary?.toString() ?? null,
            usina: expected.usina.toString(),
          },
    expectedInstallments:
      perInstallment?.map((receipt) => ({
        number: receipt.number,
        amount: receipt.amount.toString(),
        workedCommission: receipt.workedCommission.toString(),
        usina: receipt.usina.toString(),
      })) ?? null,
    workedCommissionHistory: proposal.workedCommissionHistory.map((entry) => ({
      workedCommission: entry.rate.toString(),
      subsequentWorkedCommission: entry.subsequentRate?.toString() ?? null,
      workedCommissionMode: entry.mode,
      informedBy: entry.informed.author,
      informedAt: entry.informed.at.toISOString(),
    })),
    installmentHistory: proposal.installmentHistory.map((entry) => ({
      installments: installmentViews(entry.installments),
      informedBy: entry.informed.author,
      informedAt: entry.informed.at.toISOString(),
    })),
    receiptHistory: proposal.receiptHistory.map((declaration) => ({
      ...receiptFields(declaration.receipt),
      declaredBy: declaration.declared.author,
      declaredAt: declaration.declared.at.toISOString(),
    })),
    registeredAt: proposal.registeredAt.toISOString(),
    rejectionReason: proposal.rejectionReason,
    issuanceRecognizedBy: proposal.issuanceRecognition?.author ?? null,
    issuanceRecognizedAt: proposal.issuanceRecognition?.at.toISOString() ?? null,
    sourceDocument:
      proposal.sourceDocument === null ? null : { fileName: proposal.sourceDocument.fileName },
  };
}
