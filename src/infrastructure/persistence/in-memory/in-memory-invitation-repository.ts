import type { InvitationRepository } from '../../../core/identity/application/invitation-repository.ts';
import type { Invitation } from '../../../core/identity/domain/invitation.ts';

export class InMemoryInvitationRepository implements InvitationRepository {
  private readonly records = new Map<string, Invitation>();

  async save(invitation: Invitation): Promise<void> {
    this.records.set(invitation.id, invitation);
  }

  async findByTokenDigest(tokenDigest: string): Promise<Invitation | null> {
    for (const invitation of this.records.values()) {
      if (invitation.tokenDigest === tokenDigest) {
        return invitation;
      }
    }
    return null;
  }

  async listPendingByEmail(email: string): Promise<readonly Invitation[]> {
    return [...this.records.values()].filter(
      (invitation) => invitation.status === 'PENDING' && invitation.email === email,
    );
  }
}
