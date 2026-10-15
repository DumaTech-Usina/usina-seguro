import type { Session } from '../domain/session.ts';

export interface SessionRepository {
  /** Inserts or replaces the session. */
  save(session: Session): Promise<void>;
  findByTokenDigest(tokenDigest: string): Promise<Session | null>;
}
