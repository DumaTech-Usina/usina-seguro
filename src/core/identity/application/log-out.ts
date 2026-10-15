import type { SecretGenerator } from './secret-generator.ts';
import type { SessionRepository } from './session-repository.ts';

export interface LogOutDependencies {
  readonly sessions: SessionRepository;
  readonly secrets: SecretGenerator;
  readonly now: () => Date;
}

/**
 * REQ-411: the logout ends the session on the server, not only on the screen.
 *
 * A token that matches no session is nothing to end: the logout answers the
 * same, so it cannot be used to probe which tokens exist.
 */
export class LogOut {
  private readonly deps: LogOutDependencies;

  constructor(deps: LogOutDependencies) {
    this.deps = deps;
  }

  async execute(input: { token: string }): Promise<void> {
    const session = await this.deps.sessions.findByTokenDigest(
      this.deps.secrets.digest(input.token),
    );

    if (session !== null) {
      await this.deps.sessions.save(session.end(this.deps.now()));
    }
  }
}
