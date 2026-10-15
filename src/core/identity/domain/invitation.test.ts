import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';
import { Invitation } from './invitation.ts';

const AT = new Date('2026-10-14T12:00:00.000Z');

function hoursAfter(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

function anInvitation(): Invitation {
  return Invitation.issue({
    id: 'invitation-1',
    email: ' Ana@Usina.com.br',
    role: 'ADMINISTRATOR',
    tokenDigest: 'digest-1',
    invitedBy: null,
    invitedAt: AT,
  });
}

function expectInvalidLink(work: () => unknown): void {
  try {
    work();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    expect((error as BusinessRuleViolation).messageKey).toBe(IDENTITY_MESSAGES.INVALID_LINK);
  }
}

describe('Invitation (REQ-420)', () => {
  it('is issued pending, for the normalized e-mail, valid for 72 hours', () => {
    const invitation = anInvitation();

    expect(invitation.status).toBe('PENDING');
    expect(invitation.email).toBe('ana@usina.com.br');
    expect(invitation.expiresAt).toEqual(hoursAfter(AT, 72));
  });

  it('is accepted within the 72 hours', () => {
    const accepted = anInvitation().accept(hoursAfter(AT, 71));

    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.acceptedAt).toEqual(hoursAfter(AT, 71));
  });

  it('is refused once the 72 hours are over (CA-408)', () => {
    expectInvalidLink(() => anInvitation().accept(hoursAfter(AT, 72)));
  });

  it('is single use: an accepted invitation is refused (REQ-422, REJ-403)', () => {
    const accepted = anInvitation().accept(AT);

    expectInvalidLink(() => accepted.accept(AT));
  });

  it('is refused once superseded by a newer invitation (REQ-421)', () => {
    const superseded = anInvitation().supersede();

    expect(superseded.status).toBe('SUPERSEDED');
    expectInvalidLink(() => superseded.accept(AT));
  });
});
