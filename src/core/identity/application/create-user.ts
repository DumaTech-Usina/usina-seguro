import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { assertPasswordPolicy } from '../domain/password-policy.ts';
import type { Role } from '../domain/role.ts';
import { User, normalizeEmail } from '../domain/user.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { UserRepository } from './user-repository.ts';
import { type UserView, toUserView } from './user-view.ts';

export interface CreateUserInput {
  readonly email: string;
  readonly password: string;
  readonly role: Role;
  readonly name: string | null;
}

export interface CreateUserDependencies {
  readonly users: UserRepository;
  readonly hasher: PasswordHasher;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-407: a user created by a command on the server, with its password,
 * without an invitation. The same rules as the acceptance of an invitation:
 * the password policy (REQ-415) and one active user per e-mail (REQ-421).
 */
export class CreateUser {
  private readonly deps: CreateUserDependencies;

  constructor(deps: CreateUserDependencies) {
    this.deps = deps;
  }

  async execute(input: CreateUserInput): Promise<UserView> {
    const email = normalizeEmail(input.email);
    assertPasswordPolicy(input.password);

    if ((await this.deps.users.findActiveByEmail(email)) !== null) {
      throw new BusinessRuleViolation('REQ-421', IDENTITY_MESSAGES.EMAIL_ALREADY_ACTIVE);
    }

    const user = User.create({
      id: this.deps.newId(),
      email,
      name: input.name,
      role: input.role,
      passwordHash: await this.deps.hasher.hash(input.password),
      createdAt: this.deps.now(),
    });
    await this.deps.users.save(user);

    return toUserView(user);
  }
}
