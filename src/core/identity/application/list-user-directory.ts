import type { UserRepository } from './user-repository.ts';

/** A user as a signature shows it: the id the records keep and the name to read. */
export interface UserDirectoryEntry {
  readonly id: string;
  readonly displayName: string;
}

export interface ListUserDirectoryDependencies {
  readonly users: UserRepository;
}

/**
 * REQ-216: a signed act keeps the id of its author, and is shown by the name
 * — or the e-mail, without one (REQ-400). This is the reading that turns one
 * into the other, for any logged-in user (Q-412).
 *
 * Every user is in it, deactivated ones too: what they signed stays on the
 * records (REQ-403, REQ-124) and still has to say who. Nothing else of a user
 * is exposed here.
 */
export class ListUserDirectory {
  private readonly deps: ListUserDirectoryDependencies;

  constructor(deps: ListUserDirectoryDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly UserDirectoryEntry[]> {
    const users = await this.deps.users.list();

    return users
      .map((user) => ({ id: user.id, displayName: user.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  }
}
