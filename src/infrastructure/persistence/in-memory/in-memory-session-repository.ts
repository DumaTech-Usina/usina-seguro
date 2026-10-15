import type { SessionRepository } from '../../../core/identity/application/session-repository.ts';
import type { Session } from '../../../core/identity/domain/session.ts';

export class InMemorySessionRepository implements SessionRepository {
  private readonly records = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.records.set(session.id, session);
  }

  async findByTokenDigest(tokenDigest: string): Promise<Session | null> {
    for (const session of this.records.values()) {
      if (session.tokenDigest === tokenDigest) {
        return session;
      }
    }
    return null;
  }
}
