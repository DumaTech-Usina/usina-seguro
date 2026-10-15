import type { DatabaseSync } from 'node:sqlite';
import type { SessionRepository } from '../../../core/identity/application/session-repository.ts';
import { Session } from '../../../core/identity/domain/session.ts';

interface SessionRow {
  id: string;
  token_digest: string;
  user_id: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(session: Session): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_session (id, token_digest, user_id, started_at, expires_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at`,
      )
      .run(
        session.id,
        session.tokenDigest,
        session.userId,
        session.startedAt.toISOString(),
        session.expiresAt.toISOString(),
        session.endedAt?.toISOString() ?? null,
      );
  }

  async findByTokenDigest(tokenDigest: string): Promise<Session | null> {
    const row = this.db
      .prepare('SELECT * FROM user_session WHERE token_digest = ?')
      .get(tokenDigest) as SessionRow | undefined;
    return row === undefined ? null : restore(row);
  }

  async listOpenByUser(userId: string): Promise<readonly Session[]> {
    const rows = this.db
      .prepare('SELECT * FROM user_session WHERE user_id = ? AND ended_at IS NULL')
      .all(userId) as unknown as SessionRow[];
    return rows.map(restore);
  }
}

function restore(row: SessionRow): Session {
  return Session.restore({
    id: row.id,
    tokenDigest: row.token_digest,
    userId: row.user_id,
    startedAt: new Date(row.started_at),
    expiresAt: new Date(row.expires_at),
    endedAt: row.ended_at === null ? null : new Date(row.ended_at),
  });
}
