import type { DatabaseSync } from 'node:sqlite';
import type { InvitationRepository } from '../../../core/identity/application/invitation-repository.ts';
import { Invitation, type InvitationStatus } from '../../../core/identity/domain/invitation.ts';
import type { Role } from '../../../core/identity/domain/role.ts';

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  token_digest: string;
  invited_by: string | null;
  invited_at: string;
  expires_at: string;
  status: string;
  accepted_at: string | null;
}

export class SqliteInvitationRepository implements InvitationRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(invitation: Invitation): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_invitation (id, email, role, token_digest, invited_by,
                                      invited_at, expires_at, status, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status      = excluded.status,
           accepted_at = excluded.accepted_at`,
      )
      .run(
        invitation.id,
        invitation.email,
        invitation.role,
        invitation.tokenDigest,
        invitation.invitedBy,
        invitation.invitedAt.toISOString(),
        invitation.expiresAt.toISOString(),
        invitation.status,
        invitation.acceptedAt?.toISOString() ?? null,
      );
  }

  async findByTokenDigest(tokenDigest: string): Promise<Invitation | null> {
    const row = this.db
      .prepare('SELECT * FROM user_invitation WHERE token_digest = ?')
      .get(tokenDigest) as InvitationRow | undefined;
    return row === undefined ? null : restore(row);
  }

  async listPendingByEmail(email: string): Promise<readonly Invitation[]> {
    const rows = this.db
      .prepare(`SELECT * FROM user_invitation WHERE email = ? AND status = 'PENDING'`)
      .all(email) as unknown as InvitationRow[];
    return rows.map(restore);
  }
}

function restore(row: InvitationRow): Invitation {
  return Invitation.restore({
    id: row.id,
    email: row.email,
    role: row.role as Role,
    tokenDigest: row.token_digest,
    invitedBy: row.invited_by,
    invitedAt: new Date(row.invited_at),
    expiresAt: new Date(row.expires_at),
    status: row.status as InvitationStatus,
    acceptedAt: row.accepted_at === null ? null : new Date(row.accepted_at),
  });
}
