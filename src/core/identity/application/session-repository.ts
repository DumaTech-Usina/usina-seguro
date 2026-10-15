import type { Session } from '../domain/session.ts';

export interface SessionRepository {
  /** Inserts or replaces the session. */
  save(session: Session): Promise<void>;
  findByTokenDigest(tokenDigest: string): Promise<Session | null>;
  /** The sessions of the user that have not ended yet (REQ-403, REQ-426). */
  listOpenByUser(userId: string): Promise<readonly Session[]>;
}
