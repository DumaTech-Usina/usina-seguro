import type { ReconciliationPendency } from '../domain/reconciliation-pendency.ts';

export interface ReconciliationPendencyRepository {
  save(pendency: ReconciliationPendency): Promise<void>;
  /** OUT-06: the lines waiting for a human, most recent first. */
  listOpen(): Promise<readonly ReconciliationPendency[]>;
}
