import type { Role } from './role.ts';

/** REQ-404: a change of role, as it was recorded. Nothing changes it afterwards. */
export interface RoleChange {
  readonly id: string;
  readonly userId: string;
  readonly previousRole: Role;
  readonly newRole: Role;
  /** Who changed it: the id of the administrator (REQ-216). */
  readonly changedBy: string;
  readonly changedAt: Date;
}
