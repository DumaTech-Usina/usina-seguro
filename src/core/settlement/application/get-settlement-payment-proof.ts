import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { SETTLEMENT_MESSAGES } from '../domain/errors.ts';
import type { DocumentStorage, StoredDocument } from './document-storage.ts';
import type { SettlementRepository } from './settlement-repository.ts';

export interface GetSettlementPaymentProofDependencies {
  readonly settlements: SettlementRepository;
  readonly documents: DocumentStorage;
}

/**
 * REQ-095, CA-028: hands back the proof attached to a payment.
 *
 * An attachment nobody can open again is not evidence of anything, so the
 * document travels out the same way it came in — bytes, name and media type,
 * exactly as stored. Nothing is transformed, resized or re-encoded here: the
 * proof is the file the Financeiro attached.
 *
 * The three absences answer 404 and not a rule violation, because none of
 * them is a broken rule: the transfer may not exist, it may not have been
 * paid yet, or — a case only a corrupted store produces — the document may be
 * gone.
 */
export class GetSettlementPaymentProof {
  private readonly deps: GetSettlementPaymentProofDependencies;

  constructor(deps: GetSettlementPaymentProofDependencies) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<StoredDocument> {
    const settlement = await this.deps.settlements.findByPolicyId(policyId);

    if (settlement === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.NOT_FOUND, { policyId });
    }

    if (settlement.payment === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.PAYMENT_PROOF_NOT_FOUND, { policyId });
    }

    const document = await this.deps.documents.findById(settlement.payment.proof.documentId);

    if (document === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.PAYMENT_PROOF_NOT_FOUND, { policyId });
    }

    return document;
  }
}
