import type { SettlementRepository } from '../../../core/settlement/application/settlement-repository.ts';
import type { Settlement } from '../../../core/settlement/domain/settlement.ts';

export class InMemorySettlementRepository implements SettlementRepository {
  private readonly records = new Map<string, Settlement>();

  async save(settlement: Settlement): Promise<void> {
    this.records.set(settlement.policyId, settlement);
  }

  async findByPolicyId(policyId: string): Promise<Settlement | null> {
    return this.records.get(policyId) ?? null;
  }
}
