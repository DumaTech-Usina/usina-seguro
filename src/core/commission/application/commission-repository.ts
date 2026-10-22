import type { Page, PageRequest } from '../../proposal/application/page.ts';
import type { Commission, CommissionStatus } from '../domain/commission.ts';

/**
 * What narrows a listing. Absent means "every commission".
 */
export interface CommissionListFilter {
  readonly status?: CommissionStatus;
}

/**
 * Persistence contract for commissions, declared by the side that needs it.
 *
 * The lookup is by policy, not by id: every confirmed operation starts from
 * the policy (REQ-236).
 */
export interface CommissionRepository {
  save(commission: Commission): Promise<void>;
  findByPolicyId(policyId: string): Promise<Commission | null>;
  /**
   * OUT-05: every policy's agreed commission in one reading, most recently
   * calculated first.
   *
   * The order is part of the contract and not an accident of the driver: a
   * worklist that reshuffles between two reads is unusable, and both
   * implementations are tested against it.
   */
  list(filter: CommissionListFilter): Promise<readonly Commission[]>;
  /** REQ-330, REQ-333: one page of `list`, in the same order, with the total. */
  page(filter: CommissionListFilter, page: PageRequest): Promise<Page<Commission>>;
}
