import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import type { User } from '../domain/user.ts';
import type { Actor } from './actor.ts';
import type { UserRepository } from './user-repository.ts';

/**
 * REQ-401: managing users is the administrator's, whatever route the request
 * came by. The HTTP edge refuses it first (REQ-430); this is the rule itself.
 */
export function assertAdministrator(actor: Actor): void {
  if (actor.role !== 'ADMINISTRATOR') {
    throw new BusinessRuleViolation('REQ-401', IDENTITY_MESSAGES.ADMINISTRATOR_ONLY);
  }
}

export async function existingUser(users: UserRepository, id: string): Promise<User> {
  const user = await users.findById(id);
  if (user === null) {
    throw new RecordNotFound(IDENTITY_MESSAGES.USER_NOT_FOUND);
  }
  return user;
}

/**
 * REQ-406: the system never ends up without an active administrator. `after`
 * is the user as the act would leave it.
 */
export async function assertAnAdministratorRemains(
  users: UserRepository,
  after: User,
): Promise<void> {
  const remaining = (await users.list()).filter((user) => {
    const current = user.id === after.id ? after : user;
    return current.status === 'ACTIVE' && current.role === 'ADMINISTRATOR';
  });

  if (remaining.length === 0) {
    throw new BusinessRuleViolation('REQ-406', IDENTITY_MESSAGES.LAST_ADMINISTRATOR);
  }
}
