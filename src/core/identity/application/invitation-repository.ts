import type { Invitation } from '../domain/invitation.ts';

export interface InvitationRepository {
  /** Inserts or replaces the invitation. */
  save(invitation: Invitation): Promise<void>;
  findByTokenDigest(tokenDigest: string): Promise<Invitation | null>;
  /** The invitations of this e-mail, already normalized, still pending (REQ-421). */
  listPendingByEmail(email: string): Promise<readonly Invitation[]>;
  findById(id: string): Promise<Invitation | null>;
  /** Every invitation still pending, expired ones included (REQ-440). */
  listPending(): Promise<readonly Invitation[]>;
}
