import type { RoleChangeRepository } from '../../../core/identity/application/role-change-repository.ts';
import type { RoleChange } from '../../../core/identity/domain/role-change.ts';

export class InMemoryRoleChangeRepository implements RoleChangeRepository {
  private readonly records: RoleChange[] = [];

  async save(change: RoleChange): Promise<void> {
    this.records.push(change);
  }

  async listByUser(userId: string): Promise<readonly RoleChange[]> {
    return this.records.filter((change) => change.userId === userId);
  }
}
