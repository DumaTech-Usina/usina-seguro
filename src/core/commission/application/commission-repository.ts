import type { Commission } from '../domain/commission.ts';

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
}
