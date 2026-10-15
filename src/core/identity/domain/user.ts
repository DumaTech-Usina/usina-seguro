import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';
import type { Role } from './role.ts';

export type UserStatus = 'ACTIVE' | 'DEACTIVATED';

export interface UserData {
  readonly id: string;
  /** The login (REQ-400), already normalized by `normalizeEmail`. */
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  /** What `PasswordHasher` answered; never the password (REQ-416). */
  readonly passwordHash: string;
  readonly status: UserStatus;
  /** Failures in a row since the last success or the last suspension (REQ-414). */
  readonly failedLoginAttempts: number;
  readonly loginSuspendedUntil: Date | null;
  readonly createdAt: Date;
}

/** REQ-414: five failures in a row suspend the account's login for 15 minutes. */
const MAX_FAILED_LOGINS = 5;
const LOGIN_SUSPENSION_MS = 15 * 60_000;

/**
 * The e-mail as the login is compared: trimmed and in lower case, so the same
 * address typed with another case is the same person (REQ-400, REQ-421).
 */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (normalized === '') {
    throw new BusinessRuleViolation('REQ-400', IDENTITY_MESSAGES.EMAIL_REQUIRED);
  }

  return normalized;
}

/**
 * A person of the Usina with access to the system (REQ-400).
 *
 * Referenced by `id` — the signatures keep the id (REQ-216) — and shown by the
 * name, or by the e-mail when there is none. Never erased: a user who leaves is
 * deactivated (REQ-403).
 */
export class User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly failedLoginAttempts: number;
  readonly loginSuspendedUntil: Date | null;
  readonly createdAt: Date;

  private constructor(data: UserData) {
    this.id = data.id;
    this.email = data.email;
    this.name = data.name;
    this.role = data.role;
    this.passwordHash = data.passwordHash;
    this.status = data.status;
    this.failedLoginAttempts = data.failedLoginAttempts;
    this.loginSuspendedUntil = data.loginSuspendedUntil;
    this.createdAt = data.createdAt;
  }

  /** REQ-422: the user an accepted invitation creates, active. */
  static create(data: {
    id: string;
    email: string;
    name: string | null;
    role: Role;
    passwordHash: string;
    createdAt: Date;
  }): User {
    const name = data.name?.trim() || null;

    return new User({
      id: data.id,
      email: normalizeEmail(data.email),
      name,
      role: data.role,
      passwordHash: data.passwordHash,
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      loginSuspendedUntil: null,
      createdAt: data.createdAt,
    });
  }

  /** Rebuilds a persisted user without re-applying the rules (REQ-124). */
  static restore(data: UserData): User {
    return new User(data);
  }

  /** REQ-400: the name, or the e-mail when there is none. */
  get displayName(): string {
    return this.name ?? this.email;
  }

  /** REQ-414. */
  isLoginSuspendedAt(at: Date): boolean {
    return this.loginSuspendedUntil !== null && at < this.loginSuspendedUntil;
  }

  /**
   * REQ-414: one more failure in a row. The fifth suspends the login for 15
   * minutes and starts a new series, so the person gets five attempts again
   * once the suspension is over instead of being suspended at the first slip.
   */
  recordFailedLogin(at: Date): User {
    const attempts = this.failedLoginAttempts + 1;

    if (attempts >= MAX_FAILED_LOGINS) {
      return new User({
        ...this.toData(),
        failedLoginAttempts: 0,
        loginSuspendedUntil: new Date(at.getTime() + LOGIN_SUSPENSION_MS),
      });
    }

    return new User({ ...this.toData(), failedLoginAttempts: attempts });
  }

  /** REQ-403: no longer enters; never erased — the signatures keep its id. */
  deactivate(): User {
    return new User({ ...this.toData(), status: 'DEACTIVATED' });
  }

  /** REQ-404. Who may change it, and the last administrator, are the use case's to check. */
  changeRole(role: Role): User {
    return new User({ ...this.toData(), role });
  }

  /**
   * REQ-426: a new password. A suspension of the login is lifted with it: the
   * person proved, through their e-mail, that the account is theirs.
   */
  changePassword(passwordHash: string): User {
    return new User({
      ...this.toData(),
      passwordHash,
      failedLoginAttempts: 0,
      loginSuspendedUntil: null,
    });
  }

  /** REQ-414: a successful login resets the count. */
  recordSuccessfulLogin(): User {
    return new User({ ...this.toData(), failedLoginAttempts: 0, loginSuspendedUntil: null });
  }

  toData(): UserData {
    return {
      id: this.id,
      email: this.email,
      name: this.name,
      role: this.role,
      passwordHash: this.passwordHash,
      status: this.status,
      failedLoginAttempts: this.failedLoginAttempts,
      loginSuspendedUntil: this.loginSuspendedUntil,
      createdAt: this.createdAt,
    };
  }
}
