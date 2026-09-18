import type { Proposal } from '../../proposal/domain/proposal.ts';
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
