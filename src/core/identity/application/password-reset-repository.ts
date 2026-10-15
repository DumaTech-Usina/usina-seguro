import type { PasswordReset } from '../domain/password-reset.ts';

export interface PasswordResetRepository {
  /** Inserts or replaces the reset. */
  save(reset: PasswordReset): Promise<void>;
  findByTokenDigest(tokenDigest: string): Promise<PasswordReset | null>;
  /** The resets of the user still pending (REQ-426). */
  listPendingByUser(userId: string): Promise<readonly PasswordReset[]>;
}
