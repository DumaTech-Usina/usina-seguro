import type { Settlement } from '../domain/settlement.ts';

export interface SettlementRepository {
  save(settlement: Settlement): Promise<void>;
  /** One transfer per policy: see the comment on `Settlement`. */
  findByPolicyId(policyId: string): Promise<Settlement | null>;
}
