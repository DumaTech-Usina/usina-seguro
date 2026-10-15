import { describe, expect, it } from 'vitest';
import { Session } from './session.ts';

const AT = new Date('2026-10-14T08:00:00.000Z');

function hoursAfter(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

function aSession(): Session {
  return Session.start({ id: 'session-1', tokenDigest: 'digest', userId: 'user-1', startedAt: AT });
}

describe('Session (REQ-412)', () => {
  it('is active until 12 hours after the login, whatever the use in between', () => {
    const session = aSession();

    expect(session.expiresAt).toEqual(hoursAfter(AT, 12));
    expect(session.isActiveAt(hoursAfter(AT, 11.99))).toBe(true);
    expect(session.isActiveAt(hoursAfter(AT, 12))).toBe(false);
  });

  it('is no longer active once ended (REQ-411)', () => {
    const ended = aSession().end(hoursAfter(AT, 1));

    expect(ended.endedAt).toEqual(hoursAfter(AT, 1));
    expect(ended.isActiveAt(hoursAfter(AT, 1))).toBe(false);
  });

  it('keeps the first ending when ended again', () => {
    const ended = aSession().end(hoursAfter(AT, 1)).end(hoursAfter(AT, 2));

    expect(ended.endedAt).toEqual(hoursAfter(AT, 1));
  });
});
