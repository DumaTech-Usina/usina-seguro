import type { ParcelledPayoutCommission } from '../domain/parcelled-payout.ts';

/**
 * Persistence contract for the payout of a policy with parcelled CT (V2
 * section 9B), declared by the side that needs it. At most one per policy:
 * the two CRs are informed once and then only revised (REQ-287, REQ-265).
 */
export interface ParcelledPayoutRepository {
  save(commission: ParcelledPayoutCommission): Promise<void>;
  findByPolicyId(policyId: string): Promise<ParcelledPayoutCommission | null>;
  /** Every parcelled payout, in no particular order: the use cases sort. */
  list(): Promise<readonly ParcelledPayoutCommission[]>;
}
