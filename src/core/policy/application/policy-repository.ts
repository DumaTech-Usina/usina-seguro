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
}
