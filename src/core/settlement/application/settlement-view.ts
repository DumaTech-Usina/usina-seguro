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
    readonly proofReference: string;
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
            proofReference: settlement.payment.proofReference,
            userId: settlement.payment.userId,
          },
  };
}
