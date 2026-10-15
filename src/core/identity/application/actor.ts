import type { Role } from '../domain/role.ts';

/** Who acts on a management operation: the session's user (REQ-216). */
export interface Actor {
  readonly id: string;
  readonly role: Role;
}
