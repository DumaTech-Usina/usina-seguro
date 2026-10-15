/**
 * The two roles of REQ-401, one per user (Q-411).
 *
 * `USER` runs every business operation and every query; `ADMINISTRATOR` does
 * the same and also manages users.
 */
export type Role = 'ADMINISTRATOR' | 'USER';

export const ROLES: readonly Role[] = ['ADMINISTRATOR', 'USER'];
