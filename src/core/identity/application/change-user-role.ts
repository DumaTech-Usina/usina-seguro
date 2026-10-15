import type { Role } from '../domain/role.ts';
import type { Actor } from './actor.ts';
import { assertAdministrator, assertAnAdministratorRemains, existingUser } from './authorize.ts';
import type { ManagedUserView } from './list-users.ts';
import type { RoleChangeRepository } from './role-change-repository.ts';
import type { UserRepository } from './user-repository.ts';

export interface ChangeUserRoleDependencies {
  readonly users: UserRepository;
  readonly roleChanges: RoleChangeRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-404: the role changes, recording who, when, the previous and the new
 * one; it is in force at the user's next operation, since every operation
 * reads the user again. REQ-406: never the last active administrator.
 */
export class ChangeUserRole {
  private readonly deps: ChangeUserRoleDependencies;

  constructor(deps: ChangeUserRoleDependencies) {
    this.deps = deps;
  }

  async execute(input: { actor: Actor; userId: string; role: Role }): Promise<ManagedUserView> {
    assertAdministrator(input.actor);

    const user = await existingUser(this.deps.users, input.userId);
    const changed = user.changeRole(input.role);

    if (user.role !== input.role) {
      await assertAnAdministratorRemains(this.deps.users, changed);
      await this.deps.users.save(changed);
      await this.deps.roleChanges.save({
        id: this.deps.newId(),
        userId: user.id,
        previousRole: user.role,
        newRole: input.role,
        changedBy: input.actor.id,
        changedAt: this.deps.now(),
      });
    }

    return {
      id: changed.id,
      email: changed.email,
      name: changed.name,
      role: changed.role,
      status: changed.status,
      displayName: changed.displayName,
    };
  }
}
