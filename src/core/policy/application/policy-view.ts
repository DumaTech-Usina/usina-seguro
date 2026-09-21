import type { Proposal } from '../../proposal/domain/proposal.ts';
import type { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { Policy } from '../domain/policy.ts';

/**
 * Representation of a policy at the core boundary.
 *
 * It carries both numbers, the policy's own and the one the insurer issued for
 * the originating proposal (REQ-050, CA-008: both must stay consultable even
 * when they differ). The proposal number lives on the proposal, so the caller
 * hands over the proposal it already loaded instead of duplicating the value.
 */
export interface InstallmentView {
  readonly id: string;
  readonly number: number;
  readonly amount: string;
  readonly dueDate: string;
  readonly status: string;
  /** REQ-123: who confirmed the client paid, and when. */
  readonly confirmedBy: string | null;
  readonly confirmedAt: string | null;
}

export interface PolicyView {
  readonly id: string;
  readonly policyNumber: string;
  readonly proposalId: string;
  readonly proposalNumber: string | null;
  readonly status: string;
  readonly premium: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly renewalDate: string;
  readonly registeredAt: string;
  readonly installments: readonly InstallmentView[];
}

export function toPolicyView(policy: Policy, proposal: Proposal): PolicyView {
  return {
    id: policy.id,
    policyNumber: policy.policyNumber,
    proposalId: policy.proposalId,
    proposalNumber: proposal.proposalNumber,
    status: policy.status,
    premium: policy.premium.toString(),
    coverageStart: policy.coverageStart.toString(),
    coverageEnd: policy.coverageEnd.toString(),
    renewalDate: policy.renewalDate.toString(),
    registeredAt: policy.registeredAt.toISOString(),
    installments: policy.installments.map((installment) => ({
      id: installment.id,
      number: installment.number,
      amount: installment.amount.toString(),
      dueDate: installment.dueDate.toString(),
      status: installment.status,
      confirmedBy: installment.confirmation?.userId ?? null,
      confirmedAt: installment.confirmation?.at.toISOString() ?? null,
    })),
  };
}

/**
 * One line of the policy listing (OUT-03, OUT-04).
 *
 * It answers what the listing exists for: which policies the Usina sold, what
 * their coverage period is, what state they are in (REQ-020) and when each one
 * renews (REQ-055). The schedule is absent on purpose — it is detail of a
 * single policy, which `PolicyView` already carries.
 *
 * The policy holds the proposal by id and nothing a human recognises, so what
 * identifies the business comes from the proposal it originated: the number the
 * insurer issued (REQ-050) and the client, insurer and product references
 * REQ-022 keeps.
 *
 * Each reference travels twice: as the identifier that is stored, which is
 * what the conciliation and every other record match on, and as the name IN-01
 * registered for it. The name is `null` when nobody registered one — nothing
 * refuses a business for that (REQ-002), so the absence is information for
 * whoever renders the line, not an error.
 */
export interface PolicyListItemView {
  readonly id: string;
  readonly policyNumber: string;
  readonly proposalId: string;
  readonly proposalNumber: string | null;
  readonly clientId: string;
  readonly clientName: string | null;
  readonly insurerId: string;
  readonly insurerName: string | null;
  readonly productId: string;
  /** REQ-022 names the field "produto/ramo": the product's name is the ramo. */
  readonly productName: string | null;
  readonly status: string;
  readonly premium: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly renewalDate: string;
  readonly registeredAt: string;
}

export function toPolicyListItemView(
  policy: Policy,
  proposal: Proposal,
  names: ReferenceNames,
): PolicyListItemView {
  return {
    id: policy.id,
    policyNumber: policy.policyNumber,
    proposalId: policy.proposalId,
    proposalNumber: proposal.proposalNumber,
    clientId: proposal.clientId,
    clientName: names.of('CLIENT', proposal.clientId),
    insurerId: proposal.insurerId,
    insurerName: names.of('INSURER', proposal.insurerId),
    productId: proposal.productId,
    productName: names.of('PRODUCT', proposal.productId),
    status: policy.status,
    premium: policy.premium.toString(),
    coverageStart: policy.coverageStart.toString(),
    coverageEnd: policy.coverageEnd.toString(),
    renewalDate: policy.renewalDate.toString(),
    registeredAt: policy.registeredAt.toISOString(),
  };
}
