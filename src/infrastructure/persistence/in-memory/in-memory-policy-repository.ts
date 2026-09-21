import type {
  PolicyListFilter,
  PolicyRepository,
} from '../../../core/policy/application/policy-repository.ts';
import type { Policy } from '../../../core/policy/domain/policy.ts';

/**
 * `PolicyRepository` implementation for unit tests and fast execution.
 *
 * Like the proposal one, it does not simulate transactions, concurrency or
 * database constraints — the policy is stored with its installments as a single
 * object. When the behaviour under test depends on those, the test must use
 * SQLite.
 */
export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly records = new Map<string, Policy>();

  async save(policy: Policy): Promise<void> {
    this.records.set(policy.id, policy);
  }

  async findById(id: string): Promise<Policy | null> {
    return this.records.get(id) ?? null;
  }

  async findByPolicyNumber(policyNumber: string): Promise<Policy | null> {
    return this.find((policy) => policy.policyNumber === policyNumber);
  }

  async findByProposalId(proposalId: string): Promise<Policy | null> {
    return this.find((policy) => policy.proposalId === proposalId);
  }

  /** OUT-03, OUT-04: nearest renewal first, as the port requires. */
  async list(filter: PolicyListFilter): Promise<readonly Policy[]> {
    const { renewalUntil } = filter;

    return [...this.records.values()]
      .filter(
        (policy) =>
          renewalUntil === undefined ||
          // CA-032: the informed day is inside the window, not one day short.
          policy.renewalDate.isBefore(renewalUntil) ||
          policy.renewalDate.equals(renewalUntil),
      )
      .sort((a, b) => {
        const byRenewal = a.renewalDate.toString().localeCompare(b.renewalDate.toString());
        return byRenewal === 0 ? a.id.localeCompare(b.id) : byRenewal;
      });
  }

  private find(matches: (policy: Policy) => boolean): Policy | null {
    for (const policy of this.records.values()) {
      if (matches(policy)) {
        return policy;
      }
    }

    return null;
  }
}
