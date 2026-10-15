import type { DatabaseSync } from 'node:sqlite';
import type { RoleChangeRepository } from '../../../core/identity/application/role-change-repository.ts';
import type { RoleChange } from '../../../core/identity/domain/role-change.ts';
import type { Role } from '../../../core/identity/domain/role.ts';

interface RoleChangeRow {
  id: string;
  user_id: string;
  previous_role: string;
  new_role: string;
  changed_by: string;
  changed_at: string;
}

export class SqliteRoleChangeRepository implements RoleChangeRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(change: RoleChange): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_role_change (id, user_id, previous_role, new_role, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        change.id,
        change.userId,
        change.previousRole,
        change.newRole,
        change.changedBy,
        change.changedAt.toISOString(),
      );
  }

  async listByUser(userId: string): Promise<readonly RoleChange[]> {
    const rows = this.db
      .prepare('SELECT * FROM user_role_change WHERE user_id = ? ORDER BY changed_at, id')
      .all(userId) as unknown as RoleChangeRow[];

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      previousRole: row.previous_role as Role,
      newRole: row.new_role as Role,
      changedBy: row.changed_by,
      changedAt: new Date(row.changed_at),
    }));
  }
}
