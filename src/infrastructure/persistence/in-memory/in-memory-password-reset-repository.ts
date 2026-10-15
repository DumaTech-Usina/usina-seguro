import type { PasswordResetRepository } from '../../../core/identity/application/password-reset-repository.ts';
import type { PasswordReset } from '../../../core/identity/domain/password-reset.ts';

export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  private readonly records = new Map<string, PasswordReset>();

  async save(reset: PasswordReset): Promise<void> {
    this.records.set(reset.id, reset);
  }

  async findByTokenDigest(tokenDigest: string): Promise<PasswordReset | null> {
    for (const reset of this.records.values()) {
      if (reset.tokenDigest === tokenDigest) {
        return reset;
      }
    }
    return null;
  }

  async listPendingByUser(userId: string): Promise<readonly PasswordReset[]> {
    return [...this.records.values()].filter(
      (reset) => reset.userId === userId && reset.status === 'PENDING',
    );
  }
}
