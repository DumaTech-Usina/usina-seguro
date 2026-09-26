import type { PayoutCommission } from '../domain/payout-commission.ts';

/**
 * Persistence contract for the payout commission (V2 section 9A), declared by
 * the side that needs it.
 *
 * Looked up by policy: a policy has at most one CR (REQ-271) and so at most
 * one payout commission.
 */
export interface PayoutCommissionRepository {
  save(commission: PayoutCommission): Promise<void>;
  findByPolicyId(policyId: string): Promise<PayoutCommission | null>;
  /** Every payout commission, in no particular order: the use cases sort. */
  list(): Promise<readonly PayoutCommission[]>;
}
