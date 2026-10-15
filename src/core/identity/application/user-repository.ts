import type { User } from '../domain/user.ts';

export interface UserRepository {
  /** Inserts or replaces the user. Two active users with one e-mail are refused (REQ-421). */
  save(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  /** The active user with this e-mail, already normalized; a deactivated one is never answered. */
  findActiveByEmail(email: string): Promise<User | null>;
}
