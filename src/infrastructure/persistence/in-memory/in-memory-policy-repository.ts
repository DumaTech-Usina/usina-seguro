import type { PolicyRepository } from '../../../core/policy/application/policy-repository.ts';
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
}
