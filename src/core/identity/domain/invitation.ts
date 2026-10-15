import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';
import type { Role } from './role.ts';
import { normalizeEmail } from './user.ts';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'SUPERSEDED';

export interface InvitationData {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  /** What `SecretGenerator.digest` answered for the link's token (REQ-416). */
  readonly tokenDigest: string;
  /** Who invited (REQ-420); `null` for the first administrator, born of a command (REQ-405). */
  readonly invitedBy: string | null;
  readonly invitedAt: Date;
  readonly expiresAt: Date;
  readonly status: InvitationStatus;
  readonly acceptedAt: Date | null;
}

/** REQ-420: the link is valid for 72 hours. */
const VALIDITY_MS = 72 * 3_600_000;

/**
 * An invitation to the system (REQ-420): a single-use link, for one e-mail and
 * one role.
 *
 * "Expired" is not a status: it is read from the clock, so nothing has to run
 * when the 72 hours are over.
 */
export class Invitation {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly tokenDigest: string;
  readonly invitedBy: string | null;
  readonly invitedAt: Date;
  readonly expiresAt: Date;
  readonly status: InvitationStatus;
  readonly acceptedAt: Date | null;

  private constructor(data: InvitationData) {
    this.id = data.id;
    this.email = data.email;
    this.role = data.role;
    this.tokenDigest = data.tokenDigest;
    this.invitedBy = data.invitedBy;
    this.invitedAt = data.invitedAt;
    this.expiresAt = data.expiresAt;
    this.status = data.status;
    this.acceptedAt = data.acceptedAt;
  }

  static issue(data: {
    id: string;
    email: string;
    role: Role;
    tokenDigest: string;
    invitedBy: string | null;
    invitedAt: Date;
  }): Invitation {
    return new Invitation({
      ...data,
      email: normalizeEmail(data.email),
      expiresAt: new Date(data.invitedAt.getTime() + VALIDITY_MS),
      status: 'PENDING',
      acceptedAt: null,
    });
  }

  /** Rebuilds a persisted invitation without re-applying the rules (REQ-124). */
  static restore(data: InvitationData): Invitation {
    return new Invitation(data);
  }

  /**
   * REQ-422: the link is used. Expired, already used or superseded — the person
   * is told none of these apart, only that the link is not valid.
   */
  accept(at: Date): Invitation {
    if (this.status !== 'PENDING' || at >= this.expiresAt) {
      throw new BusinessRuleViolation('REQ-422', IDENTITY_MESSAGES.INVALID_LINK);
    }

    return new Invitation({ ...this, status: 'ACCEPTED', acceptedAt: at });
  }

  /** REQ-421: a newer invitation for the same e-mail; this one stops working. */
  supersede(): Invitation {
    if (this.status !== 'PENDING') {
      return this;
    }

    return new Invitation({ ...this, status: 'SUPERSEDED' });
  }
}
