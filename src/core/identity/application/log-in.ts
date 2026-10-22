import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { Session } from '../domain/session.ts';
import { normalizeEmail } from '../domain/user.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { SecretGenerator } from './secret-generator.ts';
import type { SessionRepository } from './session-repository.ts';
import type { UserRepository } from './user-repository.ts';
import { type UserView, toUserView } from './user-view.ts';

/** The token goes into the cookie, once; the core keeps only its digest. */
export interface OpenedSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: UserView;
}

export interface LogInDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly secrets: SecretGenerator;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-411: the login, by e-mail and password, opens a session.
 *
 * REQ-413: an unknown e-mail, a wrong password, a deactivated user and a
 * suspended login are all refused with the one same violation. An unknown
 * e-mail still spends a hash, so the time taken does not tell it apart either.
 */
export class LogIn {
  private readonly deps: LogInDependencies;

  constructor(deps: LogInDependencies) {
    this.deps = deps;
  }

  async execute(input: { email: string; password: string }): Promise<OpenedSession> {
    const now = this.deps.now();
    // An empty e-mail is one more login refused (REQ-413), not a missing field.
    const user =
      input.email.trim() === ''
        ? null
        : await this.deps.users.findActiveByEmail(normalizeEmail(input.email));

    if (user === null) {
      await this.deps.hasher.hash(input.password);
      throw refused();
    }

    // REQ-414: while suspended, not even the right password opens a session,
    // and the attempt does not count towards a new series.
    if (user.isLoginSuspendedAt(now)) {
      throw refused();
    }

    const verified = await this.deps.hasher.verify(input.password, user.passwordHash);

    // Other requests ran while the hash was computed: what is written comes
    // from the user as it is now, so a failure counted, a suspension or a
    // deactivation made meanwhile is never overwritten (REQ-403, REQ-414).
    const current = await this.deps.users.findById(user.id);
    if (current === null || current.status !== 'ACTIVE' || current.isLoginSuspendedAt(now)) {
      throw refused();
    }

    if (!verified) {
      await this.deps.users.save(current.recordFailedLogin(now));
      throw refused();
    }

    const loggedIn = current.recordSuccessfulLogin();
    const token = this.deps.secrets.generate();
    const session = Session.start({
      id: this.deps.newId(),
      tokenDigest: this.deps.secrets.digest(token),
      userId: user.id,
      startedAt: now,
    });

    await this.deps.users.save(loggedIn);
    await this.deps.sessions.save(session);

    return { token, expiresAt: session.expiresAt.toISOString(), user: toUserView(loggedIn) };
  }
}

function refused(): BusinessRuleViolation {
  return new BusinessRuleViolation('REQ-413', IDENTITY_MESSAGES.LOGIN_REFUSED);
}
