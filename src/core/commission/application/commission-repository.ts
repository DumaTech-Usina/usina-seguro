import type { Commission, CommissionStatus } from '../domain/commission.ts';

/**
 * What narrows a listing. Absent means "every commission".
 *
 * The filter is the state of section 10.5 itself, so OUT-05 does not have to
 * be named here: the panel of REQ-076 is the listing with no filter, and the
 * worklist of FP-02 step 5 is the same listing filtered by `DIVERGENT`.
 */
export interface CommissionListFilter {
  readonly status?: CommissionStatus;
}

/**
 * Persistence contract for commissions, declared by the side that needs it.
 *
 * The lookup is by policy, not by id: every confirmed operation starts from
 * the policy (REQ-075 keeps the pair per policy, REQ-082 conciliates by policy
 * number, REQ-093 pays the transfer of a policy).
 */
export interface CommissionRepository {
  save(commission: Commission): Promise<void>;
  findByPolicyId(policyId: string): Promise<Commission | null>;
  /**
   * OUT-05, REQ-076: every policy's agreed and real values in one reading,
   * most recently calculated first.
   *
   * The order is part of the contract and not an accident of the driver: a
   * worklist that reshuffles between two reads is unusable, and both
   * implementations are tested against it.
   */
  list(filter: CommissionListFilter): Promise<readonly Commission[]>;
}
