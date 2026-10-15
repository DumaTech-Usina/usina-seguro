import type { DatabaseSync } from 'node:sqlite';
import type { UserRepository } from '../../../core/identity/application/user-repository.ts';
import type { Role } from '../../../core/identity/domain/role.ts';
import { User, type UserStatus } from '../../../core/identity/domain/user.ts';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  password_hash: string;
  status: string;
  failed_login_attempts: number;
  login_suspended_until: string | null;
  created_at: string;
}

export class SqliteUserRepository implements UserRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** The partial unique index refuses a second active user with one e-mail (REQ-421). */
  async save(user: User): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO app_user (id, email, name, role, password_hash, status,
                               failed_login_attempts, login_suspended_until, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email                 = excluded.email,
           name                  = excluded.name,
           role                  = excluded.role,
           password_hash         = excluded.password_hash,
           status                = excluded.status,
           failed_login_attempts = excluded.failed_login_attempts,
           login_suspended_until = excluded.login_suspended_until`,
      )
      .run(
        user.id,
        user.email,
        user.name,
        user.role,
        user.passwordHash,
        user.status,
        user.failedLoginAttempts,
        user.loginSuspendedUntil?.toISOString() ?? null,
        user.createdAt.toISOString(),
      );
  }

  async findById(id: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM app_user WHERE id = ?').get(id) as
      | UserRow
      | undefined;
    return row === undefined ? null : restore(row);
  }

  async findActiveByEmail(email: string): Promise<User | null> {
    const row = this.db
      .prepare(`SELECT * FROM app_user WHERE email = ? AND status = 'ACTIVE'`)
      .get(email) as UserRow | undefined;
    return row === undefined ? null : restore(row);
  }
}

function restore(row: UserRow): User {
  return User.restore({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    passwordHash: row.password_hash,
    status: row.status as UserStatus,
    failedLoginAttempts: row.failed_login_attempts,
    loginSuspendedUntil:
      row.login_suspended_until === null ? null : new Date(row.login_suspended_until),
    createdAt: new Date(row.created_at),
  });
}
