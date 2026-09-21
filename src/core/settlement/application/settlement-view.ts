import type { Settlement } from '../domain/settlement.ts';

/** Representation of a broker transfer at the core boundary. */
export interface SettlementView {
  readonly id: string;
  readonly policyId: string;
  readonly brokerId: string;
  readonly amount: string;
  readonly releaseRule: string;
  readonly status: string;
  readonly openedAt: string;
  readonly releasedAt: string | null;
  readonly payment: {
    readonly paidAt: string;
    readonly amount: string;
    /**
     * REQ-095, CA-028: the attached proof, as metadata. The bytes are fetched
     * on demand, by the route that serves the document — a statement listing
     * twenty payments has no business carrying twenty files.
     */
    readonly proof: {
      readonly fileName: string;
      readonly contentType: string;
      readonly byteSize: number;
    };
    readonly userId: string;
  } | null;
}

export function toSettlementView(settlement: Settlement): SettlementView {
  return {
    id: settlement.id,
    policyId: settlement.policyId,
    brokerId: settlement.brokerId,
    amount: settlement.amount.toString(),
    releaseRule: settlement.releaseRule,
    status: settlement.status,
    openedAt: settlement.openedAt.toISOString(),
    releasedAt: settlement.releasedAt?.toISOString() ?? null,
    payment:
      settlement.payment === null
        ? null
        : {
            paidAt: settlement.payment.paidAt.toISOString(),
            amount: settlement.payment.amount.toString(),
            proof: {
              fileName: settlement.payment.proof.fileName,
              contentType: settlement.payment.proof.contentType,
              byteSize: settlement.payment.proof.byteSize,
            },
            userId: settlement.payment.userId,
          },
  };
}
