import type { CommissionRepository } from '../../../core/commission/application/commission-repository.ts';
import type { Commission } from '../../../core/commission/domain/commission.ts';

/**
 * `CommissionRepository` implementation for unit tests and fast execution.
 *
 * Keyed by policy because there is one commission per policy (REQ-075), which
 * also makes the uniqueness REQ-086 relies on free here. The SQLite adapter
 * gets it from a UNIQUE constraint instead.
 */
export class InMemoryCommissionRepository implements CommissionRepository {
  private readonly records = new Map<string, Commission>();

  async save(commission: Commission): Promise<void> {
    this.records.set(commission.policyId, commission);
  }

  async findByPolicyId(policyId: string): Promise<Commission | null> {
    return this.records.get(policyId) ?? null;
  }
}
