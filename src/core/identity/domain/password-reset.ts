export type PasswordResetStatus = 'PENDING' | 'USED' | 'INVALIDATED';

export interface PasswordResetData {
  readonly id: string;
  readonly userId: string;
  readonly tokenDigest: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly status: PasswordResetStatus;
  readonly usedAt: Date | null;
}

import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';

/** REQ-425: the link is valid for 1 hour. */
const VALIDITY_MS = 60 * 60_000;

/**
 * A request to set a new password (REQ-425): a single-use link, sent to the
 * e-mail of an active user. "Expired" is read from the clock, not stored.
 */
export class PasswordReset {
  readonly id: string;
  readonly userId: string;
  readonly tokenDigest: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly status: PasswordResetStatus;
  readonly usedAt: Date | null;

  private constructor(data: PasswordResetData) {
    this.id = data.id;
    this.userId = data.userId;
    this.tokenDigest = data.tokenDigest;
    this.requestedAt = data.requestedAt;
    this.expiresAt = data.expiresAt;
    this.status = data.status;
    this.usedAt = data.usedAt;
  }

  static request(data: {
    id: string;
    userId: string;
    tokenDigest: string;
    requestedAt: Date;
  }): PasswordReset {
    return new PasswordReset({
      ...data,
      expiresAt: new Date(data.requestedAt.getTime() + VALIDITY_MS),
      status: 'PENDING',
      usedAt: null,
    });
  }

  static restore(data: PasswordResetData): PasswordReset {
    return new PasswordReset(data);
  }

  /** REQ-426: the link is used. Expired, used or invalidated — one message for all. */
  use(at: Date): PasswordReset {
    if (this.status !== 'PENDING' || at >= this.expiresAt) {
      throw new BusinessRuleViolation('REQ-426', IDENTITY_MESSAGES.INVALID_LINK);
    }
    return new PasswordReset({ ...this, status: 'USED', usedAt: at });
  }

  /** REQ-426: another link of the same user was used; this one stops working. */
  invalidate(): PasswordReset {
    return this.status === 'PENDING' ? new PasswordReset({ ...this, status: 'INVALIDATED' }) : this;
  }
}
