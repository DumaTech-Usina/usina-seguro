import type { Policy } from '../domain/policy.ts';

/**
 * Persistence contract for policies, declared by the side that needs it.
 *
 * The policy is stored with its installments: REQ-020 makes them part of the
 * policy and nothing writes an installment on its own, so there is no separate
 * installment repository.
 */
export interface PolicyRepository {
  save(policy: Policy): Promise<void>;
  findById(id: string): Promise<Policy | null>;
  /** REQ-082, CA-018: the conciliation key is the policy number. */
  findByPolicyNumber(policyNumber: string): Promise<Policy | null>;
  /**
   * REQ-082, CA-019: when the report brings only the proposal number, the
   * policy is resolved through the link the proposal originated (REQ-050).
   */
  findByProposalId(proposalId: string): Promise<Policy | null>;
}
