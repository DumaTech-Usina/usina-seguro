import type { Proposal } from '../domain/proposal.ts';

/**
 * Representation of a proposal at the core boundary.
 *
 * It carries what FP-01 step 5 has to show to be useful (REQ-043, OUT-01): who
 * the business is for, the number the insurer issued, the worked commission
 * informed at transmission (REQ-041) and, when the cycle ended in a refusal,
 * the mandatory reason REQ-045 keeps on the record.
 *
 * The registry ids travel as they are stored: client, broker, insurer, product
 * and payment method are references to registries of IN-01/IN-06 that are not
 * modelled yet, so there is no name to resolve.
 */
export interface ProposalView {
  readonly id: string;
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  readonly status: string;
  readonly netPremium: string;
  /** REQ-022, REQ-050: known from the transmission on. */
  readonly proposalNumber: string | null;
  /** REQ-041: percentage informed in the act of transmission. */
  readonly workedCommission: string | null;
  readonly registeredAt: string;
  readonly transmittedAt: string | null;
  /** REQ-045: present exactly when the outcome was a refusal. */
  readonly rejectionReason: string | null;
}

export function toProposalView(proposal: Proposal): ProposalView {
  return {
    id: proposal.id,
    clientId: proposal.clientId,
    brokerId: proposal.brokerId,
    insurerId: proposal.insurerId,
    productId: proposal.productId,
    paymentMethodId: proposal.paymentMethodId,
    status: proposal.status,
    netPremium: proposal.netPremium.toString(),
    proposalNumber: proposal.proposalNumber,
    workedCommission: proposal.workedCommission?.toString() ?? null,
    registeredAt: proposal.registeredAt.toISOString(),
    transmittedAt: proposal.transmittedAt?.toISOString() ?? null,
    rejectionReason: proposal.rejectionReason,
  };
}
