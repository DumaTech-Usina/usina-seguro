import type { Role } from '../domain/role.ts';
import type { User } from '../domain/user.ts';

/**
 * A user as it leaves the core. Nothing secret is in it: no password hash, no
 * count of failures (REQ-416).
 */
export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  /** REQ-400: the name, or the e-mail when there is none. */
  readonly displayName: string;
}

export function toUserView(user: User): UserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    displayName: user.displayName,
  };
}
