import type { RoleChange } from '../domain/role-change.ts';

export interface RoleChangeRepository {
  save(change: RoleChange): Promise<void>;
  /** The changes of one user, oldest first. */
  listByUser(userId: string): Promise<readonly RoleChange[]>;
}
