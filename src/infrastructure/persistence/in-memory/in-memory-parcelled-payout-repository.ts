import type { ParcelledPayoutRepository } from '../../../core/commission/application/parcelled-payout-repository.ts';
import type { ParcelledPayoutCommission } from '../../../core/commission/domain/parcelled-payout.ts';

/** `ParcelledPayoutRepository` for unit tests: keyed by policy, one per policy. */
export class InMemoryParcelledPayoutRepository implements ParcelledPayoutRepository {
  private readonly records = new Map<string, ParcelledPayoutCommission>();

  async save(commission: ParcelledPayoutCommission): Promise<void> {
    this.records.set(commission.policyId, commission);
  }

  async findByPolicyId(policyId: string): Promise<ParcelledPayoutCommission | null> {
    return this.records.get(policyId) ?? null;
  }

  async list(): Promise<readonly ParcelledPayoutCommission[]> {
    return [...this.records.values()];
  }
}
