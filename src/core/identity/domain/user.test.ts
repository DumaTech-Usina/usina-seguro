import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';
import { User, normalizeEmail } from './user.ts';

const AT = new Date('2026-10-14T12:00:00.000Z');

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function aUser(overrides: { name?: string | null } = {}): User {
  return User.create({
    id: 'user-1',
    email: '  Ana@Usina.com.br ',
    name: overrides.name === undefined ? 'Ana Lima' : overrides.name,
    role: 'USER',
    passwordHash: 'hash',
    createdAt: AT,
  });
}

function failTimes(user: User, times: number, at: Date): User {
  let current = user;
  for (let i = 0; i < times; i++) {
    current = current.recordFailedLogin(at);
  }
  return current;
}

describe('User (REQ-400)', () => {
  it('is created active, with the e-mail as the login, trimmed and in lower case', () => {
    const user = aUser();

    expect(user.email).toBe('ana@usina.com.br');
    expect(user.status).toBe('ACTIVE');
    expect(user.role).toBe('USER');
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.loginSuspendedUntil).toBeNull();
  });

  it('refuses a user with no e-mail', () => {
    expect(() =>
      User.create({
        id: 'user-1',
        email: '   ',
        name: null,
        role: 'USER',
        passwordHash: 'hash',
        createdAt: AT,
      }),
    ).toThrow(BusinessRuleViolation);
  });

  it('is shown by its name', () => {
    expect(aUser().displayName).toBe('Ana Lima');
  });

  it('is shown by its e-mail when it has no name (FA-405)', () => {
    expect(aUser({ name: null }).displayName).toBe('ana@usina.com.br');
    expect(aUser({ name: '   ' }).name).toBeNull();
    expect(aUser({ name: '   ' }).displayName).toBe('ana@usina.com.br');
  });
});

describe('normalizeEmail', () => {
  it('matches the same address whatever its case or surrounding spaces', () => {
    expect(normalizeEmail(' Ana@Usina.COM.br')).toBe('ana@usina.com.br');
  });

  it('refuses an empty address with the e-mail key', () => {
    try {
      normalizeEmail('');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).messageKey).toBe(IDENTITY_MESSAGES.EMAIL_REQUIRED);
    }
  });
});

describe('login attempts (REQ-414)', () => {
  it('counts four failures in a row without suspending the login', () => {
    const user = failTimes(aUser(), 4, AT);

    expect(user.failedLoginAttempts).toBe(4);
    expect(user.isLoginSuspendedAt(AT)).toBe(false);
  });

  it('suspends the login for 15 minutes at the fifth failure in a row', () => {
    const user = failTimes(aUser(), 5, AT);

    expect(user.isLoginSuspendedAt(AT)).toBe(true);
    expect(user.isLoginSuspendedAt(minutesAfter(AT, 14))).toBe(true);
    expect(user.isLoginSuspendedAt(minutesAfter(AT, 15))).toBe(false);
    expect(user.loginSuspendedUntil).toEqual(minutesAfter(AT, 15));
  });

  it('starts a new series of five once the suspension is applied', () => {
    const suspended = failTimes(aUser(), 5, AT);
    const after = minutesAfter(AT, 16);

    const oneMore = suspended.recordFailedLogin(after);

    expect(oneMore.failedLoginAttempts).toBe(1);
    expect(oneMore.isLoginSuspendedAt(after)).toBe(false);
  });

  it('a successful login resets the count', () => {
    const user = failTimes(aUser(), 4, AT).recordSuccessfulLogin();

    expect(user.failedLoginAttempts).toBe(0);
    expect(failTimes(user, 4, AT).isLoginSuspendedAt(AT)).toBe(false);
  });

  it('returns a new instance and leaves the original untouched', () => {
    const user = aUser();
    const failed = user.recordFailedLogin(AT);

    expect(failed).not.toBe(user);
    expect(user.failedLoginAttempts).toBe(0);
  });
});

describe('deactivation and role (REQ-403, REQ-404)', () => {
  it('deactivates without erasing anything', () => {
    const user = aUser().deactivate();

    expect(user.status).toBe('DEACTIVATED');
    expect(user.email).toBe('ana@usina.com.br');
  });

  it('changes the role, returning a new instance', () => {
    const user = aUser();
    const promoted = user.changeRole('ADMINISTRATOR');

    expect(promoted.role).toBe('ADMINISTRATOR');
    expect(user.role).toBe('USER');
  });
});
