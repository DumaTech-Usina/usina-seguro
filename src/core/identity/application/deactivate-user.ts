import type { Actor } from './actor.ts';
import { assertAdministrator, assertAnAdministratorRemains, existingUser } from './authorize.ts';
import type { ManagedUserView } from './list-users.ts';
import type { SessionRepository } from './session-repository.ts';
import type { UserRepository } from './user-repository.ts';

export interface DeactivateUserDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly now: () => Date;
}

/**
 * REQ-403: the user no longer enters, and every session of theirs ends at
 * once. Never erased. REQ-406: not the last active administrator.
 */
export class DeactivateUser {
  private readonly deps: DeactivateUserDependencies;

  constructor(deps: DeactivateUserDependencies) {
    this.deps = deps;
  }

  async execute(input: { actor: Actor; userId: string }): Promise<ManagedUserView> {
    assertAdministrator(input.actor);

    const deactivated = (await existingUser(this.deps.users, input.userId)).deactivate();
    await assertAnAdministratorRemains(this.deps.users, deactivated);

    const now = this.deps.now();
    await this.deps.users.save(deactivated);
    for (const session of await this.deps.sessions.listOpenByUser(deactivated.id)) {
      await this.deps.sessions.save(session.end(now));
    }

    return {
      id: deactivated.id,
      email: deactivated.email,
      name: deactivated.name,
      role: deactivated.role,
      status: deactivated.status,
      displayName: deactivated.displayName,
    };
  }
}
