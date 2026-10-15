import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { assertPasswordPolicy } from '../domain/password-policy.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { PasswordResetRepository } from './password-reset-repository.ts';
import type { SecretGenerator } from './secret-generator.ts';
import type { SessionRepository } from './session-repository.ts';
import type { Transaction } from './transaction.ts';
import type { UserRepository } from './user-repository.ts';

export interface ResetPasswordDependencies {
  readonly users: UserRepository;
  readonly resets: PasswordResetRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly secrets: SecretGenerator;
  readonly transaction: Transaction;
  readonly now: () => Date;
}

/**
 * REQ-426: through the link, the user sets a new password. The link stops
 * working, so does every other pending link of the user, and every session of
 * theirs ends. A link that does not work gets one message, whatever the reason
 * (REQ-422). The link is checked before the password, and a refused password
 * leaves the link usable.
 */
export class ResetPassword {
  private readonly deps: ResetPasswordDependencies;

  constructor(deps: ResetPasswordDependencies) {
    this.deps = deps;
  }

  async execute(input: { token: string; password: string }): Promise<void> {
    const now = this.deps.now();
    const reset = await this.deps.resets.findByTokenDigest(this.deps.secrets.digest(input.token));
    if (reset === null) {
      throw invalidLink();
    }

    const used = reset.use(now);
    assertPasswordPolicy(input.password);

    const user = await this.deps.users.findById(reset.userId);
    if (user === null || user.status !== 'ACTIVE') {
      throw invalidLink();
    }
    const changed = user.changePassword(await this.deps.hasher.hash(input.password));

    await this.deps.transaction.run(async () => {
      await this.deps.users.save(changed);
      await this.deps.resets.save(used);
      for (const other of await this.deps.resets.listPendingByUser(user.id)) {
        await this.deps.resets.save(other.invalidate());
      }
      for (const session of await this.deps.sessions.listOpenByUser(user.id)) {
        await this.deps.sessions.save(session.end(now));
      }
    });
  }
}

function invalidLink(): BusinessRuleViolation {
  return new BusinessRuleViolation('REQ-426', IDENTITY_MESSAGES.INVALID_LINK);
}
