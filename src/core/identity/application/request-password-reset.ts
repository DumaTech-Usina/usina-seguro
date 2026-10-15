import { PasswordReset } from '../domain/password-reset.ts';
import { normalizeEmail } from '../domain/user.ts';
import type { AccessMailer } from './access-mailer.ts';
import type { PasswordResetRepository } from './password-reset-repository.ts';
import type { SecretGenerator } from './secret-generator.ts';
import type { UserRepository } from './user-repository.ts';

export interface RequestPasswordResetDependencies {
  readonly users: UserRepository;
  readonly resets: PasswordResetRepository;
  readonly secrets: SecretGenerator;
  readonly mailer: AccessMailer;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-425: "Esqueci a senha". Answers nothing either way, so whoever asks
 * cannot tell whether the e-mail has an account (REJ-406). Only an active user
 * gets the e-mail, with a single-use link valid for 1 hour; only its digest is
 * kept (REQ-416).
 */
export class RequestPasswordReset {
  private readonly deps: RequestPasswordResetDependencies;

  constructor(deps: RequestPasswordResetDependencies) {
    this.deps = deps;
  }

  async execute(input: { email: string }): Promise<void> {
    if (input.email.trim() === '') {
      return;
    }

    const user = await this.deps.users.findActiveByEmail(normalizeEmail(input.email));
    if (user === null) {
      return;
    }

    const token = this.deps.secrets.generate();
    const reset = PasswordReset.request({
      id: this.deps.newId(),
      userId: user.id,
      tokenDigest: this.deps.secrets.digest(token),
      requestedAt: this.deps.now(),
    });

    await this.deps.resets.save(reset);
    await this.deps.mailer.sendPasswordReset({
      to: user.email,
      token,
      expiresAt: reset.expiresAt.toISOString(),
    });
  }
}
