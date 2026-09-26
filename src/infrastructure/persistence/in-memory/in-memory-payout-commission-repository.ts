import type { PayoutCommissionRepository } from '../../../core/commission/application/payout-commission-repository.ts';
import type { PayoutCommission } from '../../../core/commission/domain/payout-commission.ts';

/**
 * `PayoutCommissionRepository` for unit tests: keyed by policy, which is what
 * makes "at most one per policy" (REQ-271) free here. The SQLite adapter gets
 * it from a UNIQUE constraint instead.
 */
export class InMemoryPayoutCommissionRepository implements PayoutCommissionRepository {
  private readonly records = new Map<string, PayoutCommission>();

  async save(commission: PayoutCommission): Promise<void> {
    this.records.set(commission.policyId, commission);
  }

  async findByPolicyId(policyId: string): Promise<PayoutCommission | null> {
    return this.records.get(policyId) ?? null;
  }

  async list(): Promise<readonly PayoutCommission[]> {
    return [...this.records.values()];
  }
}
