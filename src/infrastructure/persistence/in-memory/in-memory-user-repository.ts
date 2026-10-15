import type { UserRepository } from '../../../core/identity/application/user-repository.ts';
import type { User } from '../../../core/identity/domain/user.ts';

export class InMemoryUserRepository implements UserRepository {
  private readonly records = new Map<string, User>();

  /** Refuses a second active user with one e-mail, as the SQLite index does (REQ-421). */
  async save(user: User): Promise<void> {
    if (user.status === 'ACTIVE') {
      const active = await this.findActiveByEmail(user.email);
      if (active !== null && active.id !== user.id) {
        throw new Error(`An active user already has the e-mail ${user.email}.`);
      }
    }
    this.records.set(user.id, user);
  }

  async findById(id: string): Promise<User | null> {
    return this.records.get(id) ?? null;
  }

  async findActiveByEmail(email: string): Promise<User | null> {
    for (const user of this.records.values()) {
      if (user.status === 'ACTIVE' && user.email === email) {
        return user;
      }
    }
    return null;
  }

  async list(): Promise<readonly User[]> {
    return [...this.records.values()];
  }
}
