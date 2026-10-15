import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';
import { PasswordReset } from './password-reset.ts';

const AT = new Date('2026-10-14T08:00:00.000Z');

function minutesAfter(minutes: number): Date {
  return new Date(AT.getTime() + minutes * 60_000);
}

function aReset(): PasswordReset {
  return PasswordReset.request({ id: 'r-1', userId: 'u-1', tokenDigest: 'd-1', requestedAt: AT });
}

function expectInvalidLink(work: () => unknown): void {
  try {
    work();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    expect((error as BusinessRuleViolation).messageKey).toBe(IDENTITY_MESSAGES.INVALID_LINK);
    expect((error as BusinessRuleViolation).rule).toBe('REQ-426');
  }
}

describe('PasswordReset (REQ-425, REQ-426)', () => {
  it('is valid for 1 hour', () => {
    expect(aReset().expiresAt).toEqual(minutesAfter(60));
    expect(aReset().use(minutesAfter(59)).status).toBe('USED');
    expectInvalidLink(() => aReset().use(minutesAfter(60)));
  });

  it('is single use (REJ-403)', () => {
    const used = aReset().use(AT);

    expectInvalidLink(() => used.use(AT));
  });

  it('stops working once invalidated by another reset', () => {
    expectInvalidLink(() => aReset().invalidate().use(AT));
  });
});
