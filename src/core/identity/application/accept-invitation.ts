import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { assertPasswordPolicy } from '../domain/password-policy.ts';
import { User } from '../domain/user.ts';
import type { InvitationRepository } from './invitation-repository.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { SecretGenerator } from './secret-generator.ts';
import type { Transaction } from './transaction.ts';
import type { UserRepository } from './user-repository.ts';
import { type UserView, toUserView } from './user-view.ts';

export interface AcceptInvitationInput {
  readonly token: string;
  readonly password: string;
  /** REQ-400: optional; without it the user is shown by the e-mail. */
  readonly name?: string | null;
}

export interface AcceptInvitationDependencies {
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
  readonly hasher: PasswordHasher;
  readonly secrets: SecretGenerator;
  readonly transaction: Transaction;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-422: through the link, the person sets the password and, if they want,
 * the name; the user is created active with the invitation's role.
 *
 * The link is checked before the password, so a dead link is said to be dead
 * whatever was typed; and a refused password leaves the link usable. Nobody
 * is logged in here: the person logs in afterwards, like every other time.
 */
export class AcceptInvitation {
  private readonly deps: AcceptInvitationDependencies;

  constructor(deps: AcceptInvitationDependencies) {
    this.deps = deps;
  }

  async execute(input: AcceptInvitationInput): Promise<UserView> {
    const now = this.deps.now();
    const invitation = await this.deps.invitations.findByTokenDigest(
      this.deps.secrets.digest(input.token),
    );

    if (invitation === null) {
      throw new BusinessRuleViolation('REQ-422', IDENTITY_MESSAGES.INVALID_LINK);
    }

    const accepted = invitation.accept(now);
    assertPasswordPolicy(input.password);

    // REQ-421: another invitation for the same e-mail would have superseded
    // this one, so an active user here is one that appeared some other way.
    if ((await this.deps.users.findActiveByEmail(invitation.email)) !== null) {
      throw new BusinessRuleViolation('REQ-421', IDENTITY_MESSAGES.EMAIL_ALREADY_ACTIVE);
    }

    const user = User.create({
      id: this.deps.newId(),
      email: invitation.email,
      name: input.name ?? null,
      role: invitation.role,
      passwordHash: await this.deps.hasher.hash(input.password),
      createdAt: now,
    });

    await this.deps.transaction.run(async () => {
      await this.deps.users.save(user);
      await this.deps.invitations.save(accepted);
    });

    return toUserView(user);
  }
}
