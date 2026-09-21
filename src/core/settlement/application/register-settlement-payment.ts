import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { SETTLEMENT_MESSAGES } from '../domain/errors.ts';
import type { DocumentStorage } from './document-storage.ts';
import type { SettlementRepository } from './settlement-repository.ts';
import { type SettlementView, toSettlementView } from './settlement-view.ts';

/** REQ-095, CA-028: the document attached to the payment. */
export interface SettlementPaymentProofInput {
  readonly fileName: string;
  readonly contentType: string;
  /**
   * The bytes themselves. How they travelled — base64 in a JSON body, a
   * multipart part, a temporary file — is the interface's business: the core
   * receives a document, not a transport.
   */
  readonly content: Uint8Array;
}

export interface RegisterSettlementPaymentInput {
  readonly policyId: string;
  readonly amount: string;
  readonly proof: SettlementPaymentProofInput;
  readonly userId: string;
}

export interface RegisterSettlementPaymentDependencies {
  readonly settlements: SettlementRepository;
  /** REQ-095: where the attached proof is kept. */
  readonly documents: DocumentStorage;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-03 step 5, REQ-095, IN-15, CA-028: records the payment sent to the
 * broker, with the proof attached.
 *
 * The system does not execute the transfer (REQ-013); it registers that it
 * happened, which is what REQ-002 makes it responsible for.
 *
 * **Order matters and is not incidental.** The transition runs first and
 * writes nothing, so a refused payment leaves no orphan document behind. The
 * document is stored next, and the settlement last: if that final write
 * failed, what would be left is a document nothing points at — harmless — and
 * never a payment pointing at a document that does not exist. A transaction
 * would not improve on that, and would only hold for the drivers that happen
 * to keep both in the same database.
 */
export class RegisterSettlementPayment {
  private readonly deps: RegisterSettlementPaymentDependencies;

  constructor(deps: RegisterSettlementPaymentDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterSettlementPaymentInput): Promise<SettlementView> {
    const settlement = await this.deps.settlements.findByPolicyId(input.policyId);

    if (settlement === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.NOT_FOUND, { policyId: input.policyId });
    }

    const documentId = this.deps.newId();

    const paid = settlement.registerPayment({
      paidAt: this.deps.now(),
      amount: Money.fromString(input.amount),
      proof: {
        documentId,
        fileName: input.proof.fileName,
        contentType: input.proof.contentType,
        byteSize: input.proof.content.length,
      },
      userId: input.userId,
    });

    await this.deps.documents.save({
      id: documentId,
      fileName: paid.payment?.proof.fileName ?? input.proof.fileName,
      contentType: input.proof.contentType,
      content: input.proof.content,
    });

    await this.deps.settlements.save(paid);

    return toSettlementView(paid);
  }
}
