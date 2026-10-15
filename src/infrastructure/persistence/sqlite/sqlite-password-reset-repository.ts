import type { DatabaseSync } from 'node:sqlite';
import type { PasswordResetRepository } from '../../../core/identity/application/password-reset-repository.ts';
import {
  PasswordReset,
  type PasswordResetStatus,
} from '../../../core/identity/domain/password-reset.ts';

interface PasswordResetRow {
  id: string;
  user_id: string;
  token_digest: string;
  requested_at: string;
  expires_at: string;
  status: string;
  used_at: string | null;
}

export class SqlitePasswordResetRepository implements PasswordResetRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(reset: PasswordReset): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO password_reset (id, user_id, token_digest, requested_at, expires_at, status, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, used_at = excluded.used_at`,
      )
      .run(
        reset.id,
        reset.userId,
        reset.tokenDigest,
        reset.requestedAt.toISOString(),
        reset.expiresAt.toISOString(),
        reset.status,
        reset.usedAt?.toISOString() ?? null,
      );
  }

  async findByTokenDigest(tokenDigest: string): Promise<PasswordReset | null> {
    const row = this.db
      .prepare('SELECT * FROM password_reset WHERE token_digest = ?')
      .get(tokenDigest) as PasswordResetRow | undefined;
    return row === undefined ? null : restore(row);
  }

  async listPendingByUser(userId: string): Promise<readonly PasswordReset[]> {
    const rows = this.db
      .prepare(`SELECT * FROM password_reset WHERE user_id = ? AND status = 'PENDING'`)
      .all(userId) as unknown as PasswordResetRow[];
    return rows.map(restore);
  }
}

function restore(row: PasswordResetRow): PasswordReset {
  return PasswordReset.restore({
    id: row.id,
    userId: row.user_id,
    tokenDigest: row.token_digest,
    requestedAt: new Date(row.requested_at),
    expiresAt: new Date(row.expires_at),
    status: row.status as PasswordResetStatus,
    usedAt: row.used_at === null ? null : new Date(row.used_at),
  });
}
