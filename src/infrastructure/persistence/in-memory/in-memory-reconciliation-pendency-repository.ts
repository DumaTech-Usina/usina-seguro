import type { ReconciliationPendencyRepository } from '../../../core/reconciliation/application/reconciliation-pendency-repository.ts';
import type { ReconciliationPendency } from '../../../core/reconciliation/domain/reconciliation-pendency.ts';

export class InMemoryReconciliationPendencyRepository implements ReconciliationPendencyRepository {
  private readonly records: ReconciliationPendency[] = [];

  async save(pendency: ReconciliationPendency): Promise<void> {
    this.records.push(pendency);
  }

  async listOpen(): Promise<readonly ReconciliationPendency[]> {
    return [...this.records].sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
  }
}
