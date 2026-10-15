import type { Role } from '../domain/role.ts';
import type { UserStatus } from '../domain/user.ts';
import type { Actor } from './actor.ts';
import { assertAdministrator } from './authorize.ts';
import type { InvitationRepository } from './invitation-repository.ts';
import type { UserRepository } from './user-repository.ts';

export interface ManagedUserView {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  readonly status: UserStatus;
  readonly displayName: string;
}

export interface PendingInvitationView {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  /** Past it, the link no longer works; the invitation can still be resent. */
  readonly expiresAt: string;
}

export interface UserListing {
  readonly users: readonly ManagedUserView[];
  readonly invitations: readonly PendingInvitationView[];
}

export interface ListUsersDependencies {
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
}

/**
 * REQ-440: the users, with name, e-mail, role and situation, and the
 * invitations still pending. Nothing secret leaves (REQ-416).
 */
export class ListUsers {
  private readonly deps: ListUsersDependencies;

  constructor(deps: ListUsersDependencies) {
    this.deps = deps;
  }

  async execute(input: { actor: Actor }): Promise<UserListing> {
    assertAdministrator(input.actor);

    const users = [...(await this.deps.users.list())]
      .map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        displayName: user.displayName,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));

    const invitations = [...(await this.deps.invitations.listPending())]
      .map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
      }))
      .sort((a, b) => a.email.localeCompare(b.email));

    return { users, invitations };
  }
}
