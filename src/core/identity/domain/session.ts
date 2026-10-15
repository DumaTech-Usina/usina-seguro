export interface SessionData {
  readonly id: string;
  /** What `SecretGenerator.digest` answered for the cookie's token (REQ-416). */
  readonly tokenDigest: string;
  readonly userId: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
}

/** REQ-412: 12 hours after the login, whatever the use in between. */
const DURATION_MS = 12 * 3_600_000;

/**
 * The access a login opens (REQ-411, REQ-412), kept on the server so that a
 * logout, a password reset or a deactivation ends it for real.
 */
export class Session {
  readonly id: string;
  readonly tokenDigest: string;
  readonly userId: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;

  private constructor(data: SessionData) {
    this.id = data.id;
    this.tokenDigest = data.tokenDigest;
    this.userId = data.userId;
    this.startedAt = data.startedAt;
    this.expiresAt = data.expiresAt;
    this.endedAt = data.endedAt;
  }

  static start(data: {
    id: string;
    tokenDigest: string;
    userId: string;
    startedAt: Date;
  }): Session {
    return new Session({
      ...data,
      expiresAt: new Date(data.startedAt.getTime() + DURATION_MS),
      endedAt: null,
    });
  }

  /** Rebuilds a persisted session without re-applying the rules. */
  static restore(data: SessionData): Session {
    return new Session(data);
  }

  isActiveAt(at: Date): boolean {
    return this.endedAt === null && at < this.expiresAt;
  }

  /** Ends the session; ending it again keeps the first ending. */
  end(at: Date): Session {
    if (this.endedAt !== null) {
      return this;
    }

    return new Session({ ...this, endedAt: at });
  }
}
