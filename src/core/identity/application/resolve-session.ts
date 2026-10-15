import type { SecretGenerator } from './secret-generator.ts';
import type { SessionRepository } from './session-repository.ts';
import type { UserRepository } from './user-repository.ts';
import { type UserView, toUserView } from './user-view.ts';

export interface ResolveSessionDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly secrets: SecretGenerator;
  readonly now: () => Date;
}

/**
 * Who is behind a session token, or `null` (REQ-410, REQ-431).
 *
 * `null` covers every way a session stops counting: unknown, ended by a
 * logout, 12 hours old (REQ-412), or belonging to a user no longer active
 * (REQ-403). The user is read on every call, so a change of role is in force
 * from the next operation (REQ-404).
 */
export class ResolveSession {
  private readonly deps: ResolveSessionDependencies;

  constructor(deps: ResolveSessionDependencies) {
    this.deps = deps;
  }

  async execute(input: { token: string }): Promise<UserView | null> {
    const session = await this.deps.sessions.findByTokenDigest(
      this.deps.secrets.digest(input.token),
    );

    if (session === null || !session.isActiveAt(this.deps.now())) {
      return null;
    }

    const user = await this.deps.users.findById(session.userId);

    return user === null || user.status !== 'ACTIVE' ? null : toUserView(user);
  }
}
